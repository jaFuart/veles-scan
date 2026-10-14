from __future__ import annotations

import logging
import os
import select
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from uuid import UUID

from prometheus_client import start_http_server
from services.api.jobs_repo import append_debug_log, ensure_schema, get_job, get_job_cancel_reason, update_job_state
from services.shared.logging_utils import setup_logging
from services.shared.metrics import jobs_processed_total, stage_duration_seconds
from services.shared.models import JobStatus, JobType
from services.shared.rmq import consume_json, publish_json
from services.shared.settings import SETTINGS
from services.shared.storage import ensure_bucket, upload_file
from services.shared.worker_heartbeat import WorkerHeartbeatPublisher


setup_logging()
log = logging.getLogger("checko_worker")
ROOT = Path(__file__).resolve().parents[2]


class JobCancelledError(RuntimeError):
    pass


def _ensure_checko_runtime_config_exists() -> None:
    config_path = ROOT / "checko_runtime_config.py"
    if not config_path.exists():
        config_path.write_text("", encoding="utf-8")
        log.info("Created empty checko runtime config at %s", config_path)


def _emit(job_id: str, status: JobStatus, stage: str, progress: int, message: str, payload: dict | None = None) -> None:
    publish_json(
        SETTINGS.queue_status,
        {
            "job_id": job_id,
            "status": status.value,
            "stage": stage,
            "progress": progress,
            "message": message,
            "payload": payload or {},
        },
    )


def _raise_if_cancel_requested(job_uuid: UUID) -> None:
    cancel_reason = get_job_cancel_reason(job_uuid)
    if cancel_reason:
        raise JobCancelledError(cancel_reason)


def _terminate_process(proc: subprocess.Popen[str], timeout_sec: float = 10.0) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5.0)


