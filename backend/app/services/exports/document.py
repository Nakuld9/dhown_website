"""A backend-agnostic report document.

A ReportDoc is a title, a subtitle, and a list of blocks (Table or Summary).
Both the Excel and PDF renderers consume this same structure, so every report
is described once and exported to either format.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal


@dataclass
class Column:
    label: str
    key: str
    numeric: bool = False


@dataclass
class Table:
    heading: str
    columns: list[Column]
    rows: list[dict]
    total_row: dict | None = None  # keyed by column key


@dataclass
class Summary:
    heading: str
    items: list[tuple[str, object]]  # (label, value)


@dataclass
class ReportDoc:
    title: str
    subtitle: str = ""
    blocks: list = field(default_factory=list)


def is_number(value) -> bool:
    return isinstance(value, (int, float, Decimal))


def as_float(value):
    if isinstance(value, Decimal):
        return float(value)
    return value
