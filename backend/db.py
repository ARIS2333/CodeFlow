"""Database engine, session scope, and Flask integration.

The engine is created lazily so that importing this module — or running the
existing test suite — never requires a live database.  Nothing in the app
touches the database until a feature actually asks for a session, which keeps
`DATABASE_URL` optional for contributors working only on the model endpoints.
"""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, scoped_session, sessionmaker


class Base(DeclarativeBase):
    """Declarative base shared by every model, and Alembic's autogenerate target."""


class DatabaseNotConfigured(RuntimeError):
    """Raised when a database-backed feature runs without DATABASE_URL set."""


def normalize_database_url(url: str) -> str:
    """Point SQLAlchemy at psycopg 3.

    Render's `connectionString` is a bare `postgresql://` URL, which SQLAlchemy
    resolves to the psycopg2 driver we do not install.  Rewriting the driver
    here keeps the Render blueprint and `.env` free of SQLAlchemy-specific
    syntax.
    """
    parsed = make_url(url)
    if parsed.drivername in ("postgres", "postgresql"):
        parsed = parsed.set(drivername="postgresql+psycopg")
    return parsed.render_as_string(hide_password=False)


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from error


def create_database_engine(url: str) -> Engine:
    """Build the engine with a pool bounded well below the instance's limit.

    Gunicorn runs WEB_CONCURRENCY processes with GUNICORN_THREADS threads each,
    so an unbounded pool could open a connection per thread and exhaust the 100
    connections a Basic Postgres instance allows.  Requests spend nearly all
    their time streaming from the model provider rather than holding a
    connection, so a small pool per worker is enough; see DEPLOYMENT.md before
    raising these.
    """
    return create_engine(
        normalize_database_url(url),
        pool_size=_int_env("DB_POOL_SIZE", 5),
        max_overflow=_int_env("DB_MAX_OVERFLOW", 5),
        # Render recycles idle server connections and restarts instances for
        # maintenance; check the connection instead of failing the request.
        pool_pre_ping=True,
        pool_recycle=300,
        future=True,
    )


_engine: Engine | None = None
_session_bound = False
# Worker threads reach these lazy initializers concurrently; build the engine
# and bind the sessionmaker exactly once per process.
_init_lock = threading.Lock()


def get_engine() -> Engine:
    global _engine
    with _init_lock:
        if _engine is None:
            url = os.getenv("DATABASE_URL", "").strip()
            if not url:
                raise DatabaseNotConfigured(
                    "DATABASE_URL is not set. Add the Render Postgres "
                    "connection string (see backend/.env.example) before "
                    "using a database-backed feature."
                )
            _engine = create_database_engine(url)
        return _engine


# scoped_session keys sessions to the current thread, which matches Gunicorn's
# gthread workers: each concurrent request gets its own session, returned to the
# pool by the teardown below.
db_session = scoped_session(
    sessionmaker(autocommit=False, autoflush=False, future=True)
)


def _bind_session() -> None:
    """Bind the sessionmaker to the engine on first use.

    Tracked with a flag rather than by reading `db_session.bind`, because
    attribute access on a scoped_session proxies to — and therefore creates —
    a Session for the calling thread.
    """
    global _session_bound
    engine = get_engine()
    with _init_lock:
        if not _session_bound:
            db_session.configure(bind=engine)
            _session_bound = True


@contextmanager
def session_scope():
    """Transactional scope for code outside a Flask request (CLI, scripts)."""
    _bind_session()
    session = db_session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        db_session.remove()


def get_session():
    """Session for the current request; released by the app teardown hook."""
    _bind_session()
    return db_session()


def init_app(app) -> None:
    """Return each request's session to the pool, even when the view raised."""

    @app.teardown_appcontext
    def remove_session(_exception=None):
        db_session.remove()


def dispose_engine() -> None:
    """Drop pooled connections (used by tests and by forking entry points)."""
    global _engine, _session_bound
    db_session.remove()
    with _init_lock:
        if _engine is not None:
            _engine.dispose()
            _engine = None
        _session_bound = False
