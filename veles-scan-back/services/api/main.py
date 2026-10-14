from __future__ import annotations

import hashlib
import json
import logging
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone
from uuid import UUID

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
from sqlalchemy import text

from services.api.jobs_repo import create_job, ensure_schema, find_active_intent_job, get_job, list_worker_heartbeats
from services.api.jobs_repo import append_debug_log, list_debug_logs_for_job
from services.api.jobs_repo import append_job_event, request_job_cancel
from services.api.intent_data_filters import resolve_data_filters_for_intent
from services.api.okved_intent import (
    list_available_okved_codes,
    list_available_snapshot_columns,
    list_configured_okved_codes,
    resolve_okved_for_intent,
    validate_intent_scope_with_llm,
)
from services.api.output_fields_intent import resolve_output_fields_for_intent
from services.api.schemas import (
    CreateIntentJobRequest,
    CreateIntentJobResponse,
    CancelJobResponse,
    CreateJobRequest,
    CreateJobResponse,
    IntentPreviewResponse,
    PriceEstimateRequest,
    PriceEstimateResponse,
    JobResponse,
    ResultResponse,
    SystemWorkersResponse,
    UploadInputResponse,
)
from services.api.pricing import PricingContext, estimate_project_price
from services.shared.logging_utils import setup_logging
from services.shared.models import JobRecord, JobStatus, JobType
from services.shared.db import db_conn
from services.shared.rmq import get_queue_depth, publish_json
from services.shared.settings import SETTINGS
from services.shared.storage import create_presigned_url, ensure_bucket, upload_file


setup_logging()
log = logging.getLogger("api")
app = FastAPI(title="Unified Company Pipeline API", version="1.0.0")
INTENT_CACHE_TTL_SECONDS = 24 * 60 * 60
INTENT_RESOLUTION_CACHE_VERSION = 2


