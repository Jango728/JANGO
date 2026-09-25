#!/usr/bin/env python3
"""Merge per-clip name-tag tracks (public/films/<clip>.json) into public/films/tracks.json.
Per-clip files are moved to archive/film-tracks/ so they aren't published separately (artifact file-count limit)."""
import json, os, glob, shutil
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
films = os.path.join(root, "public", "films"); arch = os.path.join(root, "archive", "film-tracks")
os.makedirs(arch, exist_ok=True)
out = os.path.join(films, "tracks.json")
tracks = json.load(open(out)) if os.path.exists(out) else {}
for f in sorted(glob.glob(os.path.join(films, "*.json"))):
    if f == out: continue
    name = os.path.basename(f)[:-5]
    tracks[name] = json.load(open(f))
    shutil.move(f, os.path.join(arch, os.path.basename(f)))
json.dump(tracks, open(out, "w"), separators=(",", ":"))
print("tracks:", ", ".join(sorted(tracks)))
