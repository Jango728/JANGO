#!/usr/bin/env python3
"""Cross-check parsed Tapology histories against the independent Sherdog pull. Prints differences."""
import json, glob, re, unicodedata, datetime
F = json.load(open('data/research/aca208/fighters.json'))
SH = {x['id']: x for f in ('A', 'B') for x in json.load(open(f'data/research/aca208/sherdog-{f}.json'))}
def days(a, b): return abs((datetime.date.fromisoformat(a) - datetime.date.fromisoformat(b)).days)
def norm(s): return re.sub(r'[^a-z]', '', unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower())
out = {}
for f in F:
    t = json.load(open(f"data/research/aca208/parsed/{f['tapologySlug']}.json")); s = SH[f['id']]
    th = t['history']; sh = list(s['history']); used = set(); diffs = []; fills = 0
    for h in th:
        cands = [(days(h['date'], x['date']), i) for i, x in enumerate(sh) if i not in used and x.get('date') and h['date'] and days(h['date'], x['date']) <= 10]
        cands.sort()
        m = None
        for dd, i in cands:
            if sh[i]['result'] == h['result'] or norm(sh[i]['opponent'])[:5] == norm(h['opponent'])[:5]: m = i; break
        if m is None and cands: m = cands[0][1]
        if m is None: diffs.append(f"T-only {h['date']} {h['result']} vs {h['opponent']} ({h['method']}) [{h['event']}]"); continue
        used.add(m); x = sh[m]; h['_sh'] = x
        if x['result'] != h['result']: diffs.append(f"RESULT {h['date']} vs {h['opponent']}: tapology {h['result']} / sherdog {x['result']} ({x['method']})")
        if days(h['date'], x['date']) > 1: diffs.append(f"date {h['opponent']}: tapology {h['date']} / sherdog {x['date']}")
        if h.get('round') and x.get('round') and h['round'] != x['round'] and 'Decision' not in (h['method'] or ''): diffs.append(f"round {h['date']} vs {h['opponent']}: tapology R{h['round']} {h.get('time')} / sherdog R{x['round']} {x.get('time')}")
        tm = (h['method'] or '').split(' (')[0]; sm = (x['method'] or '')
        cat = lambda z: 'KO' if re.search(r'\b(KO|TKO)\b', z, re.I) else 'SUB' if re.search(r'submission', z, re.I) else 'DEC' if re.search(r'decision', z, re.I) else 'OTHER'
        if cat(tm) != cat(sm) and cat(tm) != 'OTHER' and cat(sm) != 'OTHER': diffs.append(f"method {h['date']} vs {h['opponent']}: tapology {h['method']} / sherdog {sm}")
    for i, x in enumerate(sh):
        if i not in used: diffs.append(f"S-only {x['date']} {x['result']} vs {x['opponent']} ({x['method']}) [{x['event']}]")
    out[f['id']] = diffs
    print(f"{f['name']:26} tap {t['record']}{'+'+str(t['check']['nc'])+'NC' if t['check']['nc'] else ''} sherdog {s['record']}{'+'+str(s['nc'])+'NC' if s['nc'] else ''} aca {f['acaListedRecord']}  diffs {len(diffs)}")
    for d in diffs: print('     ', d)
json.dump(out, open('data/research/aca208/crosscheck.json', 'w'), indent=1, ensure_ascii=False)
