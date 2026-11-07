"""Initial schema baseline.

This baseline creates the full Stage 1 schema from the application's ORM
metadata, so the models remain the single source of truth. Subsequent changes
are generated with ``alembic revision --autogenerate`` and will emit explicit
``op.*`` operations.

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-07
"""
from alembic import op

from app.models import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
