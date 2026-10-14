from __future__ import annotations

import mimetypes
from pathlib import Path

import boto3
from botocore.client import BaseClient
from botocore.exceptions import ClientError
from tenacity import retry, stop_after_attempt, wait_exponential

from .settings import SETTINGS


_CLIENT: BaseClient | None = None


def get_s3_client() -> BaseClient:
    global _CLIENT
    if _CLIENT is None:
        endpoint = SETTINGS.minio_endpoint
        scheme = "https" if SETTINGS.minio_secure else "http"
        _CLIENT = boto3.client(
            "s3",
            endpoint_url=f"{scheme}://{endpoint}",
            aws_access_key_id=SETTINGS.minio_access_key,
            aws_secret_access_key=SETTINGS.minio_secret_key,
            region_name="us-east-1",
        )
    return _CLIENT


def ensure_bucket(bucket_name: str) -> None:
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=bucket_name)
    except ClientError:
        client.create_bucket(Bucket=bucket_name)


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=1, max=10), reraise=True)
def upload_file(local_path: Path, bucket: str, key: str) -> None:
    client = get_s3_client()
    content_type, _ = mimetypes.guess_type(str(local_path))
    extra = {"ContentType": content_type} if content_type else {}
    client.upload_file(str(local_path), bucket, key, ExtraArgs=extra)


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=1, max=10), reraise=True)
def download_file(bucket: str, key: str, local_path: Path) -> None:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    get_s3_client().download_file(bucket, key, str(local_path))


def create_presigned_url(bucket: str, key: str, expire_seconds: int | None = None) -> str:
    seconds = expire_seconds or SETTINGS.presigned_expire_sec
    return get_s3_client().generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=seconds,
    )


def list_keys(bucket: str, prefix: str) -> list[str]:
    client = get_s3_client()
    paginator = client.get_paginator("list_objects_v2")
    keys: list[str] = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            key = item.get("Key")
            if key:
                keys.append(key)
    return keys

