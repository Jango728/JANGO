"""Apply data/research/lineup_verification.json to lib/seed.json (bout changes, fighter fixes, display odds)."""
import json, re, unicodedata, sys
SEED = 'lib/seed.json'
d = json.load(open(SEED))
v = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'data/research/lineup_verification.json'))
checked = v.get('checkedAt', '2026-09-24')

def norm(s): return re.sub(r'[^a-z]', '', unicodedata.normalize('NFD', s.lower()).encode('ascii', 'ignore').decode())
def slug(s): return re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFD', s.lower()).encode('ascii', 'ignore').decode()).strip('-')
def find_id(name, pool):
    n = norm(name)
    for fid in pool:
        f = d['fighters'].get(fid)
        if f and norm(f['name']) == n: return fid
    for fid in pool:
        f = d['fighters'].get(fid)
        if f and (norm(f['name']).endswith(n[-6:]) and norm(f['name'])[0] == n[0]): return fid
    return None
def ensure_fighter(name, stats, src):
    fid = find_id(name, d['fighters'].keys())
    if fid: return fid
    fid = slug(name)
    f = {"id": fid, "name": name, "history": [], "sources": [{"label": "Verified on announcement", "url": (stats or {}).get('source', src), "checked": checked}],
         "recordNote": "Added as a late replacement/new bout; full pro history pending the nightly refresh."}
    if stats:
        if stats.get('record'): f['record'] = stats['record'] if stats['record'].count('-') == 2 else stats['record'] + '-0'
        if stats.get('height_in'): f['height'] = round(float(stats['height_in']) * 2.54, 2)
        if stats.get('reach_in'): f['reach'] = round(float(stats['reach_in']) * 2.54, 2)
        if stats.get('stance'): f['stance'] = stats['stance']
        if stats.get('age'): f['age'] = int(stats['age'])
        if stats.get('country'): f['country'] = stats['country']
    d['fighters'][fid] = f
    return fid
def fight_of(ev, a, b):
    for f in ev['fights']:
        ids = {f['a'], f['b']}
        na, nb = norm(a), norm(b)
        names = {norm(d['fighters'][x]['name']) for x in ids if x in d['fighters']}
        if any(na[-5:] in n for n in names) and any(nb[-5:] in n for n in names): return f
    return None

log = []
for e in v['events']:
    ev = next((x for x in d['events'] if x['id'] == e['event']), None)
    if not ev: continue
    src = (e.get('sources') or [ev['source']['url']])[0]
    for c in e.get('boutChanges', []):
        t = c['type']
        if t == 'removed':
            f = fight_of(ev, c['a'], c['b'])
            if f: ev['fights'].remove(f); log.append(f"{ev['id']}: removed {c['a']} vs {c['b']}")
        elif t in ('replaced', 'added'):
            a = ensure_fighter(c['a'], c.get('a_stats'), src); b = ensure_fighter(c['b'], c.get('b_stats'), src)
            # replacement: drop the old bout that shares the retained fighter
            if t == 'replaced':
                for old in list(ev['fights']):
                    if (a in (old['a'], old['b'])) != (b in (old['a'], old['b'])):
                        ev['fights'].remove(old); log.append(f"{ev['id']}: dropped {old['id']} (replaced)")
            if not fight_of(ev, c['a'], c['b']):
                nf = {"id": f"{ev['id']}-{a}-{b}", "a": a, "b": b, "division": c['division'], "rules": "MMA", "rounds": c.get('rounds', 3), "section": c.get('section', 'Prelims'),
                      "assessments": {}, "notes": [c['detail']], "unknowns": []}
                ev['fights'].append(nf); log.append(f"{ev['id']}: {t} {c['a']} vs {c['b']}")
        if c.get('section') and t in ('section', 'reordered', 'replaced', 'added') and c['a'] != '(card)':
            f = fight_of(ev, c['a'], c['b'])
            if f: f['section'] = c['section']
        if c.get('order') and c['a'] != '(card)':
            f = fight_of(ev, c['a'], c['b'])
            if f: f['_order'] = c['order']
    for r in e.get('roundsFixes', []):
        f = fight_of(ev, r['a'], r['b'])
        if f: f['rounds'] = r['rounds']
    pool = {x for f in ev['fights'] for x in (f['a'], f['b'])}
    for fx in e.get('fighterFixes', []):
        fid = find_id(fx['name'], pool)
        if not fid: log.append(f"  ? no fighter {fx['name']}"); continue
        f = d['fighters'][fid]; val = fx['correct']
        if fx['field'] == 'record': f['record'] = val if str(val).count('-') == 2 else f"{val}-0"
        elif fx['field'] == 'height_in': f['height'] = round(float(val) * 2.54, 2)
        elif fx['field'] == 'reach_in': f['reach'] = round(float(val) * 2.54, 2)
        elif fx['field'] == 'stance': f['stance'] = val
        elif fx['field'] == 'age': f['age'] = int(val)
        f.setdefault('sources', []).append({"label": f"{fx['field']} verified", "url": fx.get('source', src), "checked": checked})
    for o in e.get('odds', []):
        f = fight_of(ev, o['a'], o['b'])
        if not f or o.get('a_odds') is None: continue
        a_is_a = norm(d['fighters'][f['a']]['name'])[-5:] in norm(o['a'])
        f['odds'] = {"a": o['a_odds'] if a_is_a else o['b_odds'], "b": o['b_odds'] if a_is_a else o['a_odds'], "asOf": checked, "source": o['source']}
    # Order: main card first (by explicit order where given), then prelims, keeping relative order otherwise.
    rank = {'main': 0, 'prelims': 1, 'early': 2}
    def key(ix):
        i, f = ix
        s = f['section'].lower(); grp = 2 if 'early' in s else 1 if 'prelim' in s else 0
        return (grp, f.get('_order', 100 + i))
    ev['fights'] = [f for _, f in sorted(enumerate(ev['fights']), key=key)]
    for f in ev['fights']: f.pop('_order', None)
    ev['source']['checked'] = checked
json.dump(d, open(SEED, 'w'), ensure_ascii=False, separators=(',', ':'))
print('\n'.join(log))
