"""Color Service dispensing integration (adapters + simulator + ingest).

PENDING VENDOR VERIFICATION: the live adapter must be validated against the
installed Color Service Supervisor interface. The simulator lets development and
tests run without vendor hardware. See docs/COLOR_SERVICE_INTEGRATION.md.
"""
from app.services.colorservice.schemas import (  # noqa: F401
    DispenseResult,
    DoseOrder,
    DoseOrderMaterial,
)
from app.services.colorservice.adapter import (  # noqa: F401
    ColorServiceAdapter,
    ColorServiceSimulator,
)
