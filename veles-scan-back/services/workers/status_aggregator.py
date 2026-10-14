from __future__ import annotations

import logging
import os
import threading
from uuid import UUID

from prometheus_client import start_http_server
from services.api.jobs_repo import (
    append_debug_log,
    append_job_event,
    append_worker_heartbeat_event,
    ensure_schema,
    update_job_state,
    upsert_worker_heartbeat,
)
from services.shared.logging_utils import setup_logging
from services.shared.metrics import queue_events_total
from services.shared.models import JobStatus
from services.shared.rmq import consume_json
from services.shared.settings import SETTINGS


setup_logging()
log = logging.getLogger("status_aggregator")


def _handle(payload: dict) -> None:
    job_id = payload.get("job_id")
    if not job_id:
        return
    status = JobStatus(payload.get("status", JobStatus.RUNNING.value))
    stage = payload.get("stage")
    progress = payload.get("progress")
    message = payload.get("message")
    data = payload.get("payload", {})

    job_uuid = UUID(job_id)
    append_job_event(job_uuid, status=status, stage=stage, message=message, payload=data)
    append_debug_log(
        job_id=job_uuid,
        service="status_aggregator",
        level="INFO" if status != JobStatus.FAILED else "ERROR",
        message=message or "Status event received",
        payload={"stage": stage, "status": status.value, "payload": data},
    )
    update_job_state(
        job_uuid,
        status=status,
        progress=progress if isinstance(progress, int) else None,
        error_message=message if status == JobStatus.FAILED else None,
        metadata_patch={"last_stage": stage, "last_message": message},
    )
    queue_events_total.labels(queue=SETTINGS.queue_status).inc()


def _handle_worker_heartbeat(payload: dict) -> None:
    worker_id = str(payload.get("worker_id", "")).strip()
    worker_role = str(payload.get("worker_role", "unknown")).strip()
    status = str(payload.get("status", "unknown")).strip()
    if not worker_id:
        return

    current_job_id = payload.get("current_job_id")
    message = payload.get("message")
    queue_depth = payload.get("queue_depth")
    host = payload.get("host")

    current_job_uuid = None
    if current_job_id:
        try:
            current_job_uuid = UUID(str(current_job_id))
        except ValueError:
            current_job_uuid = None

    upsert_worker_heartbeat(
        worker_id=worker_id,
        worker_role=worker_role,
        status=status,
        current_job_id=current_job_uuid,
        message=message,
        queue_depth=queue_depth if isinstance(queue_depth, int) else None,
        host=host,
    )
    append_worker_heartbeat_event(
        worker_id=worker_id,
        worker_role=worker_role,
        status=status,
        current_job_id=current_job_uuid,
        message=message,
        queue_depth=queue_depth if isinstance(queue_depth, int) else None,
        payload=payload,
    )
    queue_events_total.labels(queue=SETTINGS.queue_worker_heartbeat).inc()


def run() -> None:
    start_http_server(int(os.getenv("METRICS_PORT", "9103")))
    ensure_schema()
    log.info("Status aggregator started")
    heartbeat_thread = threading.Thread(
        target=consume_json,
        kwargs={"queue": SETTINGS.queue_worker_heartbeat, "handler": _handle_worker_heartbeat, "prefetch_count": 20},
        daemon=True,
    )
    heartbeat_thread.start()
    consume_json(SETTINGS.queue_status, _handle, prefetch_count=10)

