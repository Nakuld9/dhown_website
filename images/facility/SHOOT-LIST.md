# Facility photo shot list

Three photos for the "Inside Our Facility" section on the about page. Drop them
in this folder (`images/facility/`) using the **exact filename** below.

Until real photos land, that section shows a single honest tile rather than the
same machine photo repeated three times under three different labels.

| File | Appears as | Notes |
|---|---|---|
| `floor.jpg` | Knitting Floor — 18+ Circular Machines | The wide banner shot at the top. Shoot down the length of the machine line so several machines recede into the frame — this is the one that proves scale. Landscape. |
| `operations.jpg` | Machine Operations | Closer in: a machine running, yarn feeding from the creel, the fabric tube forming. An operator in frame is good — it reads as a working mill, not a showroom. |
| `dispatch.jpg` | Quality Check & Dispatch | Finished rolls stacked, weighed, wrapped or being inspected. Anything that shows output volume. |

You can send fewer than three. One photo shows as a single banner, two sit side
by side, three give the full banner-plus-two layout.

## How to shoot them

**Landscape, always.** These are wide tiles — a portrait photo gets cropped hard
top and bottom and you lose the shot.

**Light** — Mill floors are usually lit with overhead tubes, which go green and
flat on a phone. If there is a shutter, door or window, shoot with it helping
you. Do not use flash on a wide shot; it lights the nearest machine and leaves
everything behind it black.

**Steady** — Low indoor light means a slow shutter. Brace the phone against a
pillar or a machine frame. Take three or four of each and keep the sharpest.

**Composition** — Shoot from a slightly raised position if you can safely, and
down the line rather than square at one machine. Depth is what makes a floor
look big.

**Tidy the frame** — Loose waste, stray cones, buckets, a parked scooter. Thirty
seconds of clearing is worth more than any editing.

**Safety first.** Nothing here is worth leaning into a running machine for.

## What happens next

Run `python tools/build-facility-photos.py`:

- EXIF-rotated, centre-cropped to 16:9 and resized to 1600×900
- compressed to progressive JPEG
- the about-page grid regenerated to match how many photos exist
- alt text and labels set per slot
- lazy-loading applied
