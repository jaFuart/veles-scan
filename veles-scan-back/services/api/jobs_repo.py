from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import text

from services.shared.db import db_conn
from services.shared.models import JobRecord, JobStatus, JobType


def ensure_schema() -> None:
    ddl_jobs = """
    CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY,
        job_type VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        input_bucket VARCHAR(255),
        input_key VARCHAR(1024),
        result_bucket VARCHAR(255),
        result_key VARCHAR(1024),
        error_message TEXT,
        progress INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """
    ddl_events = """
    CREATE TABLE IF NOT EXISTS job_events (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL,
        stage VARCHAR(128),
        status VARCHAR(32) NOT NULL,
        message TEXT,
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """
    ddl_worker_heartbeats = """
    CREATE TABLE IF NOT EXISTS worker_heartbeats (
        worker_id VARCHAR(255) PRIMARY KEY,
        worker_role VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        current_job_id UUID,
        message TEXT,
        queue_depth INTEGER,
        host VARCHAR(255),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """
    ddl_worker_events = """
    CREATE TABLE IF NOT EXISTS worker_heartbeat_events (
        id BIGSERIAL PRIMARY KEY,
        worker_id VARCHAR(255) NOT NULL,
        worker_role VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        current_job_id UUID,
        message TEXT,
        queue_depth INTEGER,
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """
    ddl_debug_logs = """
    CREATE TABLE IF NOT EXISTS job_debug_logs (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID,
        service VARCHAR(64) NOT NULL,
        level VARCHAR(16) NOT NULL,
        message TEXT NOT NULL,
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """
    ddl_debug_logs_idx = """
    CREATE INDEX IF NOT EXISTS idx_job_debug_logs_job_id_id
    ON job_debug_logs(job_id, id);
    """
    ddl_intent_cache = """
    CREATE TABLE IF NOT EXISTS intent_resolution_cache (
        cache_key VARCHAR(128) PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
    );
    """
    ddl_intent_cache_idx = """
    CREATE INDEX IF NOT EXISTS idx_intent_resolution_cache_expires_at
    ON intent_resolution_cache(expires_at);
    """
    with db_conn() as conn:
        conn.execute(text(ddl_jobs))
        conn.execute(text(ddl_events))
        conn.execute(text(ddl_worker_heartbeats))
        conn.execute(text(ddl_worker_events))
        conn.execute(text(ddl_debug_logs))
        conn.execute(text(ddl_debug_logs_idx))
        conn.execute(text(ddl_intent_cache))
        conn.execute(text(ddl_intent_cache_idx))


