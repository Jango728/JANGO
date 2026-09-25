"""Build the Artifact `files` map for an incremental publish: new/changed dist files + nulls for retired paths."""
import json, os, subprocess, hashlib, sys
dist = 'dist'
prev = json.load(open('publish/last-published.json')) if os.path.exists('publish/last-published.json') else {}
cur = {}
for root, _, fs in os.walk(dist):
    for f in fs:
        p = os.path.join(root, f); rel = os.path.relpath(p, dist)
        if rel == 'index.html' or rel.endswith('.css'): continue
        cur[rel] = hashlib.md5(open(p, 'rb').read()).hexdigest()
extra_old = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
files = {k: k for k, h in cur.items() if prev.get(k) != h}
for k in list(prev) + extra_old:
    if k not in cur: files[k] = None
json.dump(files, open('publish/files-plan.json', 'w'), indent=0)
json.dump(cur, open('publish/pending-published.json', 'w'))
print(len([v for v in files.values() if v]), 'upload,', len([v for v in files.values() if v is None]), 'remove')
