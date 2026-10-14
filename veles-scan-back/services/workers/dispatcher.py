from __future__ import annotations

from services.shared.settings import SETTINGS
from services.workers.checko_worker import run as run_checko
from services.workers.pipeline_worker import run as run_pipeline
from services.workers.status_aggregator import run as run_status


def main() -> None:
    role = SETTINGS.app_role
    if role == "pipeline_worker":
        run_pipeline()
        return
    if role == "checko_worker":
        run_checko()
        return
    if role == "status_aggregator":
        run_status()
        return
    raise ValueError(
        "Unsupported APP_ROLE for worker dispatcher. "
        "Expected one of: pipeline_worker, checko_worker, status_aggregator"
    )


if __name__ == "__main__":
    main()

