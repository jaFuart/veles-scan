from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .settings import SETTINGS


_LOGRECORD_STANDARD_FIELDS = set(logging.makeLogRecord({}).__dict__.keys())


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Keep compatibility with existing explicitly-used fields.
        for field in ("job_id", "stage", "service", "event"):
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value

        # Also include every custom field provided through logger(..., extra={...}).
        for key, value in record.__dict__.items():
            if key in _LOGRECORD_STANDARD_FIELDS:
                continue
            if key in payload:
                continue
            if value is None:
                continue
            payload[key] = value

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _resolve_level(name: str) -> int:
    normalized = (name or "INFO").strip().upper()
    return getattr(logging, normalized, logging.INFO)


def setup_logging(level: int | None = None) -> None:
    resolved_level = level if level is not None else _resolve_level(SETTINGS.log_level)
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(JsonFormatter())

    log_dir = Path(SETTINGS.backend_log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(log_dir / f"{SETTINGS.app_role}.log", encoding="utf-8")
    file_handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [stream_handler, file_handler]
    root.setLevel(resolved_level)

