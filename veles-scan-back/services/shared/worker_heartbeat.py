from __future__ import annotations

import socket
import threading
import time
from uuid import UUID

from .rmq import publish_json
from .settings import SETTINGS


class WorkerHeartbeatPublisher:
    def __init__(self, worker_role: str) -> None:
        self.worker_role = worker_role
        self.worker_id = SETTINGS.worker_id
        self.host = socket.gethostname()
        self.interval_sec = max(5, SETTINGS.heartbeat_interval_sec)
        self._status = "idle"
        self._current_job_id: UUID | None = None
        self._message: str | None = "Worker started"
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def start(self) -> None:
        if not self._thread.is_alive():
            self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread.is_alive():
            self._thread.join(timeout=2)

    def set_busy(self, job_id: UUID, message: str | None = None) -> None:
        with self._lock:
            self._status = "busy"
            self._current_job_id = job_id
            self._message = message or "Processing job"

    def set_idle(self, message: str | None = None) -> None:
        with self._lock:
            self._status = "idle"
            self._current_job_id = None
            self._message = message or "Idle"

    def _build_payload(self) -> dict:
        with self._lock:
            current_job_id = self._current_job_id
            return {
                "worker_id": self.worker_id,
                "worker_role": self.worker_role,
                "status": self._status,
                "current_job_id": str(current_job_id) if current_job_id else None,
                "message": self._message,
                "host": self.host,
                "timestamp": int(time.time()),
            }

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            publish_json(SETTINGS.queue_worker_heartbeat, self._build_payload())
            self._stop_event.wait(self.interval_sec)
