"""Render a ReportDoc to a PDF (bytes) using reportlab."""
from __future__ import annotations

import io
from decimal import Decimal

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table as RLTable, TableStyle

from app.services.exports.document import ReportDoc, Summary, Table, is_number

_NAVY = colors.HexColor("#1E293B")
_GREY = colors.HexColor("#6B7280")
_LINE = colors.HexColor("#D1D5DB")


def _fmt(value, numeric: bool) -> str:
    if value is None:
        return ""
    if numeric and is_number(value):
        return f"{Decimal(str(value)):,.2f}"
    return str(value)


def render_pdf(doc: ReportDoc) -> bytes:
    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=landscape(A4), topMargin=15 * mm, bottomMargin=15 * mm,
                            leftMargin=12 * mm, rightMargin=12 * mm, title=doc.title)
    styles = getSampleStyleSheet()
    story = [Paragraph(doc.title, styles["Title"])]
    if doc.subtitle:
        sub = styles["Normal"].clone("sub"); sub.textColor = _GREY
        story.append(Paragraph(doc.subtitle, sub))
    story.append(Spacer(1, 6 * mm))

    for block in doc.blocks:
        if isinstance(block, Table):
            story.append(Paragraph(block.heading, styles["Heading3"]))
            data = [[c.label for c in block.columns]]
            for row in block.rows:
                data.append([_fmt(row.get(c.key), c.numeric) for c in block.columns])
            if block.total_row is not None:
                data.append([
                    _fmt(block.total_row.get(c.key, "Total" if i == 0 else ""), c.numeric)
                    for i, c in enumerate(block.columns)
                ])
            tbl = RLTable(data, repeatRows=1)
            style = [
                ("BACKGROUND", (0, 0), (-1, 0), _NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, _LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ]
            # right-align numeric columns
            for i, c in enumerate(block.columns):
                if c.numeric:
                    style.append(("ALIGN", (i, 0), (i, -1), "RIGHT"))
            if block.total_row is not None:
                style.append(("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"))
                style.append(("LINEABOVE", (0, -1), (-1, -1), 0.6, _NAVY))
            tbl.setStyle(TableStyle(style))
            story.append(tbl)
            story.append(Spacer(1, 6 * mm))
        elif isinstance(block, Summary):
            story.append(Paragraph(block.heading, styles["Heading3"]))
            data = [[label, _fmt(value, is_number(value))] for label, value in block.items]
            tbl = RLTable(data, colWidths=[90 * mm, 50 * mm])
            tbl.setStyle(TableStyle([
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.3, _LINE),
            ]))
            story.append(tbl)
            story.append(Spacer(1, 6 * mm))

    pdf.build(story)
    return buf.getvalue()
