from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4


class JobType(str, Enum):
    ENRICH_ONLY = "enrich_only"
    CHECKO_REFRESH_AND_ENRICH = "checko_refresh_and_enrich"
    CHECKO_REFRESH = "checko_refresh"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class JobRecord:
    id: UUID
    job_type: JobType
    status: JobStatus
    input_bucket: str | None = None
    input_key: str | None = None
    result_bucket: str | None = None
    result_key: str | None = None
    progress: int = 0
    error_message: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @staticmethod
    def new(job_type: JobType, input_bucket: str | None, input_key: str | None, metadata: dict[str, Any] | None = None) -> "JobRecord":
        return JobRecord(
            id=uuid4(),
            job_type=job_type,
            status=JobStatus.QUEUED,
            input_bucket=input_bucket,
            input_key=input_key,
            metadata=metadata or {},
        )


@dataclass
class StatusEvent:
    job_id: str
    status: JobStatus
    stage: str | None = None
    progress: int | None = None
    message: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)

