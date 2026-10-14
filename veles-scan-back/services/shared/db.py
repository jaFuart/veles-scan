from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, Connection

from .settings import SETTINGS


_ENGINE: Engine | None = None


def get_engine() -> Engine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = create_engine(SETTINGS.postgres_dsn, pool_pre_ping=True, future=True)
    return _ENGINE


@contextmanager
def db_conn() -> Iterator[Connection]:
    conn = get_engine().connect()
    tx = conn.begin()
    try:
        yield conn
        tx.commit()
    except Exception:
        tx.rollback()
        raise
    finally:
        conn.close()


def ping_db() -> bool:
    with get_engine().connect() as conn:
        conn.execute(text("SELECT 1"))
    return True

