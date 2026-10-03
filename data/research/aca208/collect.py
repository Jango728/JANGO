#!/usr/bin/env python3
"""Copy Firecrawl scrape results of Tapology fighter pages (saved by the harness as tool-result .txt files) into
data/research/aca208/raw/<tapology-slug>.json. Only keeps results that include rawHtml. Run from the repo root.
  python3 data/research/aca208/collect.py [extra result files...]"""
import json, glob, os, sys, time
RAW = 'data/research/aca208/raw'; os.makedirs(RAW, exist_ok=True)
want = {f['tapologySlug'].lower(): f['tapologySlug'] for f in json.load(open('data/research/aca208/fighters.json'))}
files = set(sys.argv[1:]) | {f for f in glob.glob('/root/.claude/projects/**/*firecrawl_scrape*.txt', recursive=True) if time.time() - os.path.getmtime(f) < 6 * 3600}
n = 0
for f in sorted(files, key=os.path.getmtime):
    try: d = json.load(open(f))
    except Exception: continue
    if not isinstance(d, dict): continue
    u = (d.get('metadata') or {}).get('sourceURL', '')
    slug = u.rstrip('/').split('/')[-1].lower()
    if '/fightcenter/fighters/' in u and slug in want and d.get('rawHtml') and d.get('markdown'):
        json.dump(d, open(f'{RAW}/{want[slug]}.json', 'w'), ensure_ascii=False); n += 1
have = {s for s in want.values() if os.path.exists(f'{RAW}/{s}.json') and 'rawHtml' in open(f'{RAW}/{s}.json').read(200000)}
print('copied', n, '| have with rawHtml:', len(have), 'of', len(want))
print('missing:', sorted(set(want.values()) - have))
