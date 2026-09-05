"""SQLAlchemy models.

Every model must be imported (directly or transitively) from this module:
`migrations/env.py` imports it so that `alembic revision --autogenerate` sees
the full schema, and a table that is not registered on `Base.metadata` here is
silently missing from generated migrations.

No tables are defined yet — the user, problem, and session schema lands with
the authentication work described in DEPLOYMENT.md.
"""

from __future__ import annotations

from db import Base

__all__ = ["Base"]
