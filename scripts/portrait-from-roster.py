#!/usr/bin/env python3
"""Portrait fallback that needs no Firecrawl: copy a fighter's transparent portrait out of the roster photo
chunks (public/roster/photos-*.json, restored from the artifact) into public/fighters/<id>.webp and point the
seed profile at it.

  python3 scripts/portrait-from-roster.py --missing            # every fighter on an upcoming card with no image
  python3 scripts/portrait-from-roster.py <fighter-id> [...]   # specific seed ids
  options: --dry-run   show what would happen
           --headshots also accept head-and-shoulders crops (default: full-body only, which is what the faceoff needs)

Matching: seed name -> roster slug by exact normalized name (accents/punctuation ignored), then roster
"First Last" token order; ambiguous or missing names are skipped and printed. Never guesses.
Standard library only.
"""
import base64, datetime, json, re, sys, unicodedata
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "lib/seed.json"
RDIR = ROOT / "public/roster"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
dry, heads, missing = "--dry-run" in sys.argv, "--headshots" in sys.argv, "--missing" in sys.argv
if not (RDIR / "photos-index.json").exists():
    sys.exit("public/roster/photos-index.json not found: restore roster/ from the artifact first (nothing changed)")

def norm(s): return re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower())
def tokkey(s): return " ".join(sorted(re.sub(r"[^a-z ]", "", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).split()))

seed = json.load(open(SEED))
F = seed["fighters"]
today = datetime.date.today().isoformat()
if missing:
    ids = sorted({x for e in seed["events"] if e["date"] >= today for f in e["fights"] for x in (f["a"], f["b"]) if x in F and not F[x].get("image")})
else:
    ids = args
if not ids:
    print("no fighters to fill"); sys.exit(0)

names = json.load(open(RDIR / "names.json"))  # [slug, name, nickname, weightClass, lastYear, ufcRecord]
index = json.load(open(RDIR / "photos-index.json"))
by_norm, by_tok = {}, {}
for row in names:
    by_norm.setdefault(norm(row[1]), []).append(row[0])
    by_tok.setdefault(tokkey(row[1]), []).append(row[0])
chunks = {}
done, skipped = [], []
for fid in ids:
    f = F.get(fid)
    if not f: skipped.append((fid, "not a seed fighter id")); continue
    if f.get("image") and not missing and "--force" not in sys.argv:
        skipped.append((fid, f"already has {f['image']}")); continue
    cands = by_norm.get(norm(f["name"])) or by_tok.get(tokkey(f["name"])) or []
    if len(cands) != 1:
        skipped.append((fid, "no roster match" if not cands else f"ambiguous roster match {cands}")); continue
    slug = cands[0]
    hit = index["fighters"].get(slug)
    if not hit: skipped.append((fid, f"roster {slug} has no photo")); continue
    chunk, kind = hit
    if kind != "f" and not heads: skipped.append((fid, f"roster {slug} has only a headshot (use --headshots)")); continue
    if chunk not in chunks: chunks[chunk] = json.load(open(RDIR / f"photos-{chunk}.json"))
    uri = chunks[chunk].get(slug)
    m = re.match(r"data:image/(webp|png);base64,(.+)", uri or "", re.S)
    if not m: skipped.append((fid, f"roster {slug} photo is not a webp/png data URI")); continue
    ext, data = m.group(1), base64.b64decode(m.group(2))
    rel = f"fighters/{fid}.{ext}"
    if not dry:
        (ROOT / "public" / rel).write_bytes(data)
        f["image"] = rel
        f["imageSource"] = f"Jango roster photo pack (public/roster/photos-{chunk}.json, slug {slug})"
        f.setdefault("sources", []).append({"label": "Fighter portrait", "url": f"roster/photos-{chunk}.json#{slug}", "checked": today,
                                             "note": "Transparent portrait copied from the site's roster photo pack (no Firecrawl)."})
    done.append((fid, rel, len(data)))
if done and not dry:
    SEED.write_text(json.dumps(seed, ensure_ascii=False))
for fid, rel, n in done: print(f"{'would write' if dry else 'wrote'} public/{rel} ({n // 1024} KB)")
for fid, why in skipped: print(f"skip {fid}: {why}")
print(f"{len(done)} portrait(s) {'found' if dry else 'filled'}, {len(skipped)} skipped")
