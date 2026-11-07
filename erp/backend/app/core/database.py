"""Database engine, session factory and FastAPI dependency."""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def _make_engine(url: str) -> Engine:
    connect_args = {}
    kwargs: dict = {"future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        # Single shared in-memory DB across sessions during tests.
        from sqlalchemy.pool import StaticPool

        kwargs["poolclass"] = StaticPool
        kwargs.pop("pool_pre_ping", None)
    return create_engine(url, connect_args=connect_args, **kwargs)


engine = _make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):  # pragma: no cover - sqlite only
    # Enforce foreign keys on SQLite (off by default) so constraint tests are meaningful.
    module = type(dbapi_connection).__module__
    if "sqlite3" in module:
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a transactional session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
