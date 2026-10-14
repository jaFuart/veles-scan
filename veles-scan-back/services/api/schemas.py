from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from services.shared.models import JobStatus, JobType


class CreateJobRequest(BaseModel):
    job_type: JobType = Field(default=JobType.ENRICH_ONLY)
    input_bucket: str
    input_key: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class JobResponse(BaseModel):
    id: UUID
    job_type: JobType
    status: JobStatus
    input_bucket: str | None = None
    input_key: str | None = None
    result_bucket: str | None = None
    result_key: str | None = None
    progress: int = 0
    error_message: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CreateJobResponse(BaseModel):
    job_id: UUID
    status: JobStatus


class UploadInputResponse(BaseModel):
    bucket: str
    key: str
    size_bytes: int


class ResultResponse(BaseModel):
    job_id: UUID
    status: JobStatus
    result_bucket: str | None = None
    result_key: str | None = None
    download_url: str | None = None


class CancelJobResponse(BaseModel):
    job_id: UUID
    status: JobStatus
    message: str


class CreateIntentJobRequest(BaseModel):
    intent: str = Field(min_length=3, description="User intent in free form text")
    max_okved_codes: int = Field(default=30, ge=1, le=200)
    response_format: str | None = Field(default=None, description="Requested output columns in free form")
    max_output_fields: int = Field(default=20, ge=1, le=50)
    use_cached_resolution: bool = Field(default=False)
    resolved_okved_codes: list[str] = Field(default_factory=list)
    resolved_output_fields: list[dict[str, str]] = Field(default_factory=list)
    resolved_data_filters: list[dict[str, Any]] = Field(default_factory=list)


class CreateIntentJobResponse(BaseModel):
    job_id: UUID
    status: JobStatus
    resolved_okved_codes: list[str] = Field(default_factory=list)
    resolver_source: str
    available_okved_count: int
    resolved_output_fields: list[dict[str, str]] = Field(default_factory=list)
    output_fields_source: str | None = None
    resolved_data_filters: list[dict[str, Any]] = Field(default_factory=list)
    ignored_intent_conditions: list[str] = Field(default_factory=list)
    data_filters_source: str | None = None
    warning: str | None = None


class IntentPreviewResponse(BaseModel):
    resolved_okved_codes: list[str] = Field(default_factory=list)
    resolver_source: str
    available_okved_count: int
    resolved_output_fields: list[dict[str, str]] = Field(default_factory=list)
    output_fields_source: str | None = None
    resolved_data_filters: list[dict[str, Any]] = Field(default_factory=list)
    ignored_intent_conditions: list[str] = Field(default_factory=list)
    data_filters_source: str | None = None
    warning: str | None = None


class PriceEstimateRequest(BaseModel):
    base_price_rub: int = Field(ge=0)
    response_format: str | None = None
    resolved_output_fields: list[dict[str, str]] = Field(default_factory=list)
    resolved_data_filters: list[dict[str, Any]] = Field(default_factory=list)
    resolved_okved_codes: list[str] = Field(default_factory=list)
    previous_price_rub: int | None = Field(default=None, ge=0)
    previous_prompt: str | None = None
    previous_reasoning_short: str | None = None
    previous_reasoning_details: list[str] = Field(default_factory=list)
    min_delta_rub: int = Field(default=25, ge=0)


class PriceEstimateResponse(BaseModel):
    estimated_price_rub: int
    pricing_source: str
    pricing_model: str | None = None
    pricing_reason_short: str
    pricing_reason_details: list[str] = Field(default_factory=list)
    pricing_prompt: str
    pricing_prompt_hash: str
    input_signature: str


class WorkerHeartbeatResponse(BaseModel):
    worker_id: str
    worker_role: str
    status: str
    current_job_id: UUID | None = None
    message: str | None = None
    queue_depth: int | None = None
    host: str | None = None
    updated_at: datetime


class SystemWorkersResponse(BaseModel):
    workers: list[WorkerHeartbeatResponse] = Field(default_factory=list)
    queue_depths: dict[str, int] = Field(default_factory=dict)
    workers_total: int
    workers_busy: int
    workers_idle: int

