"""Build the Artifact `files` map for an incremental publish from a FULL local dist/ (manual publishes only):
new/changed dist files + nulls for retired paths.

Nightly and live runs use scripts/nightly-publish-plan.mjs instead: a restored copy has no films/, so a plan
built here from it would delete them. As a guard, this script never nulls anything under films/ or roster/
(nor source/bundle.json), even when asked to.
"""
import json, os, hashlib, sys
PROTECTED = ('films/', 'roster/', 'source/')
dist = 'dist'
prev = json.load(open('publish/last-published.json')) if os.path.exists('publish/last-published.json') else {}
cur = {}
for root, _, fs in os.walk(dist):
    for f in fs:
        p = os.path.join(root, f); rel = os.path.relpath(p, dist)
        if rel == 'index.html' or rel.endswith('.css') or rel.endswith('SOURCES.txt'): continue
        cur[rel] = hashlib.md5(open(p, 'rb').read()).hexdigest()
extra_old = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
files = {k: k for k, h in cur.items() if prev.get(k) != h}
kept = []
for k in list(prev) + extra_old:
    if k in cur: continue
    if k.startswith(PROTECTED):
        kept.append(k); continue
    files[k] = None
if kept:
    print(f'kept {len(kept)} protected path(s) that are not in dist/ (films/, roster/, source/ are never removed): {", ".join(sorted(kept)[:6])}{" ..." if len(kept) > 6 else ""}')
json.dump(files, open('publish/files-plan.json', 'w'), indent=0)
json.dump({**{k: v for k, v in prev.items() if k in kept}, **cur}, open('publish/pending-published.json', 'w'))
print(len([v for v in files.values() if v]), 'upload,', len([v for v in files.values() if v is None]), 'remove')
