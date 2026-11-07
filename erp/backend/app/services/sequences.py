"""Gap-free document number generation."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import DocumentSequence


def next_document_number(
    db: Session,
    *,
    company_id: uuid.UUID,
    doc_type: str,
    fiscal_year: str,
    prefix: str = "",
    padding: int = 5,
) -> str:
    """Return the next formatted number for (company, doc_type, fiscal_year).

    Uses a row-level lock on supporting databases so concurrent posters don't
    collide. The number is reserved atomically within the caller's transaction.
    """
    stmt = select(DocumentSequence).where(
        DocumentSequence.company_id == company_id,
        DocumentSequence.doc_type == doc_type,
        DocumentSequence.fiscal_year == fiscal_year,
    )
    # Lock the row where the dialect supports it (PostgreSQL). Harmless on SQLite.
    if db.bind is not None and db.bind.dialect.name != "sqlite":
        stmt = stmt.with_for_update()

    seq = db.execute(stmt).scalar_one_or_none()
    if seq is None:
        seq = DocumentSequence(
            company_id=company_id,
            doc_type=doc_type,
            fiscal_year=fiscal_year,
            prefix=prefix,
            next_number=1,
            padding=padding,
        )
        db.add(seq)
        db.flush()

    number = seq.next_number
    seq.next_number = number + 1
    db.flush()

    fy_suffix = fiscal_year.replace("-", "")[2:6] if "-" in fiscal_year else fiscal_year
    body = str(number).zfill(seq.padding or padding)
    pfx = seq.prefix or prefix
    return f"{pfx}{fy_suffix}-{body}" if pfx else f"{fy_suffix}-{body}"
