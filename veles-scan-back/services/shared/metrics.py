from __future__ import annotations

from prometheus_client import Counter, Histogram


jobs_processed_total = Counter(
    "ucp_jobs_processed_total",
    "Count of processed jobs by status",
    ["worker", "status"],
)

stage_duration_seconds = Histogram(
    "ucp_stage_duration_seconds",
    "Duration of pipeline stages",
    ["stage"],
    buckets=(0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600),
)

queue_events_total = Counter(
    "ucp_queue_events_total",
    "Messages sent to queues",
    ["queue"],
)