def _process(payload: dict) -> None:
    job_id = payload["job_id"]
    job_uuid = UUID(job_id)
    existing = get_job(job_uuid)
    if existing and existing.status in {JobStatus.FAILED, JobStatus.COMPLETED}:
        # Drop stale queue messages for jobs that are already terminal.
        log.warning("Skipping stale checko message for terminal job %s (%s)", job_id, existing.status.value)
        return

    batch = payload.get("batch")
    job_type = payload.get("job_type", JobType.CHECKO_REFRESH.value)
    metadata = payload.get("metadata", {}) or {}
    base = Path(SETTINGS.pipeline_artifacts_root) / "checko" / job_id
    base.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["PIPELINE_ARTIFACTS_DIR"] = str(base)
    selected_okved = [str(code).strip() for code in metadata.get("okved_codes", []) if str(code).strip()]
    if selected_okved:
        selected_codes_file = base / "selected_okved_codes.txt"
        selected_codes_file.write_text("\n".join(selected_okved) + "\n", encoding="utf-8")
        env["CHECKO_OKVED_CODES_FILE"] = str(selected_codes_file)

    try:
        _raise_if_cancel_requested(job_uuid)
        HEARTBEAT.set_busy(job_uuid, "Checko refresh in progress")
        append_debug_log(
            job_id=job_uuid,
            service="checko_worker",
            level="INFO",
            message="Checko refresh started",
            payload={"job_type": job_type, "selected_okved_count": len(selected_okved)},
        )
        update_job_state(job_uuid, status=JobStatus.RUNNING, progress=1)
        _emit(job_id, JobStatus.RUNNING, "checko_stage_01", 1, "Checko refresh started")
        _ensure_checko_runtime_config_exists()

        cmd = [sys.executable, str(ROOT / "stage_01_collect_from_checko.py")]
        if batch:
            cmd.extend(["--batch", str(batch)])
        started = datetime.utcnow().timestamp()
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        try:
            while True:
                _raise_if_cancel_requested(job_uuid)
                if proc.poll() is not None:
                    break

                ready, _, _ = select.select([proc.stdout], [], [], 1.0)
                if not ready:
                    continue

                line = proc.stdout.readline()
                if not line:
                    continue
                chunk = line.rstrip()
                if not chunk:
                    continue
                log.info("stage_01_collect_from_checko.py | %s", chunk)
                append_debug_log(
                    job_id=job_uuid,
                    service="checko_worker",
                    level="DEBUG",
                    message=chunk,
                    payload={"stage_script": "stage_01_collect_from_checko.py"},
                )
        except JobCancelledError:
            _terminate_process(proc)
            raise

        ret = proc.wait()
        if ret != 0:
            raise subprocess.CalledProcessError(ret, cmd)
        stage_duration_seconds.labels(stage="stage_01_collect_from_checko.py").observe(
            datetime.utcnow().timestamp() - started
        )

        ensure_bucket(SETTINGS.minio_bucket_checko)
        snapshot_date = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        raw_dir = base / "checko_raw"
        uploaded = 0
        if raw_dir.exists():
            for csv in raw_dir.glob("*.csv"):
                key = f"checko/{snapshot_date}/{csv.name}"
                upload_file(csv, SETTINGS.minio_bucket_checko, key)
                latest_key = f"checko/latest/{csv.name}"
                upload_file(csv, SETTINGS.minio_bucket_checko, latest_key)
                uploaded += 1

        if uploaded == 0:
            raise ValueError("Checko refresh produced no CSV snapshots")

        if job_type == JobType.CHECKO_REFRESH_AND_ENRICH.value:
            update_job_state(
                job_uuid,
                status=JobStatus.RUNNING,
                progress=15,
                result_bucket=SETTINGS.minio_bucket_checko,
                result_key=f"checko/{snapshot_date}/",
            )
            _emit(
                job_id,
                JobStatus.RUNNING,
                "checko_completed",
                15,
                "Checko refresh completed, pipeline queued",
                {"uploaded_files": uploaded, "snapshot_prefix": f"checko/{snapshot_date}/"},
            )
            append_debug_log(
                job_id=job_uuid,
                service="checko_worker",
                level="INFO",
                message="Checko refresh completed, pipeline job queued",
                payload={"uploaded_files": uploaded, "snapshot_prefix": f"checko/{snapshot_date}/"},
            )
            publish_json(
                SETTINGS.queue_pipeline,
                {
                    "job_id": job_id,
                    "job_type": job_type,
                    "input_bucket": None,
                    "input_key": None,
                    "metadata": metadata,
                },
            )
            return

        update_job_state(
            job_uuid,
            status=JobStatus.COMPLETED,
            progress=100,
            result_bucket=SETTINGS.minio_bucket_checko,
            result_key=f"checko/{snapshot_date}/",
        )
        _emit(
            job_id,
            JobStatus.COMPLETED,
            "checko_completed",
            100,
            "Checko refresh completed",
            {"uploaded_files": uploaded, "snapshot_prefix": f"checko/{snapshot_date}/"},
        )
        append_debug_log(
            job_id=job_uuid,
            service="checko_worker",
            level="INFO",
            message="Checko refresh completed",
            payload={"uploaded_files": uploaded, "snapshot_prefix": f"checko/{snapshot_date}/"},
        )
        jobs_processed_total.labels(worker="checko_worker", status=JobStatus.COMPLETED.value).inc()
    except JobCancelledError as exc:
        update_job_state(job_uuid, status=JobStatus.FAILED, error_message=str(exc))
        _emit(job_id, JobStatus.FAILED, "cancelled", 100, str(exc), {"cancel_requested": True})
        append_debug_log(
            job_id=job_uuid,
            service="checko_worker",
            level="WARNING",
            message=str(exc),
            payload={"cancel_requested": True},
        )
        jobs_processed_total.labels(worker="checko_worker", status=JobStatus.FAILED.value).inc()
    except Exception as exc:
        update_job_state(job_uuid, status=JobStatus.FAILED, error_message=str(exc))
        _emit(job_id, JobStatus.FAILED, "checko_failed", 100, f"Checko refresh failed: {exc}")
        append_debug_log(
            job_id=job_uuid,
            service="checko_worker",
            level="ERROR",
            message=f"Checko refresh failed: {exc}",
        )
        jobs_processed_total.labels(worker="checko_worker", status=JobStatus.FAILED.value).inc()
        raise
    finally:
        HEARTBEAT.set_idle("Waiting for checko refresh jobs")


HEARTBEAT = WorkerHeartbeatPublisher("checko_worker")


def run() -> None:
    start_http_server(int(os.getenv("METRICS_PORT", "9102")))
    ensure_schema()
    log.info("Checko worker started")
    HEARTBEAT.start()
    HEARTBEAT.set_idle("Waiting for checko refresh jobs")
    consume_json(SETTINGS.queue_checko, _process, prefetch_count=1)

