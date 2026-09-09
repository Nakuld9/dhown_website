# Fabric photo shot list

Drop photos in this folder (`images/fabrics/`). Use the **exact filename** below —
that is how each photo gets matched to its product card. `.jpg`, `.jpeg`, `.png`
and `.heic` all work.

You don't have to shoot all 20 at once. Any fabric without a photo keeps its
current placeholder, so send them in batches as you go.

## Filenames

| File | Code | Fabric |
|---|---|---|
| `sj.jpg` | SJ | Single Jersey |
| `rb.jpg` | RB | Rib Fabric |
| `il.jpg` | IL | Interlock |
| `tv.jpg` | TV | Terry Velour |
| `sl.jpg` | SL | Single Lacoste |
| `dl.jpg` | DL | Double Lacoste |
| `pp.jpg` | PP | Polo Pique |
| `3tf.jpg` | 3TF | Three Thread Fleece |
| `ft.jpg` | FT | French Terry / Loop Terry |
| `rf.jpg` | RF | Russian Fleece |
| `ap.jpg` | AP | Antipilling |
| `wf.jpg` | WF | Waffle Knit |
| `pk.jpg` | PK | P-Knit |
| `rk.jpg` | RK | Rice Knit |
| `dk.jpg` | DK | Dot Knit |
| `mpp.jpg` | MPP | Micro-PP |
| `tk.jpg` | TK | Towel Knit |
| `fs.jpg` | FS | Feeder Stripes |
| `hc.jpg` | HC | Honeycomb |
| `fn.jpg` | FN | Fancy Structures |

## How to shoot them

A phone camera is fine. The knit structure is what buyers are looking at, so the
whole job is making the stitch pattern read clearly.

**Light** — Shoot near a window or a doorway in indirect daylight. **Do not use
flash**: it flattens the surface and kills exactly the texture you are trying to
show. Light coming from one side is better than light coming from behind you,
because the raking angle throws small shadows into the loops and makes the
structure pop. Overhead tube lights alone tend to look flat and green.

**Framing** — Lay the fabric flat on a plain surface and smooth out the wrinkles
and fold lines. Hold the phone square-on to the fabric, not at an angle. Fill the
frame with roughly a 15–20 cm square of cloth — close enough that individual
loops are visible, far enough that the pattern repeat reads. Get close by moving
the phone, not by pinch-zooming.

**Consistency** — Shoot all 20 the same way: same distance, same surface, same
light. A set that matches looks far more professional than 20 good but mismatched
photos. Doing them in one session is the easiest way to achieve this.

**Watch out for** — your own shadow or the phone's shadow falling on the fabric;
creases and fold lines; stray lint and thread ends; anything else in the frame
(hands, table edge, machine parts).

**Resolution** — Whatever your phone shoots by default is plenty. Don't shrink
them before sending; they get cropped and compressed automatically.

## What happens next

Everything below is automatic — run `python tools/build-fabric-photos.py`:

- centre-cropped to square and resized to 900×900
- compressed to web-sized progressive JPEG (typically 60–110 KB each)
- product cards on `index.html` and `products.html` repointed from the SVG
  placeholder to the real photo
- `alt` text set per fabric
- fabrics without a photo left on their placeholder, untouched
