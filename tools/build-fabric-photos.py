"""Turn raw fabric photos into web assets and wire them into the product cards.

Drop photos in images/fabrics/ named by fabric code (sj.jpg, 3tf.jpg, ...) —
see images/fabrics/SHOOT-LIST.md — then run:

    python tools/build-fabric-photos.py

Idempotent: safe to re-run as more photos arrive. Fabrics with no photo keep
their SVG placeholder.
"""
from __future__ import annotations

import io
import os
import re
import sys

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is required:  pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "images", "fabrics")
OUT = os.path.join(ROOT, "images")
PAGES = ["index.html", "products.html"]

SIZE = 900
QUALITY = 82
EXTS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".tif", ".tiff")

# code -> (slug used by images/fabric-<slug>.svg, display name)
FABRICS = {
    "sj": "Single Jersey",           "rb": "Rib Fabric",
    "il": "Interlock",               "tv": "Terry Velour",
    "sl": "Single Lacoste",          "dl": "Double Lacoste",
    "pp": "Polo Pique",              "3tf": "Three Thread Fleece",
    "ft": "French Terry",            "rf": "Russian Fleece",
    "ap": "Antipilling",             "wf": "Waffle Knit",
    "pk": "P-Knit",                  "rk": "Rice Knit",
    "dk": "Dot Knit",                "mpp": "Micro-PP",
    "tk": "Towel Knit",              "fs": "Feeder Stripes",
    "hc": "Honeycomb",               "fn": "Fancy Structures",
}


def find_raw() -> dict[str, str]:
    """Map fabric code -> raw photo path, for photos that exist."""
    found = {}
    if not os.path.isdir(RAW):
        return found
    for fn in sorted(os.listdir(RAW)):
        stem, ext = os.path.splitext(fn)
        if ext.lower() not in EXTS:
            continue
        code = stem.lower().strip()
        if code in FABRICS:
            found[code] = os.path.join(RAW, fn)
        else:
            print(f"  ?  {fn}: '{code}' is not a known fabric code, skipped")
    return found


def process(src: str, dst: str) -> str:
    im = Image.open(src)
    im = ImageOps.exif_transpose(im)           # honour phone orientation
    im = im.convert("RGB")
    im = ImageOps.fit(im, (SIZE, SIZE), Image.LANCZOS, centering=(0.5, 0.5))
    im.save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    return f"{os.path.getsize(dst) / 1024:.0f} KB"


def rewrite(code: str, html: str) -> tuple[str, int]:
    """Point this fabric's <img> at the photo instead of the placeholder."""
    name = FABRICS[code]
    pat = re.compile(
        r'(<img\s+src=")images/fabric-' + re.escape(code) + r'\.svg("[^>]*?\salt=")[^"]*(")',
        re.I)
    alt = f"{name} knitted fabric close-up — DHOWN Hosiery Mills, Ludhiana"
    html, n = pat.subn(rf'\1images/fabric-{code}.jpg\g<2>{alt}\3', html)

    # Real photos are heavy where the placeholders were not, so defer them.
    # .product-img is absolutely positioned and fills its card, so there is
    # no layout shift to guard against.
    tag = re.compile(r'<img src="images/fabric-' + re.escape(code)
                     + r'\.jpg"(?![^>]*loading=)([^>]*?)>')
    html = tag.sub(rf'<img src="images/fabric-{code}.jpg" '
                   rf'loading="lazy" decoding="async"\1>', html)
    return html, n


def main() -> int:
    raw = find_raw()
    if not raw:
        print(f"No fabric photos found in {os.path.relpath(RAW, ROOT)}")
        print("Add photos named by fabric code — see SHOOT-LIST.md in that folder.")
        return 0

    print(f"Processing {len(raw)} photo(s) -> {SIZE}x{SIZE}\n")
    built = []
    for code, src in raw.items():
        dst = os.path.join(OUT, f"fabric-{code}.jpg")
        try:
            size = process(src, dst)
        except Exception as exc:                      # noqa: BLE001
            print(f"  !  {code}: {exc}")
            continue
        built.append(code)
        print(f"  ok {code:4} {FABRICS[code]:24} {size}")

    if not built:
        return 1

    print()
    for page in PAGES:
        p = os.path.join(ROOT, page)
        s = io.open(p, encoding="utf-8").read()
        total = 0
        for code in built:
            s, n = rewrite(code, s)
            total += n
        io.open(p, "w", encoding="utf-8", newline="\n").write(s)
        print(f"  {page:16} {total} card(s) repointed to photos")

    missing = [c for c in FABRICS if c not in built]
    print(f"\n{len(built)} of {len(FABRICS)} fabrics now have real photos.")
    if missing:
        print("Still on placeholders: " + ", ".join(sorted(missing)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
