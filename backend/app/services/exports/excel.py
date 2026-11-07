"""Render a ReportDoc to an .xlsx workbook (bytes)."""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from app.services.exports.document import ReportDoc, Summary, Table, as_float, is_number

_MONEY_FMT = "#,##0.00"
_HEADER_FILL = PatternFill("solid", fgColor="1E293B")  # dark navy
_HEADER_FONT = Font(color="FFFFFF", bold=True)
_TITLE_FONT = Font(size=14, bold=True)
_TOTAL_FONT = Font(bold=True)
_THIN = Side(style="thin", color="D1D5DB")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)


def render_excel(doc: ReportDoc) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Report"
    r = 1

    ws.cell(r, 1, doc.title).font = _TITLE_FONT
    r += 1
    if doc.subtitle:
        ws.cell(r, 1, doc.subtitle).font = Font(italic=True, color="6B7280")
        r += 1
    r += 1

    max_cols = 1
    for block in doc.blocks:
        if isinstance(block, Table):
            ws.cell(r, 1, block.heading).font = _TOTAL_FONT
            r += 1
            # header
            for c, col in enumerate(block.columns, start=1):
                cell = ws.cell(r, c, col.label)
                cell.fill = _HEADER_FILL
                cell.font = _HEADER_FONT
                cell.border = _BORDER
            max_cols = max(max_cols, len(block.columns))
            r += 1
            # data
            for row in block.rows:
                for c, col in enumerate(block.columns, start=1):
                    val = row.get(col.key)
                    cell = ws.cell(r, c, as_float(val) if col.numeric and is_number(val) else val)
                    cell.border = _BORDER
                    if col.numeric:
                        cell.number_format = _MONEY_FMT
                        cell.alignment = Alignment(horizontal="right")
                r += 1
            # totals
            if block.total_row is not None:
                for c, col in enumerate(block.columns, start=1):
                    val = block.total_row.get(col.key, "" if c > 1 else "Total")
                    cell = ws.cell(r, c, as_float(val) if col.numeric and is_number(val) else val)
                    cell.font = _TOTAL_FONT
                    cell.border = _BORDER
                    if col.numeric:
                        cell.number_format = _MONEY_FMT
                        cell.alignment = Alignment(horizontal="right")
                r += 1
            r += 1
        elif isinstance(block, Summary):
            ws.cell(r, 1, block.heading).font = _TOTAL_FONT
            r += 1
            for label, value in block.items:
                ws.cell(r, 1, label)
                cell = ws.cell(r, 2, as_float(value) if is_number(value) else value)
                if is_number(value):
                    cell.number_format = _MONEY_FMT
                    cell.alignment = Alignment(horizontal="right")
                r += 1
            max_cols = max(max_cols, 2)
            r += 1

    # Column widths
    ws.column_dimensions["A"].width = 32
    for i in range(2, max_cols + 1):
        ws.column_dimensions[chr(64 + i)].width = 18

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
