#!/usr/bin/env python3
"""One-off: add OKTAGON 94 (Sep 26, 2026, Frankfurt) — fighters from data/research/oktagon94-part*.json, event + bouts."""
import json, re, unicodedata, glob
seed = json.load(open('lib/seed.json'))
F = seed['fighters']
EVENT_DATE = '2026-09-26'
CHECKED = '2026-09-25'

def slug(n): return re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFD', n.lower()).encode('ascii', 'ignore').decode()).strip('-')
def rec3(r):
    if not r: return None
    r = r.strip()
    return r if r.count('-') == 2 else (r + '-0' if r.count('-') == 1 else None)
def promo(p):
    if not p: return 'Regional'
    return 'OKTAGON' if re.search(r'oktagon|okmma', p, re.I) else p
def age(dob):
    y, m, d = map(int, dob.split('-')); ey, em, ed = map(int, EVENT_DATE.split('-'))
    return ey - y - ((em, ed) < (m, d))

research = []
for f in sorted(glob.glob('data/research/oktagon94-part*.json')): research += json.load(open(f))['fighters']
ids = {}
for r in research:
    fid = slug(r['name'])
    if fid in F: raise SystemExit(f'id clash {fid}')
    ids[r['name']] = fid
    hist = []
    for h in r.get('history', []):
        row = {"opponent": h['opponent'], "date": h['date'], "result": h['result'], "promotion": promo(h.get('promotion')),
               "method": h.get('method') or 'Unknown', "rules": "MMA", "source": r['source']}
        rnd, t = h.get('round'), h.get('time')
        if rnd: row['round'] = rnd
        if t and re.match(r'^\d+:\d\d$', t):
            row['time'] = t
            if rnd:
                m, s = map(int, t.split(':')); row['minutes'] = round((rnd - 1) * 5 + m + s / 60, 3)
        if h.get('event'): row['eventName'] = h['event']
        orc = rec3(h.get('opponentRecord'))
        if orc: row['opponentRecord'] = orc; row['opponentRecordBasis'] = 'reported'
        hist.append(row)
    hist.sort(key=lambda x: x['date'], reverse=True)
    f = {"id": fid, "name": r['name'], "history": hist,
         "sources": [{"label": "Tapology fighter profile", "url": r['source'], "checked": CHECKED}],
         "record": rec3(r.get('record')) or '0-0-0',
         "recordScope": "Professional MMA record from Tapology (cross-checked with Sherdog)",
         "historyComplete": True, "historySource": r['source'], "historyChecked": CHECKED,
         "tapology": r['source'], "profile": r.get('sherdog') or r['source']}
    if r.get('sherdog'): f['sources'].append({"label": "Sherdog fighter profile", "url": r['sherdog'], "checked": CHECKED})
    if r.get('nickname'): f['nickname'] = r['nickname']
    if r.get('height_in'): f['height'] = round(float(r['height_in']) * 2.54, 2)
    if r.get('reach_in'): f['reach'] = round(float(r['reach_in']) * 2.54, 2)
    if r.get('stance'): f['stance'] = r['stance']
    if r.get('country'): f['country'] = r['country']
    if r.get('birthDate'): f['birthDate'] = r['birthDate']; f['age'] = age(r['birthDate'])
    f['recordNote'] = f"Full pro MMA history from Tapology, checked {CHECKED}." + (f" {r['note']}" if isinstance(r.get('note'), str) and len(r['note']) < 400 else '')
    if r['name'].startswith('Edmon'):
        f['recordScope'] = "No professional MMA bouts; 1-0 in pro boxing (KO/TKO over Patrik Fiala, 2026-05-15, BDB). OKTAGON 94 is his Stand & Bang debut."
        f['recordNote'] = "0-0 pro MMA. One pro boxing win (Tapology/BoxRec). YouTuber 'RINGLIFE'."
    F[fid] = f

fid = lambda n: ids[n]
def bout(a, b, div, sec, rules='MMA', rounds=3, notes=None):
    return {"id": f"oktagon94-{fid(a)}-{fid(b)}", "a": fid(a), "b": fid(b), "division": div, "rules": rules, "rounds": rounds,
            "section": sec, "assessments": {}, "notes": notes or ["Bout order, weight and rules from OKTAGON's official fight card and Tapology, checked September 25, 2026."],
            "unknowns": ["Regional-level opposition makes strength-of-schedule less certain than for UFC cards.", "No official striking/grappling rates exist for OKTAGON."]}
MC, PR = "Main Card", "Prelims"
fights = [
    bout("Christian Eckerlin", "David Kozma", "Catchweight (176 lb)", MC, notes=["Main event. 80 kg catchweight, 3 x 5 min (non-title), per OKTAGON and Tapology.", "Pukač, on this card, holds wins over both Eckerlin and Kozma."]),
    bout("Max Coga", "Christian Jungwirth", "Welterweight", MC),
    bout("Karlos Vémola", "Frederic Vosgröne", "Catchweight (196 lb)", MC, notes=["89 kg catchweight. Vémola returns from retirement."]),
    bout("Fedor Duric", "Marc Diakiese", "Lightweight", MC),
    bout("Edmon Avagyan", "Dominic Schober", "Catchweight (176 lb)", MC, rules="Muay Thai", rounds=5,
         notes=["OKTAGON 'Stand & Bang' rules (Tapology: modified Muay Thai in MMA gloves), 5 x 3-minute rounds, 80 kg.", "Avagyan (YouTuber RINGLIFE) has no MMA or Muay Thai bouts; his only pro fight is a 2026 boxing win. Schober has 31 pro MMA fights but no striking-rules bouts."]),
    bout("Hugo Vach", "Deniz Ilbay", "Featherweight", PR),
    bout("Jaime Cordero", "Robert Pukač", "Middleweight", PR),
    bout("Tamerlan Dulatov", "Nikola Janković", "Welterweight", PR),
    bout("Raul Lemberanskij", "Roman Paulus", "Bantamweight", PR),
    bout("Michael Obodozie", "Oskar Staszczak", "Welterweight", PR, notes=["Free prelim (opens the card)."]),
]
seed['events'] = [e for e in seed['events'] if e['id'] != 'oktagon-94']
seed['events'].append({"id": "oktagon-94", "title": "OKTAGON 94: Eckerlin vs. Kozma", "promotion": "OKTAGON", "date": EVENT_DATE,
    "time": "Card starts 12:00 local (6am ET)", "location": "Deutsche Bank Park, Frankfurt, Germany",
    "coverage": "Temporary one-off event · 10 bouts · added Sep 25",
    "source": {"label": "OKTAGON official fight card", "url": "https://oktagonmma.com/en/events/oktagon-94-frankfurt/", "checked": CHECKED},
    "fights": fights})
json.dump(seed, open('lib/seed.json', 'w'), ensure_ascii=False)
print('added', len(research), 'fighters,', len(fights), 'bouts')
