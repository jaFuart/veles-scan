from __future__ import annotations

import os
import time
from pathlib import Path

import requests


API_URL = os.getenv("UCP_API_URL", "http://localhost:8080")


def check_health() -> None:
    r = requests.get(f"{API_URL}/health", timeout=10)
    r.raise_for_status()
    assert r.json().get("status") == "ok"


def smoke_submit_job() -> None:
    sample = Path(__file__).resolve().parent / "fixtures" / "sample_input.xlsx"
    if not sample.exists():
        print("[SMOKE] sample_input.xlsx is missing; skip job submit smoke.")
        return

    with sample.open("rb") as f:
        up = requests.post(
            f"{API_URL}/jobs/upload-input",
            files={"file": ("sample_input.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            timeout=30,
        )
    up.raise_for_status()
    upload_json = up.json()

    submit = requests.post(
        f"{API_URL}/jobs",
        json={
            "job_type": "enrich_only",
            "input_bucket": upload_json["bucket"],
            "input_key": upload_json["key"],
            "metadata": {"source": "smoke"},
        },
        timeout=15,
    )
    submit.raise_for_status()
    job_id = submit.json()["job_id"]

    for _ in range(10):
        status = requests.get(f"{API_URL}/jobs/{job_id}", timeout=10)
        status.raise_for_status()
        state = status.json()["status"]
        if state in ("failed", "completed"):
            break
        time.sleep(2)
    print(f"[SMOKE] Job {job_id} state={state}")


def main() -> None:
    check_health()
    smoke_submit_job()
    print("[SMOKE] OK")


if __name__ == "__main__":
    main()