def _build_intent_cache_key(
    req: CreateIntentJobRequest,
    resolvable_okved: list[str],
    snapshot_columns: list[str],
) -> str:
    snapshot_payload = {
        "okved_codes": resolvable_okved,
        "snapshot_columns": snapshot_columns,
    }
    request_payload = {
        "intent_resolution_cache_version": INTENT_RESOLUTION_CACHE_VERSION,
        "intent": req.intent.strip().lower(),
        "response_format": (req.response_format or "").strip().lower(),
        "max_okved_codes": int(req.max_okved_codes),
        "max_output_fields": int(req.max_output_fields),
        "openai_model": SETTINGS.openai_model,
        "openai_available": bool(SETTINGS.openai_api_key),
    }
    snapshot_sig = hashlib.sha256(
        json.dumps(snapshot_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    request_sig = hashlib.sha256(
        json.dumps(request_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return hashlib.sha256(f"{snapshot_sig}|{request_sig}".encode("utf-8")).hexdigest()


def _load_intent_resolution_cache(cache_key: str) -> dict | None:
    sql = text(
        """
        SELECT payload
        FROM intent_resolution_cache
        WHERE cache_key = :cache_key
          AND expires_at > NOW()
        LIMIT 1
        """
    )
    with db_conn() as conn:
        row = conn.execute(sql, {"cache_key": cache_key}).mappings().first()
    if not row:
        return None
    payload = row.get("payload")
    return payload if isinstance(payload, dict) else None


def _save_intent_resolution_cache(cache_key: str, payload: dict) -> None:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=INTENT_CACHE_TTL_SECONDS)
    sql = text(
        """
        INSERT INTO intent_resolution_cache (cache_key, payload, expires_at)
        VALUES (:cache_key, CAST(:payload AS JSONB), :expires_at)
        ON CONFLICT (cache_key)
        DO UPDATE SET payload = EXCLUDED.payload,
                      expires_at = EXCLUDED.expires_at
        """
    )
    with db_conn() as conn:
        conn.execute(
            sql,
            {
                "cache_key": cache_key,
                "payload": json.dumps(payload, ensure_ascii=False),
                "expires_at": expires_at,
            },
        )


@app.on_event("startup")
def on_startup() -> None:
    ensure_schema()
    ensure_bucket(SETTINGS.minio_bucket_jobs)
    ensure_bucket(SETTINGS.minio_bucket_checko)
    log.info("API started")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/jobs/upload-input", response_model=UploadInputResponse)
async def upload_input(file: UploadFile = File(...)) -> UploadInputResponse:
    suffix = Path(file.filename or "input.xlsx").suffix or ".xlsx"
    object_key = f"inputs/{uuid.uuid4()}{suffix}"
    tmp = Path("/tmp") / f"ucp_upload_{uuid.uuid4()}{suffix}"
    try:
        data = await file.read()
        tmp.write_bytes(data)
        upload_file(tmp, SETTINGS.minio_bucket_jobs, object_key)
        return UploadInputResponse(bucket=SETTINGS.minio_bucket_jobs, key=object_key, size_bytes=len(data))
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


@app.post("/jobs", response_model=CreateJobResponse)
def submit_job(req: CreateJobRequest) -> CreateJobResponse:
    job = JobRecord.new(
        job_type=req.job_type,
        input_bucket=req.input_bucket,
        input_key=req.input_key,
        metadata=req.metadata,
    )
    create_job(job)
    append_debug_log(
        job_id=job.id,
        service="api",
        level="INFO",
        message="Manual job accepted via /jobs",
        payload={"job_type": job.job_type.value},
    )

    publish_json(
        SETTINGS.queue_pipeline,
        {
            "job_id": str(job.id),
            "job_type": job.job_type.value,
            "input_bucket": job.input_bucket,
            "input_key": job.input_key,
            "metadata": job.metadata,
        },
    )
    publish_json(
        SETTINGS.queue_status,
        {
            "job_id": str(job.id),
            "status": JobStatus.QUEUED.value,
            "stage": "submit",
            "progress": 0,
            "message": "Job accepted",
            "payload": {"job_type": job.job_type.value},
        },
    )
    return CreateJobResponse(job_id=job.id, status=JobStatus.QUEUED)


@app.post("/jobs/checko-refresh", response_model=CreateJobResponse)
def submit_checko_refresh() -> CreateJobResponse:
    job = JobRecord.new(job_type=JobType.CHECKO_REFRESH, input_bucket=None, input_key=None, metadata={"source": "manual"})
    create_job(job)
    append_debug_log(
        job_id=job.id,
        service="api",
        level="INFO",
        message="Manual checko refresh accepted via /jobs/checko-refresh",
        payload={"job_type": job.job_type.value},
    )
    publish_json(
        SETTINGS.queue_checko,
        {"job_id": str(job.id), "job_type": job.job_type.value, "metadata": job.metadata},
    )
    publish_json(
        SETTINGS.queue_status,
        {
            "job_id": str(job.id),
            "status": JobStatus.QUEUED.value,
            "stage": "submit",
            "progress": 0,
            "message": "Manual checko refresh accepted",
            "payload": {"job_type": job.job_type.value},
        },
    )
    return CreateJobResponse(job_id=job.id, status=JobStatus.QUEUED)


@app.post("/jobs/from-intent", response_model=CreateIntentJobResponse)
def submit_job_from_intent(req: CreateIntentJobRequest) -> CreateIntentJobResponse:
    resolved = _resolve_intent_request(req)
    metadata = {
        "source": "ui_intent",
        "intent": req.intent,
        "build_from_checko": True,
        "okved_codes": resolved["normalized_codes"],
        "resolver_source": resolved["resolver_source"],
        "data_filters": resolved["resolved_data_filters"],
        "ignored_intent_conditions": resolved["ignored_conditions"],
        "data_filters_source": resolved["data_filters_source"],
        "filters_warning": resolved["filters_warning"],
        "response_format": req.response_format,
        "output_fields": resolved["resolved_output_fields"],
        "output_field_keys": resolved["output_field_keys"],
        "output_fields_source": resolved["output_fields_source"],
    }
    # UI flow never triggers checko collection; only enrich from existing MinIO snapshots.
    job_type = JobType.ENRICH_ONLY

    existing = find_active_intent_job(
        job_type=job_type,
        okved_codes=resolved["normalized_codes"],
        output_field_keys=resolved["output_field_keys"],
        data_filters=resolved["resolved_data_filters"],
    )
    if existing:
        log.info("Resolved OKVED codes for reused job %s: %s", existing.id, ", ".join(resolved["normalized_codes"]))
        append_debug_log(
            job_id=existing.id,
            service="api",
            level="INFO",
            message="Reused active intent job",
            payload={
                "resolver_source": resolved["resolver_source"],
                "data_filters_source": resolved["data_filters_source"],
                "output_fields_source": resolved["output_fields_source"],
                "okved_codes": resolved["normalized_codes"],
                "data_filters": resolved["resolved_data_filters"],
                "ignored_intent_conditions": resolved["ignored_conditions"],
                "snapshot_columns_count": len(resolved["snapshot_columns"]),
                "output_field_keys": resolved["output_field_keys"],
            },
        )
        append_debug_log(
            job_id=existing.id,
            service="api",
            level="INFO",
            message=f"Resolved data filters: {json.dumps(resolved['resolved_data_filters'], ensure_ascii=False)}",
            payload={
                "data_filters_source": resolved["data_filters_source"],
                "ignored_intent_conditions": resolved["ignored_conditions"],
                "filters_warning": resolved["filters_warning"],
            },
        )
        append_debug_log(
            job_id=existing.id,
            service="api",
            level="INFO",
            message=f"Resolved OKVED codes: {', '.join(resolved['normalized_codes'])}",
            payload={"okved_codes_count": len(resolved["normalized_codes"])},
        )
        return CreateIntentJobResponse(
            job_id=existing.id,
            status=existing.status,
            resolved_okved_codes=resolved["normalized_codes"],
            resolver_source=resolved["resolver_source"],
            available_okved_count=len(resolved["resolvable_okved"]),
            resolved_output_fields=resolved["resolved_output_fields"],
            output_fields_source=resolved["output_fields_source"],
            resolved_data_filters=resolved["resolved_data_filters"],
            ignored_intent_conditions=resolved["ignored_conditions"],
            data_filters_source=resolved["data_filters_source"],
            warning=resolved["filters_warning"],
        )

    job = JobRecord.new(job_type=job_type, input_bucket=None, input_key=None, metadata=metadata)
    create_job(job)
    log.info("Resolved OKVED codes for new job %s: %s", job.id, ", ".join(resolved["normalized_codes"]))
    append_debug_log(
        job_id=job.id,
        service="api",
        level="INFO",
        message="Intent job accepted",
        payload={
            "job_type": job.job_type.value,
            "resolver_source": resolved["resolver_source"],
            "data_filters_source": resolved["data_filters_source"],
            "output_fields_source": resolved["output_fields_source"],
            "okved_codes": resolved["normalized_codes"],
            "data_filters": resolved["resolved_data_filters"],
            "ignored_intent_conditions": resolved["ignored_conditions"],
            "snapshot_columns_count": len(resolved["snapshot_columns"]),
            "output_field_keys": resolved["output_field_keys"],
            "response_format": req.response_format,
            "warning": resolved["filters_warning"],
        },
    )
    append_debug_log(
        job_id=job.id,
        service="api",
        level="INFO",
        message=f"Resolved data filters: {json.dumps(resolved['resolved_data_filters'], ensure_ascii=False)}",
        payload={
            "data_filters_source": resolved["data_filters_source"],
            "ignored_intent_conditions": resolved["ignored_conditions"],
            "filters_warning": resolved["filters_warning"],
        },
    )
    append_debug_log(
        job_id=job.id,
        service="api",
        level="INFO",
        message=f"Resolved OKVED codes: {', '.join(resolved['normalized_codes'])}",
        payload={"okved_codes_count": len(resolved["normalized_codes"])},
    )

    publish_json(
        SETTINGS.queue_pipeline,
        {
            "job_id": str(job.id),
            "job_type": job.job_type.value,
            "input_bucket": job.input_bucket,
            "input_key": job.input_key,
            "metadata": job.metadata,
        },
    )
    publish_json(
        SETTINGS.queue_status,
        {
            "job_id": str(job.id),
            "status": JobStatus.QUEUED.value,
            "stage": "submit",
            "progress": 0,
            "message": "Intent job accepted",
            "payload": {
                "job_type": job.job_type.value,
                "resolver_source": resolved["resolver_source"],
                "requires_refresh": False,
            },
        },
    )
    return CreateIntentJobResponse(
        job_id=job.id,
        status=JobStatus.QUEUED,
        resolved_okved_codes=resolved["normalized_codes"],
        resolver_source=resolved["resolver_source"],
        available_okved_count=len(resolved["resolvable_okved"]),
        resolved_output_fields=resolved["resolved_output_fields"],
        output_fields_source=resolved["output_fields_source"],
        resolved_data_filters=resolved["resolved_data_filters"],
        ignored_intent_conditions=resolved["ignored_conditions"],
        data_filters_source=resolved["data_filters_source"],
        warning=resolved["filters_warning"],
    )


@app.post("/jobs/intent-preview", response_model=IntentPreviewResponse)
def preview_job_from_intent(req: CreateIntentJobRequest) -> IntentPreviewResponse:
    resolved = _resolve_intent_request(req, allow_catalog_fallback=True)
    return IntentPreviewResponse(
        resolved_okved_codes=resolved["normalized_codes"],
        resolver_source=resolved["resolver_source"],
        available_okved_count=len(resolved["resolvable_okved"]),
        resolved_output_fields=resolved["resolved_output_fields"],
        output_fields_source=resolved["output_fields_source"],
        resolved_data_filters=resolved["resolved_data_filters"],
        ignored_intent_conditions=resolved["ignored_conditions"],
        data_filters_source=resolved["data_filters_source"],
        warning=resolved["filters_warning"],
    )


@app.post("/jobs/price-estimate", response_model=PriceEstimateResponse)
def estimate_price(req: PriceEstimateRequest) -> PriceEstimateResponse:
    estimate = estimate_project_price(
        PricingContext(
            base_price_rub=req.base_price_rub,
            response_format=req.response_format,
            resolved_output_fields=req.resolved_output_fields,
            resolved_data_filters=req.resolved_data_filters,
            resolved_okved_codes=req.resolved_okved_codes,
            openai_model=SETTINGS.openai_model,
            previous_price_rub=req.previous_price_rub,
            previous_prompt=req.previous_prompt,
            previous_reasoning_short=req.previous_reasoning_short,
            previous_reasoning_details=req.previous_reasoning_details,
            min_delta_rub=req.min_delta_rub,
        )
    )
    return PriceEstimateResponse(
        estimated_price_rub=estimate.estimated_price_rub,
        pricing_source=estimate.pricing_source,
        pricing_model=estimate.pricing_model,
        pricing_reason_short=estimate.pricing_reason_short,
        pricing_reason_details=estimate.pricing_reason_details,
        pricing_prompt=estimate.pricing_prompt,
        pricing_prompt_hash=estimate.pricing_prompt_hash,
        input_signature=estimate.input_signature,
    )


def _resolve_intent_request(req: CreateIntentJobRequest, allow_catalog_fallback: bool = False) -> dict:
    snapshot_okved = list_available_okved_codes()
    snapshot_columns = list_available_snapshot_columns()
    # UI intent jobs must use only already prepared Checko snapshots from MinIO.
    # Separate scheduler/checko-refresh endpoints are responsible for data refresh.
    resolvable_okved = sorted(set(snapshot_okved))
    if not resolvable_okved:
        if not allow_catalog_fallback:
            raise HTTPException(
                status_code=400,
                detail="No Checko snapshots are available yet. Run scheduled/manual checko refresh first.",
            )
        resolvable_okved = list_configured_okved_codes()
        if not resolvable_okved:
            raise HTTPException(
                status_code=400,
                detail="No OKVED catalog is available for fallback preview.",
            )
        # Fallback columns for preview-only filter extraction when snapshots are not ready.
        if not snapshot_columns:
            snapshot_columns = [
                "Название компании",
                "Юридическое наименование",
                "ОКВЭД",
                "Город",
                "Юридический адрес",
                "Сайт",
                "Email",
                "Телефон",
                "Выручка",
                "Чистая прибыль",
                "Капитал",
                "Дата регистрации",
                "Статус",
            ]

    resolved_data_filters, ignored_conditions, filters_warning, data_filters_source = resolve_data_filters_for_intent(
        req.intent,
        snapshot_columns,
    )
    log.info(
        "Intent filter resolution: source=%s filters=%d ignored=%d warning=%s",
        data_filters_source,
        len(resolved_data_filters),
        len(ignored_conditions),
        "yes" if filters_warning else "no",
    )
    is_allowed, refusal_reason, refusal_kind = validate_intent_scope_with_llm(req.intent)
    if not is_allowed:
        # If intent has at least one applicable structured data filter, allow processing
        # and keep unsupported constraints as warnings instead of hard rejection.
        if refusal_kind == "too_broad" and resolved_data_filters:
            pass
        else:
            raise HTTPException(
                status_code=422,
                detail=refusal_reason
                or (
                    "Пока не получается рассчитать стоимость: запрос слишком общий. Добавьте, пожалуйста, нишу, регион и тип организаций, чтобы мы точнее поняли задачу."
                    if refusal_kind == "too_broad"
                    else "Пока не получается рассчитать стоимость: в одном запросе смешаны слишком разные условия. Лучше разделить задачу на несколько отдельных сборок, так результат будет точнее."
                ),
            )

    resolvable_okved_set = set(resolvable_okved)
    resolved_codes, resolver_source = resolve_okved_for_intent(
        intent=req.intent,
        available_codes=resolvable_okved,
        max_okved_codes=req.max_okved_codes,
    )
    if not resolved_codes:
        configured_okved = list_configured_okved_codes()
        if configured_okved:
            configured_okved_set = set(configured_okved)
            if configured_okved_set != resolvable_okved_set:
                configured_resolved_codes, _ = resolve_okved_for_intent(
                    intent=req.intent,
                    available_codes=sorted(configured_okved_set),
                    max_okved_codes=req.max_okved_codes,
                )
                missing_snapshot_codes = [
                    code for code in configured_resolved_codes if code not in resolvable_okved_set
                ]
                if missing_snapshot_codes:
                    missing_snapshot_prefixes = sorted(
                        {
                            code[:2]
                            for code in missing_snapshot_codes
                            if len(code) >= 2 and code[:2].isdigit()
                        }
                    )
                    prefix_suffix = (
                        f" (префиксы: {', '.join(missing_snapshot_prefixes)})"
                        if missing_snapshot_prefixes
                        else ""
                    )
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            "Пока не получается рассчитать стоимость: для такой ниши у нас ещё нет достаточно подготовленных данных. "
                            f"Сейчас не хватает данных по ОКВЭД: {', '.join(missing_snapshot_codes[:4])}{prefix_suffix}. "
                            "Попробуйте позже или сузьте запрос до более конкретной категории."
                        ),
                    )
        raise HTTPException(
            status_code=422,
            detail="Пока не получается рассчитать стоимость: по этому описанию сложно точно определить нишу. Попробуйте уточнить сферу деятельности, регион или добавить явные коды ОКВЭД.",
        )

    normalized_codes = sorted(dict.fromkeys(resolved_codes))
    resolved_output_fields, output_fields_source = resolve_output_fields_for_intent(
        intent=req.intent,
        response_format=req.response_format,
        max_output_fields=req.max_output_fields,
    )
    output_field_keys = [field["key"] for field in resolved_output_fields]

    resolved_payload = {
        "snapshot_columns": snapshot_columns,
        "resolvable_okved": resolvable_okved,
        "normalized_codes": normalized_codes,
        "resolver_source": resolver_source,
        "resolved_output_fields": resolved_output_fields,
        "output_fields_source": output_fields_source,
        "resolved_data_filters": resolved_data_filters,
        "ignored_conditions": ignored_conditions,
        "data_filters_source": data_filters_source,
        "output_field_keys": output_field_keys,
        "filters_warning": filters_warning,
    }
    return resolved_payload


@app.get("/jobs/{job_id}", response_model=JobResponse)
def get_job_status(job_id: UUID) -> JobResponse:
    record = get_job(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse(**record.__dict__)


@app.get("/jobs/{job_id}/result", response_model=ResultResponse)
def get_job_result(job_id: UUID) -> ResultResponse:
    record = get_job(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    download_url = None
    if record.status == JobStatus.COMPLETED and record.result_bucket and record.result_key:
        download_url = create_presigned_url(record.result_bucket, record.result_key)
    return ResultResponse(
        job_id=record.id,
        status=record.status,
        result_bucket=record.result_bucket,
        result_key=record.result_key,
        download_url=download_url,
    )


@app.post("/jobs/{job_id}/cancel", response_model=CancelJobResponse)
def cancel_job(job_id: UUID) -> CancelJobResponse:
    record = get_job(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")

    if record.status == JobStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="Completed job cannot be cancelled")

    reason = "Проект остановлен администратором"
    updated = request_job_cancel(job_id, reason=reason, requested_by="admin")
    if not updated:
        raise HTTPException(status_code=404, detail="Job not found")

    if updated.status == JobStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="Completed job cannot be cancelled")

    append_job_event(job_id, status=JobStatus.FAILED, stage="cancelled", message=reason, payload={"requested_by": "admin"})
    append_debug_log(
        job_id=job_id,
        service="api",
        level="WARNING",
        message=reason,
        payload={"action": "cancel_job", "requested_by": "admin"},
    )

    return CancelJobResponse(job_id=job_id, status=updated.status, message=reason)


@app.get("/jobs/{job_id}/debug-logs")
def get_job_debug_logs(job_id: UUID, since_id: int | None = None, limit: int = 300) -> dict:
    record = get_job(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    logs = list_debug_logs_for_job(job_id, since_id=since_id, limit=limit)
    last_id = logs[-1]["id"] if logs else since_id
    return {
        "job_id": str(job_id),
        "logs": logs,
        "last_id": last_id,
        "storage_hint": {
            "container_log_stream": "docker compose logs api pipeline_worker checko_worker status_aggregator scheduler",
            "runtime_log_dir": "/app/runtime/backend-logs",
        },
    }


@app.get("/system/workers", response_model=SystemWorkersResponse)
def get_system_workers() -> SystemWorkersResponse:
    workers = list_worker_heartbeats()
    queue_depths = {
        SETTINGS.queue_pipeline: get_queue_depth(SETTINGS.queue_pipeline),
        SETTINGS.queue_checko: get_queue_depth(SETTINGS.queue_checko),
        SETTINGS.queue_status: get_queue_depth(SETTINGS.queue_status),
        SETTINGS.queue_worker_heartbeat: get_queue_depth(SETTINGS.queue_worker_heartbeat),
    }
    workers_busy = sum(1 for worker in workers if worker.get("status") == "busy")
    workers_idle = sum(1 for worker in workers if worker.get("status") == "idle")
    return SystemWorkersResponse(
        workers=workers,
        queue_depths=queue_depths,
        workers_total=len(workers),
        workers_busy=workers_busy,
        workers_idle=workers_idle,
    )


if __name__ == "__main__":
    uvicorn.run(app, host=SETTINGS.app_host, port=SETTINGS.app_port)

