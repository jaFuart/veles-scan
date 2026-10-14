from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from urllib.parse import quote


def _env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise ValueError(f"Environment variable is required: {name}")
    return value


@dataclass(frozen=True)
class Settings:
    app_role: str = os.getenv("APP_ROLE", "api")
    app_host: str = os.getenv("APP_HOST", "0.0.0.0")
    app_port: int = int(os.getenv("APP_PORT", "8080"))

    postgres_host: str = os.getenv("POSTGRES_HOST", "localhost")
    postgres_port: int = int(os.getenv("POSTGRES_PORT", "5432"))
    postgres_db: str = os.getenv("POSTGRES_DB", "pipeline")
    postgres_user: str = os.getenv("POSTGRES_USER", "pipeline")
    postgres_password: str = os.getenv("POSTGRES_PASSWORD", "pipeline")

    rabbitmq_host: str = os.getenv("RABBITMQ_HOST", "localhost")
    rabbitmq_port: int = int(os.getenv("RABBITMQ_PORT", "5672"))
    rabbitmq_user: str = os.getenv("RABBITMQ_USER", "pipeline")
    rabbitmq_password: str = os.getenv("RABBITMQ_PASSWORD", "pipeline")
    rabbitmq_vhost: str = os.getenv("RABBITMQ_VHOST", "/")
    rabbitmq_exchange: str = os.getenv("RABBITMQ_EXCHANGE", "jobs.exchange")
    rabbitmq_dlx: str = os.getenv("RABBITMQ_DLX", "jobs.dlx")
    rabbitmq_heartbeat_sec: int = int(os.getenv("RABBITMQ_HEARTBEAT_SEC", "0"))
    rabbitmq_blocked_connection_timeout_sec: int = int(os.getenv("RABBITMQ_BLOCKED_CONNECTION_TIMEOUT_SEC", "0"))
    queue_pipeline: str = os.getenv("QUEUE_PIPELINE", "jobs.pipeline.run")
    queue_checko: str = os.getenv("QUEUE_CHECKO", "jobs.checko.refresh")
    queue_status: str = os.getenv("QUEUE_STATUS", "jobs.status.events")
    queue_worker_heartbeat: str = os.getenv("QUEUE_WORKER_HEARTBEAT", "jobs.worker.heartbeat")

    minio_endpoint: str = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    minio_access_key: str = os.getenv("MINIO_ROOT_USER", "minioadmin")
    minio_secret_key: str = os.getenv("MINIO_ROOT_PASSWORD", "minioadmin")
    minio_secure: bool = os.getenv("MINIO_SECURE", "false").lower() == "true"
    minio_bucket_jobs: str = os.getenv("MINIO_BUCKET_JOBS", "pipeline-jobs")
    minio_bucket_checko: str = os.getenv("MINIO_BUCKET_CHECKO", "checko-snapshots")

    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    openai_intent_filters_temperature: float = float(os.getenv("OPENAI_INTENT_FILTERS_TEMPERATURE", "0.25"))
    openai_proxy: str = os.getenv("OPENAI_PROXY", "")

    checko_cron: str = os.getenv("CHECKO_CRON", "0 */6 * * *")
    pipeline_artifacts_root: str = os.getenv("PIPELINE_ARTIFACTS_ROOT", "/tmp/ucp-artifacts")
    presigned_expire_sec: int = int(os.getenv("PRESIGNED_EXPIRE_SEC", "3600"))
    worker_id: str = os.getenv("WORKER_ID", f"{os.getenv('APP_ROLE', 'api')}-{socket.gethostname()}")
    heartbeat_interval_sec: int = int(os.getenv("HEARTBEAT_INTERVAL_SEC", "15"))
    log_level: str = os.getenv("LOG_LEVEL", "DEBUG")
    backend_log_dir: str = os.getenv("BACKEND_LOG_DIR", "/tmp/ucp-artifacts/backend-logs")

    @property
    def postgres_dsn(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def rabbitmq_url(self) -> str:
        vhost = self.rabbitmq_vhost or "/"
        encoded_vhost = quote(vhost, safe="")
        return (
            f"amqp://{self.rabbitmq_user}:{self.rabbitmq_password}"
            f"@{self.rabbitmq_host}:{self.rabbitmq_port}/{encoded_vhost}"
        )


SETTINGS = Settings()

