from __future__ import annotations

import logging
import os
import time
from uuid import uuid4

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from prometheus_client import start_http_server

from services.api.jobs_repo import create_job, ensure_schema
from services.shared.logging_utils import setup_logging
from services.shared.models import JobRecord, JobStatus, JobType
from services.shared.rmq import publish_json
from services.shared.settings import SETTINGS
from services.shared.storage import ensure_bucket


setup_logging()
log = logging.getLogger("scheduler")


def enqueue_checko_refresh() -> None:
    job = JobRecord.new(job_type=JobType.CHECKO_REFRESH, input_bucket=None, input_key=None)
    create_job(job)
    publish_json(
        SETTINGS.queue_checko,
        {
            "job_id": str(job.id),
            "job_type": job.job_type.value,
            "metadata": {"source": "cron"},
        },
    )
    publish_json(
        SETTINGS.queue_status,
        {
            "job_id": str(job.id),
            "status": JobStatus.QUEUED.value,
            "stage": "scheduler",
            "progress": 0,
            "message": "Scheduled checko refresh",
            "payload": {"cron": SETTINGS.checko_cron},
        },
    )
    log.info("Scheduled checko job published", extra={"job_id": str(job.id)})


def main() -> None:
    start_http_server(int(os.getenv("METRICS_PORT", "9104")))
    ensure_schema()
    ensure_bucket(SETTINGS.minio_bucket_checko)
    scheduler = BlockingScheduler()
    scheduler.add_job(
        enqueue_checko_refresh,
        trigger=CronTrigger.from_crontab(SETTINGS.checko_cron),
        id=f"checko_refresh_{uuid4()}",
        replace_existing=True,
    )
    log.info("Scheduler started")
    try:
        scheduler.start()
    except KeyboardInterrupt:
        scheduler.shutdown(wait=False)
        time.sleep(0.5)


if __name__ == "__main__":
    main()

