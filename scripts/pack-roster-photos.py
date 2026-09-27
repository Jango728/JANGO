#!/usr/bin/env python3
"""
Pack the transparent roster portraits into a few JSON chunk files so the site ships
~10 files instead of ~400 (the published artifact has a file-count cap and blocks
external image hosts).

Input : a folder of <slug>.webp (transparent RGBA) + manifest.json
        ({slug: {name, source, kind: "full-body"|"headshot", transparentOriginal}})
Output: public/roster/photos-<n>.json   {slug: "data:image/webp;base64,..."}   (~600-900 KB each)
        public/roster/photos-thumbs.json {slug: "data:image/webp;base64,..."}  (small square head crops for search)
        public/roster/photos-index.json  {"chunks": N, "fighters": {slug: [chunk, "f"|"h"]}}

The chunk is chosen from the slug alone (FNV-1a hash mod N), so adding a photo never
moves the others. Deterministic: same input -> byte-identical output.

    python3 scripts/pack-roster-photos.py                      # defaults below
    python3 scripts/pack-roster-photos.py --src /path/to/photos --target-kb 750
"""
import argparse, base64, io, json, math, os, sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = "/home/claude/roster-photos"
OUT = os.path.join(ROOT, "public", "roster")
THUMB = 60  # px, square; search icons are 42 px


def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def data_uri(raw: bytes) -> str:
    return "data:image/webp;base64," + base64.b64encode(raw).decode("ascii")


def head_crop(im: Image.Image, kind: str) -> Image.Image:
    """Square crop around the head: whole image for headshots, top of the body for full-body shots."""
    im = im.convert("RGBA")
    alpha = im.getchannel("A")
    box = alpha.point(lambda a: 255 if a > 40 else 0).getbbox() or (0, 0, im.width, im.height)
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    if kind == "headshot":
        side = max(bw, bh)
        cx, top = (x0 + x1) / 2, y0
    else:
        side = max(24, int(bh * 0.30))
        # Head centre: alpha-weighted column centroid of the top 12% of the figure.
        band = alpha.crop((x0, y0, x1, y0 + max(4, int(bh * 0.12))))
        cols = [0] * band.width
        px = band.load()
        for x in range(band.width):
            cols[x] = sum(px[x, y] for y in range(band.height))
        total = sum(cols) or 1
        cx = x0 + sum(i * c for i, c in enumerate(cols)) / total
        top = y0 - int(side * 0.06)
    left = int(round(cx - side / 2))
    crop = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    crop.paste(im.crop((left, top, left + side, top + side)), (0, 0))
    return crop.resize((THUMB, THUMB), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--target-kb", type=int, default=750, help="average chunk size to aim for")
    args = ap.parse_args()

    manifest = json.load(open(os.path.join(args.src, "manifest.json"), encoding="utf-8"))
    slugs = sorted(s for s in manifest if os.path.exists(os.path.join(args.src, s + ".webp")))
    missing = sorted(set(manifest) - set(slugs))
    if missing:
        print(f"manifest entries without a file (skipped): {missing}", file=sys.stderr)

    full, thumbs = {}, {}
    for s in slugs:
        raw = open(os.path.join(args.src, s + ".webp"), "rb").read()
        im = Image.open(io.BytesIO(raw))
        if im.mode not in ("RGBA", "LA") and "transparency" not in im.info:
            print(f"not transparent, skipped: {s}", file=sys.stderr)
            continue
        full[s] = data_uri(raw)
        buf = io.BytesIO()
        head_crop(im, manifest[s].get("kind", "full-body")).save(buf, "WEBP", quality=62, method=6)
        thumbs[s] = data_uri(buf.getvalue())

    total = sum(len(v) for v in full.values())
    n = max(1, math.ceil(total / (args.target_kb * 1024)))
    chunks = [dict() for _ in range(n)]
    index = {}
    for s in sorted(full):
        c = fnv1a(s) % n
        chunks[c][s] = full[s]
        index[s] = [c, "h" if manifest[s].get("kind") == "headshot" else "f"]

    # Clear old chunk files first so a smaller N doesn't leave stale ones behind.
    for fn in os.listdir(OUT):
        if fn.startswith("photos-") and fn.endswith(".json"):
            os.remove(os.path.join(OUT, fn))
    for i, ch in enumerate(chunks):
        with open(os.path.join(OUT, f"photos-{i}.json"), "w", encoding="ascii") as fh:
            json.dump(ch, fh, separators=(",", ":"), sort_keys=True)
    with open(os.path.join(OUT, "photos-thumbs.json"), "w", encoding="ascii") as fh:
        json.dump(thumbs, fh, separators=(",", ":"), sort_keys=True)
    with open(os.path.join(OUT, "photos-index.json"), "w", encoding="ascii") as fh:
        json.dump({"chunks": n, "fighters": index}, fh, separators=(",", ":"), sort_keys=True)

    sizes = [os.path.getsize(os.path.join(OUT, f"photos-{i}.json")) // 1024 for i in range(n)]
    print(f"{len(full)} photos -> {n} chunks, KB: {sizes}; thumbs "
          f"{os.path.getsize(os.path.join(OUT, 'photos-thumbs.json')) // 1024} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
