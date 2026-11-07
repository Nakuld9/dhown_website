"""FastAPI application entrypoint."""
from __future__ import annotations

from fastapi import FastAPI

from app.api.routes import accounts, auth, masters, operations, reports, vouchers
from app.core.config import settings

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "Integrated Textile Manufacturing ERP with a double-entry accounting "
        "engine. Stage 1 foundation: auth/RBAC, master data, chart of accounts, "
        "voucher posting engine, trial balance."
    ),
)

app.include_router(auth.router)
app.include_router(masters.router)
app.include_router(accounts.router)
app.include_router(vouchers.router)
app.include_router(reports.router)
app.include_router(operations.router)


@app.get("/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "environment": settings.environment}
