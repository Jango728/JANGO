"""Merge data/research/*histories*.json into lib/seed.json (full pro histories for fighters on cards)."""
import json, re, sys, unicodedata
d = json.load(open('lib/seed.json'))
src = json.load(open(sys.argv[1]))
def norm(s): return re.sub(r'[^a-z]', '', unicodedata.normalize('NFD', s.lower()).encode('ascii', 'ignore').decode())
by = {norm(f['name']): k for k, f in d['fighters'].items()}
n = 0
for r in src['fighters']:
    fid = by.get(norm(r['name']))
    if not fid or not r.get('history'): print('skip', r['name']); continue
    f = d['fighters'][fid]
    hist = []
    for h in r['history']:
        rnd = h.get('round'); t = h.get('time')
        mins = None
        if rnd and t and re.match(r'^\d+:\d\d$', t):
            m, s = map(int, t.split(':')); mins = round((rnd - 1) * 5 + m + s / 60, 3)
        row = {"opponent": h['opponent'], "date": h['date'], "result": h['result'], "promotion": h.get('promotion') or 'Regional',
               "method": h['method'], "rules": "MMA", "source": r.get('source')}
        if rnd: row['round'] = rnd
        if t: row['time'] = t
        if mins is not None: row['minutes'] = mins
        if h.get('event'): row['eventName'] = h['event']
        if h.get('opponentRecord'):
            rec = h['opponentRecord']; row['opponentRecord'] = rec if rec.count('-') == 2 else rec + '-0'; row['opponentRecordBasis'] = 'reported'
        hist.append(row)
    hist.sort(key=lambda x: x['date'], reverse=True)
    f['history'] = hist
    f['historyComplete'] = True; f['ufcHistoryComplete'] = True
    f['historySource'] = r.get('source'); f['historyChecked'] = src.get('checkedAt')
    if r.get('record'): f['record'] = r['record'] if r['record'].count('-') == 2 else r['record'] + '-0'
    for k_in, k in (('height_in', 'height'), ('reach_in', 'reach')):
        if r.get(k_in) and not f.get(k): f[k] = round(float(r[k_in]) * 2.54, 2)
    if r.get('stance') and not f.get('stance'): f['stance'] = r['stance']
    if r.get('country') and not f.get('country'): f['country'] = r['country']
    if r.get('birthDate') and not f.get('age'):
        y, m, dd = map(int, r['birthDate'].split('-')); f['age'] = 2026 - y - ((m, dd) > (9, 24))
    f['recordNote'] = f"Full pro MMA history from Tapology, checked {src.get('checkedAt')}."
    f.setdefault('sources', []).append({"label": "Tapology fighter profile", "url": r.get('source'), "checked": src.get('checkedAt')})
    n += 1
json.dump(d, open('lib/seed.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('merged', n)
