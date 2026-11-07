"""Decimal-safe SQL column types.

Accounting rule #18/#19 (see docs/ACCOUNTING_POSTING_MATRIX.md): monetary
amounts and material quantities must NEVER be stored or computed as binary
floating point. These TypeDecorators store values as exact decimal strings and
always hand Python a ``decimal.Decimal`` back, so arithmetic is exact on both
PostgreSQL and SQLite (the latter is used for the fast local test suite).

On PostgreSQL the underlying column is NUMERIC with the right precision/scale;
on SQLite it degrades to TEXT, but round-tripping stays lossless because we
serialise with ``format(d, "f")``.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import Numeric, String
from sqlalchemy.types import TypeDecorator

MONEY_PRECISION = 18
MONEY_SCALE = 2
QTY_PRECISION = 20
QTY_SCALE = 6


def quantize(value, places: int) -> Decimal:
    """Round a value to ``places`` decimals using banker-safe HALF_UP."""
    q = Decimal(1).scaleb(-places)  # e.g. places=2 -> Decimal('0.01')
    return Decimal(str(value)).quantize(q, rounding=ROUND_HALF_UP)


class _DecimalString(TypeDecorator):
    impl = String
    cache_ok = True  # state (precision/scale) is class-level and safe to cache
    scale = 2
    precision = 18

    def load_dialect_impl(self, dialect):
        # Use native NUMERIC on real databases; exact TEXT on SQLite.
        if dialect.name == "sqlite":
            return dialect.type_descriptor(String())
        return dialect.type_descriptor(Numeric(self.precision, self.scale, asdecimal=True))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        d = quantize(value, self.scale)
        if dialect.name == "sqlite":
            return format(d, "f")
        return d

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return quantize(value, self.scale)


class Money(_DecimalString):
    """Exact monetary amount. NUMERIC(18,2) on PostgreSQL."""

    cache_ok = True
    precision = MONEY_PRECISION
    scale = MONEY_SCALE


class Quantity(_DecimalString):
    """Exact material quantity. NUMERIC(20,6) on PostgreSQL.

    Six decimals so that e.g. grams-per-kg recipe scaling and litres of liquor
    stay precise.
    """

    cache_ok = True
    precision = QTY_PRECISION
    scale = QTY_SCALE
