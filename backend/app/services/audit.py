"""Audit-trail helper."""
from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def record_audit(
    db: Session,
    *,
    action: str,
    entity: str,
    entity_id: str | None = None,
    actor_id: uuid.UUID | None = None,
    actor_name: str | None = None,
    detail: dict[str, Any] | None = None,
) -> AuditLog:
    log = AuditLog(
        action=action,
        entity=entity,
        entity_id=entity_id,
        actor_id=actor_id,
        actor_name=actor_name,
        detail=json.dumps(detail, default=str) if detail else None,
    )
    db.add(log)
    return log
