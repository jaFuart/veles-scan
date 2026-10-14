from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

import pika
from pika.adapters.blocking_connection import BlockingChannel
from tenacity import retry, stop_after_attempt, wait_exponential

from .metrics import queue_events_total
from .settings import SETTINGS


def _connect() -> pika.BlockingConnection:
    creds = pika.PlainCredentials(SETTINGS.rabbitmq_user, SETTINGS.rabbitmq_password)
    heartbeat = max(0, int(SETTINGS.rabbitmq_heartbeat_sec))
    blocked_timeout_raw = int(SETTINGS.rabbitmq_blocked_connection_timeout_sec)
    blocked_timeout = blocked_timeout_raw if blocked_timeout_raw > 0 else None
    params = pika.ConnectionParameters(
        host=SETTINGS.rabbitmq_host,
        port=SETTINGS.rabbitmq_port,
        virtual_host=SETTINGS.rabbitmq_vhost,
        credentials=creds,
        heartbeat=heartbeat,
        blocked_connection_timeout=blocked_timeout,
    )
    return pika.BlockingConnection(params)


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=1, max=10), reraise=True)
def publish_json(routing_key: str, payload: dict[str, Any], exchange: str | None = None) -> None:
    exchange_name = exchange or SETTINGS.rabbitmq_exchange
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    conn: pika.BlockingConnection | None = None
    try:
        conn = _connect()
        channel = conn.channel()
        # Ensure direct-target queue exists before publishing with routing_key.
        channel.queue_declare(queue=routing_key, durable=True)
        if exchange_name:
            channel.exchange_declare(exchange=exchange_name, exchange_type="direct", durable=True)
            channel.queue_bind(queue=routing_key, exchange=exchange_name, routing_key=routing_key)
        channel.basic_publish(
            exchange=exchange_name,
            routing_key=routing_key,
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,
                content_type="application/json",
            ),
            mandatory=False,
        )
        queue_events_total.labels(queue=routing_key).inc()
    finally:
        if conn and conn.is_open:
            conn.close()


def consume_json(queue: str, handler: Callable[[dict[str, Any]], None], prefetch_count: int = 1) -> None:
    while True:
        conn: pika.BlockingConnection | None = None
        try:
            conn = _connect()
            channel: BlockingChannel = conn.channel()
            channel.basic_qos(prefetch_count=prefetch_count)
            # Create queue on startup if it does not exist yet.
            channel.queue_declare(queue=queue, durable=True)

            def _on_message(ch: BlockingChannel, method, properties, body: bytes):
                payload = json.loads(body.decode("utf-8"))
                try:
                    handler(payload)
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except Exception:
                    # reject to DLQ
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

            channel.basic_consume(queue=queue, on_message_callback=_on_message, auto_ack=False)
            channel.start_consuming()
        except KeyboardInterrupt:
            raise
        except Exception:
            time.sleep(2)
        finally:
            if conn and conn.is_open:
                conn.close()


def get_queue_depth(queue: str) -> int:
    conn: pika.BlockingConnection | None = None
    try:
        conn = _connect()
        channel: BlockingChannel = conn.channel()
        result = channel.queue_declare(queue=queue, passive=True)
        return int(result.method.message_count)
    except Exception:
        return -1
    finally:
        if conn and conn.is_open:
            conn.close()