def _row_to_job(row) -> JobRecord:
    return JobRecord(
        id=row["id"],
        job_type=JobType(row["job_type"]),
        status=JobStatus(row["status"]),
        input_bucket=row["input_bucket"],
        input_key=row["input_key"],
        result_bucket=row["result_bucket"],
        result_key=row["result_key"],
        progress=row["progress"] or 0,
        error_message=row["error_message"],
        metadata=row["metadata"] or {},
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def create_job(job: JobRecord) -> None:
    sql = text(
        """
        INSERT INTO jobs (
            id, job_type, status, input_bucket, input_key, result_bucket, result_key,
            error_message, progress, metadata
        ) VALUES (
            :id, :job_type, :status, :input_bucket, :input_key, :result_bucket, :result_key,
            :error_message, :progress, CAST(:metadata AS JSONB)
        )
        """
    )
    with db_conn() as conn:
        conn.execute(
            sql,
            {
                "id": str(job.id),
                "job_type": job.job_type.value,
                "status": job.status.value,
                "input_bucket": job.input_bucket,
                "input_key": job.input_key,
                "result_bucket": job.result_bucket,
                "result_key": job.result_key,
                "error_message": job.error_message,
                "progress": job.progress,
                "metadata": json.dumps(job.metadata, ensure_ascii=False),
            },
        )


def get_job(job_id: UUID) -> JobRecord | None:
    sql = text("SELECT * FROM jobs WHERE id = :id")
    with db_conn() as conn:
        row = conn.execute(sql, {"id": str(job_id)}).mappings().first()
    return _row_to_job(row) if row else None


def request_job_cancel(job_id: UUID, *, reason: str, requested_by: str = "admin") -> JobRecord | None:
    current = get_job(job_id)
    if not current:
        return None

    if current.status == JobStatus.COMPLETED:
        return current

    metadata = dict(current.metadata or {})
    metadata.update(
        {
            "cancel_requested": True,
            "cancel_reason": reason,
            "cancel_requested_by": requested_by,
        }
    )

    next_status = current.status if current.status == JobStatus.COMPLETED else JobStatus.FAILED
    sql = text(
        """
        UPDATE jobs
        SET status = :status,
            error_message = :error_message,
            metadata = CAST(:metadata AS JSONB),
            updated_at = NOW()
        WHERE id = :id
        """
    )
    with db_conn() as conn:
        conn.execute(
            sql,
            {
                "id": str(job_id),
                "status": next_status.value,
                "error_message": reason,
                "metadata": json.dumps(metadata, ensure_ascii=False),
            },
        )
    return get_job(job_id)


def get_job_cancel_reason(job_id: UUID) -> str | None:
    current = get_job(job_id)
    if not current:
        return None

    metadata = current.metadata or {}
    if bool(metadata.get("cancel_requested")):
        reason = str(metadata.get("cancel_reason") or "").strip()
        return reason or current.error_message or "Job cancelled"

    return None


def find_active_intent_job(
    job_type: JobType,
    okved_codes: list[str],
    output_field_keys: list[str] | None = None,
    data_filters: list[dict[str, Any]] | None = None,
    lookback_hours: int = 6,
) -> JobRecord | None:
    # Reuse a recent queued/running UI intent job with the same normalized OKVED list.
    sql = text(
        """
        SELECT *
        FROM jobs
        WHERE job_type = :job_type
          AND status IN ('queued', 'running')
          AND metadata->>'source' = 'ui_intent'
          AND COALESCE(metadata->'okved_codes', '[]'::jsonb) @> CAST(:okved_codes AS JSONB)
          AND CAST(:okved_codes AS JSONB) @> COALESCE(metadata->'okved_codes', '[]'::jsonb)
          AND COALESCE(metadata->'output_field_keys', '[]'::jsonb) @> CAST(:output_field_keys AS JSONB)
          AND CAST(:output_field_keys AS JSONB) @> COALESCE(metadata->'output_field_keys', '[]'::jsonb)
          AND COALESCE(metadata->'data_filters', '[]'::jsonb) @> CAST(:data_filters AS JSONB)
          AND CAST(:data_filters AS JSONB) @> COALESCE(metadata->'data_filters', '[]'::jsonb)
          AND created_at >= NOW() - (:lookback_hours || ' hours')::interval
                ORDER BY
                    CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
                    created_at DESC
        LIMIT 1
        """
    )
    payload = json.dumps(okved_codes, ensure_ascii=False)
    output_fields_payload = json.dumps(output_field_keys or [], ensure_ascii=False)
    data_filters_payload = json.dumps(data_filters or [], ensure_ascii=False)
    with db_conn() as conn:
        row = conn.execute(
            sql,
            {
                "job_type": job_type.value,
                "okved_codes": payload,
                "output_field_keys": output_fields_payload,
                "data_filters": data_filters_payload,
                "lookback_hours": str(max(1, lookback_hours)),
            },
        ).mappings().first()
    return _row_to_job(row) if row else None


def update_job_state(
    job_id: UUID,
    *,
    status: JobStatus | None = None,
    progress: int | None = None,
    error_message: str | None = None,
    result_bucket: str | None = None,
    result_key: str | None = None,
    metadata_patch: dict[str, Any] | None = None,
) -> None:
    current = get_job(job_id)
    if not current:
        return
    metadata = dict(current.metadata or {})
    if metadata_patch:
        metadata.update(metadata_patch)

    sql = text(
        """
        UPDATE jobs
        SET
            status = COALESCE(:status, status),
            progress = COALESCE(:progress, progress),
            error_message = COALESCE(:error_message, error_message),
            result_bucket = COALESCE(:result_bucket, result_bucket),
            result_key = COALESCE(:result_key, result_key),
            metadata = CAST(:metadata AS JSONB),
            updated_at = NOW()
        WHERE id = :id
        """
    )
    with db_conn() as conn:
        conn.execute(
            sql,
            {
                "id": str(job_id),
                "status": status.value if status else None,
                "progress": progress,
                "error_message": error_message,
                "result_bucket": result_bucket,
                "result_key": result_key,
                "metadata": json.dumps(metadata, ensure_ascii=False),
            },
        )


def append_job_event(job_id: UUID, status: JobStatus, stage: str | None, message: str | None, payload: dict[str, Any] | None = None) -> None:
    sql = text(
        """
        INSERT INTO job_events(job_id, stage, status, message, payload)
        VALUES (:job_id, :stage, :status, :message, CAST(:payload AS JSONB))
        """
    )
    with db_conn() as conn:
        conn.execute(
            sql,
            {
                "job_id": str(job_id),
                "stage": stage,
                "status": status.value,
                "message": message,
                "payload": json.dumps(payload or {}, ensure_ascii=False),
            },
        )


def upsert_worker_heartbeat(
    worker_id: str,
    worker_role: str,
    status: str,
    current_job_id: UUID | None,
    message: str | None,
    queue_depth: int | None,
    host: str | None,
) -> None:
    sql = text(
        """
        INSERT INTO worker_heartbeats(
            worker_id, worker_role, status, current_job_id, message, queue_depth, host, updated_at
        )
        VALUES (
            :worker_id, :worker_role, :status, :current_job_id, :message, :queue_depth, :host, NOW()
        )
        ON CONFLICT (worker_id)
        DO UPDATE SET worker_role = EXCLUDED.worker_role,
                      status = EXCLUDED.status,
                      current_job_id = EXCLUDED.current_job_id,
                      message = EXCLUDED.message,
                      queue_depth = EXCLUDED.queue_depth,
                      host = EXCLUDED.host,
                      updated_at = NOW()
        """
    )
    with db_conn() as conn:
        conn.execute(
            sql,
            {
                "worker_id": worker_id,
                "worker_role": worker_role,
                "status": status,
                "current_job_id": str(current_job_id) if current_job_id else None,
                "message": message,
                "queue_depth": queue_depth,
                "host": host,
            },
        )


def append_worker_heartbeat_event(
    worker_id: str,
    worker_role: str,
    status: str,
    current_job_id: UUID | None,
    message: str | None,
    queue_depth: int | None,
    payload: dict[str, Any] | None = None,
) -> None:
    sql = text(
        """
        INSERT INTO worker_heartbeat_events(
            worker_id, worker_role, status, current_job_id, message, queue_depth, payload
        )
        VALUES (:worker_id, :worker_role, :status, :current_job_id, :message, :queue_depth, CAST(:payload AS JSONB))
        """
    )
    with db_conn() as conn:
        conn.execute(
            sql,
            {
                "worker_id": worker_id,
                "worker_role": worker_role,
                "status": status,
                "current_job_id": str(current_job_id) if current_job_id else None,
                "message": message,
                "queue_depth": queue_depth,
                "payload": json.dumps(payload or {}, ensure_ascii=False),
            },
        )


def list_worker_heartbeats(limit: int = 200) -> list[dict[str, Any]]:
    # Workers are considered offline if no heartbeat received in > 45 s (3× interval).
    sql = text(
        """
        SELECT
            worker_id,
            worker_role,
            CASE
                WHEN updated_at < NOW() - INTERVAL '45 seconds' THEN 'offline'
                ELSE status
            END AS status,
            current_job_id,
            message,
            queue_depth,
            host,
            updated_at
        FROM worker_heartbeats
        ORDER BY updated_at DESC
        LIMIT :limit
        """
    )
    with db_conn() as conn:
        rows = conn.execute(sql, {"limit": limit}).mappings().all()
    return [dict(row) for row in rows]


def append_debug_log(
    *,
    job_id: UUID | None,
    service: str,
    level: str,
    message: str,
    payload: dict[str, Any] | None = None,
) -> None:
    sql = text(
        """
        INSERT INTO job_debug_logs(job_id, service, level, message, payload)
        VALUES (:job_id, :service, :level, :message, CAST(:payload AS JSONB))
        """
    )
    with db_conn() as conn:
        conn.execute(
            sql,
            {
                "job_id": str(job_id) if job_id else None,
                "service": service,
                "level": level.upper(),
                "message": message,
                "payload": json.dumps(payload or {}, ensure_ascii=False),
            },
        )


def list_debug_logs_for_job(job_id: UUID, *, since_id: int | None = None, limit: int = 300) -> list[dict[str, Any]]:
    safe_limit = max(1, min(1000, int(limit)))
    if since_id is None:
        sql = text(
            """
            SELECT id, job_id, service, level, message, payload, created_at
            FROM job_debug_logs
            WHERE job_id = :job_id
            ORDER BY id ASC
            LIMIT :limit
            """
        )
        params = {"job_id": str(job_id), "limit": safe_limit}
    else:
        sql = text(
            """
            SELECT id, job_id, service, level, message, payload, created_at
            FROM job_debug_logs
            WHERE job_id = :job_id
              AND id > :since_id
            ORDER BY id ASC
            LIMIT :limit
            """
        )
        params = {"job_id": str(job_id), "since_id": int(since_id), "limit": safe_limit}
    with db_conn() as conn:
        rows = conn.execute(sql, params).mappings().all()
    return [dict(row) for row in rows]

