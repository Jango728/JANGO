#!/usr/bin/env python3
"""Add ACA 208: Shaikhaev vs. Tumenov (Oct 4, 2026, Grozny) to lib/seed.json.

Inputs (all under data/research/aca208/, gathered Oct 1, 2026):
  fighters.json        the 44 fighters in card order (pairs are a, b), with Tapology / Sherdog / ACA links
  parsed/<slug>.json   Tapology fighter pages parsed by scripts/parse-tapology-fighter.py (primary history source:
                       pro MMA rows only, with each opponent's record going into the fight)
  sherdog-A/B.json     independent Sherdog pull (full pro histories, read twice) used to cross-check every row
  aca-profiles.json    ACA's own profile data (record, age, height) and the portrait source
  context.json         card confirmation, start time, venue, display odds and fight-week notes

Rules: Tapology is the primary record. A Sherdog-only bout is added only when it is recent (2021 or later) or when
Sherdog's record agrees with ACA's and not Tapology's, and never when Tapology lists that bout as amateur,
exhibition or record-ineligible. Nothing is invented: unknown values stay unset. Re-runnable (replaces the event and
its fighters). Standard library only.
"""
import json, re, unicodedata, datetime, difflib, os

R = 'data/research/aca208'
EVENT_ID, EVENT_DATE, CHECKED = 'aca-208', '2026-10-04', '2026-10-01'
seed = json.load(open('lib/seed.json'))
F = seed['fighters']
LIST = json.load(open(f'{R}/fighters.json'))
SH = {x['id']: x for k in 'AB' for x in json.load(open(f'{R}/sherdog-{k}.json'))}
ACA = {x['id']: x for x in json.load(open(f'{R}/aca-profiles.json'))}
CTX = json.load(open(f'{R}/context.json'))
CB = {b['bout']: b for b in CTX['bouts']}

def norm(s): return re.sub(r'[^a-z ]', '', unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()).strip()
def days(a, b): return abs((datetime.date.fromisoformat(a) - datetime.date.fromisoformat(b)).days)
def rec3(r):
    if not r: return None
    r = r.strip()
    return r if r.count('-') == 2 else (r + '-0' if r.count('-') == 1 else None)
def age_on(dob, on=EVENT_DATE):
    y, m, d = map(int, dob.split('-')); ey, em, ed = map(int, on.split('-'))
    return ey - y - ((em, ed) < (m, d))
def same_name(a, b):
    a, b = norm(a), norm(b)
    if not a or not b: return False
    if set(t for t in a.split() if len(t) >= 5) & set(t for t in b.split() if len(t) >= 5): return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.75
def cat(m):
    m = m or ''
    return 'KO' if re.search(r'\b(KO|TKO|K\.O)\b', m, re.I) else 'SUB' if re.search(r'submission', m, re.I) else 'DEC' if re.search(r'decision', m, re.I) else 'OTHER'
SUB_KW = re.compile(r'choke|armbar|arm bar|triangle|kimura|guillotine|lock|crank|americana|omoplata|ezekiel|anaconda|d.arce|brabo', re.I)

PROMO = {'absolute-championship-akhmat-aca': 'ACA', 'fight-club-berkut-fcb': 'ACB', 'ultimate-fighting-championship-ufc': 'UFC',
         'fight-nights-russia-fnr': 'Fight Nights', 'm-1-global-m-1': 'M-1', 'akhmat-fight-club-afc': 'WFCA',
         'professional-fighters-league-pfl': 'PFL', 'world-series-of-fighting-wsof': 'WSOF', 'russian-cagefighting-championship-rcc': 'RCC',
         'eagle-fighting-championship-efc': 'Eagle FC', 'one-fighting-championship-ofc': 'ONE', 'extreme-fighting-championship-africa-efca': 'EFC',
         'jungle-fight-championship-jfc': 'Jungle Fight', 'shooto-brasil-sb': 'Shooto Brasil', 'okatgon-mma-okmma': 'OKTAGON',
         'wsof-global-championship-wsofgc': 'WSOF GC'}
def promo(h):
    ev = h.get('event') or ''
    if re.search(r'Young Eagles', ev): return 'ACA Young Eagles' if ev.startswith('ACA') else 'Berkut Young Eagles'
    if re.search(r'Contender Series', ev): return 'DWCS'
    p = PROMO.get(h.get('promotionSlug') or '')
    if p: return p
    if re.match(r'^ACA \d', ev): return 'ACA'
    if re.match(r'^ACB \d', ev): return 'ACB'
    return h.get('promotionAbbr') or 'Regional'
def sherdog_promo(ev):
    ev = ev or ''
    if re.search(r'Young Eagles', ev): return 'ACA Young Eagles'
    for pat, p in ((r'^ACA\b', 'ACA'), (r'^ACB\b', 'ACB'), (r'^UFC\b', 'UFC'), (r'^Fight Nights|^AMC Fight Nights|^FNG', 'Fight Nights'), (r'^M-1', 'M-1'), (r'^PFL', 'PFL')):
        if re.search(pat, ev): return p
    return ev.split(' - ')[0].strip() if ' - ' in ev else 'Regional'
def sherdog_method(m):
    m = (m or '').strip()
    m = re.sub(r'^(TKO|KO|K\.O)\b', 'KO/TKO', m)
    return m or 'Method not listed'
def round_minutes(duration):
    m = re.search(r'(\d)\s*x\s*(\d+)\s*Minute', duration or '')
    return int(m.group(2)) if m else 5

# Opponent's record going into a Sherdog-only bout, counted from the opponent's own Sherdog history (checked Oct 1, 2026).
SHERDOG_ONLY_OPP = {('magomed-malsagov', '2026-06-06'): ('8-0-0', 'https://www.sherdog.com/fighter/Akhmad-Gasanov-271045')}

report = []
ids = {}
for f in LIST:
    fid = f['id']; ids[f['name']] = fid
    T = json.load(open(f"{R}/parsed/{f['tapologySlug']}.json")); S = SH[fid]; A = ACA[fid]
    assert T['check']['counted'] == T['record'], f"{fid}: parsed Tapology rows do not add up"
    th = [h for h in T['history'] if h['date'] and h['date'] < EVENT_DATE]
    sh = [dict(x) for x in S['history'] if x.get('date') and x['date'] < EVENT_DATE]
    used = set(); notes = []; filled = 0; fixed = 0
    # pass 1: same opponent within 120 days; pass 2: same result within 10 days
    for h in th:
        c = sorted((-difflib.SequenceMatcher(None, norm(h['opponent']), norm(x['opponent'])).ratio(), days(h['date'], x['date']), i) for i, x in enumerate(sh)
                   if i not in used and same_name(h['opponent'], x['opponent']) and days(h['date'], x['date']) <= 120)
        if c: used.add(c[0][2]); h['_s'] = sh[c[0][2]]
    for h in th:
        if '_s' in h: continue
        c = sorted((days(h['date'], x['date']), i) for i, x in enumerate(sh) if i not in used and x['result'] == h['result'] and days(h['date'], x['date']) <= 10)
        if c: used.add(c[0][1]); h['_s'] = sh[c[0][1]]
    matched = sum(1 for h in th if '_s' in h)
    rows = []
    for h in th:
        s = h.get('_s'); method = re.sub(r'^No Contest \(No Contest.*\)$', 'No Contest', h['method'] or 'Method not listed')
        method = re.sub(r'^Draw \(Draw · (.*)\)$', r'Draw (\1)', method)
        rnd, tm = h.get('round'), h.get('time')
        if s:
            sm = sherdog_method(s.get('method'))
            if method in ('Method not listed', 'KO/TKO', 'Submission', 'Decision') and cat(sm) != 'OTHER' and (cat(method) in ('OTHER', cat(sm))) and len(sm) > len(method):
                method = sm; filled += 1
            elif cat(method) != cat(sm) and 'OTHER' not in (cat(method), cat(sm)):
                detail = (re.search(r'\((.*)\)', method) or [None, ''])[1]
                if cat(method) == 'KO' and cat(sm) == 'SUB' and SUB_KW.search(detail): method = f'Submission ({detail})'; fixed += 1
                elif cat(method) == 'SUB' and cat(sm) == 'KO' and not SUB_KW.search(detail): method = f'KO/TKO (Submission to {detail})' if detail else 'KO/TKO (Submission to strikes)'; fixed += 1
                else: notes.append(f"{h['date']} vs {h['opponent']}: Tapology has {method}, Sherdog {sm} (Tapology kept)")
            st = s.get('time') if s.get('time') not in (None, '0:00', 'N/A') else None
            if not rnd and s.get('round'): rnd = s['round']; filled += 1
            if not tm and st and (not h.get('round') or h['round'] == s.get('round')): tm = st
            if s['result'] != h['result']: notes.append(f"{h['date']} vs {h['opponent']}: Tapology result {h['result']}, Sherdog {s['result']} (Tapology kept)")
        row = {"opponent": h['opponent'], "date": h['date'], "result": h['result'], "promotion": promo(h), "method": method, "rules": "MMA", "source": T['source']}
        rm = round_minutes(h.get('duration'))
        if rnd: row['round'] = rnd
        if cat(method) == 'DEC' and rnd:
            row['time'] = f'{rm}:00'; row['minutes'] = float(rnd * rm)
        elif tm and re.match(r'^\d+:\d\d$', tm):
            row['time'] = tm
            if rnd:
                m_, s_ = map(int, tm.split(':')); row['minutes'] = round((rnd - 1) * rm + m_ + s_ / 60, 3)
        if h.get('event'): row['eventName'] = h['event']
        orc = rec3(h.get('opponentRecord'))
        if orc: row['opponentRecord'] = orc; row['opponentRecordBasis'] = 'reported'
        if h.get('weight'):
            d = h['weight'].split('·')[0].strip()
            if re.match(r'^[A-Za-z ]+weight$', d): row['division'] = d
        rows.append(row)
    # Sherdog-only bouts
    non_pro = [o for o in T['otherBouts'] if o['kind'] in ('amateur', 'exhibition', 'ineligible') and o.get('date')]
    agree = rec3(S['record']) == rec3(f.get('acaListedRecord') or A.get('record')) != rec3(T['record'])
    added = []
    for i, x in enumerate(sh):
        if i in used: continue
        if any(days(o['date'], x['date']) <= 10 or (same_name(o['opponent'], x['opponent']) and days(o['date'], x['date']) <= 120) for o in non_pro):
            notes.append(f"{x['date']} vs {x['opponent']}: counted as pro by Sherdog, listed as amateur/exhibition/ineligible by Tapology (left out)"); continue
        if x['date'] >= '2021-01-01' or agree:
            row = {"opponent": x['opponent'], "date": x['date'], "result": x['result'], "promotion": sherdog_promo(x.get('event')),
                   "method": sherdog_method(x.get('method')), "rules": "MMA", "source": S['sherdog']}
            if x.get('round'): row['round'] = x['round']
            t_ = x.get('time') if x.get('time') not in (None, '0:00', 'N/A') else None
            if cat(row['method']) == 'DEC' and x.get('round'): row['time'] = '5:00'; row['minutes'] = float(x['round'] * 5)
            elif t_ and x.get('round'):
                m_, s_ = map(int, t_.split(':')); row['time'] = t_; row['minutes'] = round((x['round'] - 1) * 5 + m_ + s_ / 60, 3)
            if x.get('event'): row['eventName'] = x['event']
            ov = SHERDOG_ONLY_OPP.get((fid, x['date']))
            if ov: row.update({"opponentRecord": ov[0], "opponentRecordBasis": "reported", "opponentSource": ov[1]})
            rows.append(row); added.append(x)
        else:
            notes.append(f"{x['date']} vs {x['opponent']}: on Sherdog only (old bout, left out)")
    for h in th:
        if '_s' not in h: notes.append(f"{h['date']} vs {h['opponent']}: on Tapology only (kept)")
    rows.sort(key=lambda r: r['date'], reverse=True)
    w = sum(r['result'] == 'W' for r in rows); l = sum(r['result'] == 'L' for r in rows); d = sum(r['result'] == 'D' for r in rows); nc = sum(r['result'] == 'NC' for r in rows)
    record = f'{w}-{l}-{d}'

    # ---- bio ----
    dob = T['birthDate']; dob_src = 'Tapology'
    if S.get('birthDate') and dob != S['birthDate']:
        if not dob or (A.get('age') is not None and age_on(S['birthDate'], CHECKED) == A['age'] and age_on(dob, CHECKED) != A['age']):
            dob, dob_src = S['birthDate'], 'Sherdog'
    height = T['height_cm']; h_src = 'Tapology'
    sH, aH = S.get('heightCm'), A.get('heightCm')
    if sH and aH and abs(sH - aH) <= 1.5 and (not height or abs(height - (sH + aH) / 2) >= 3): height, h_src = aH, 'ACA and Sherdog'
    if not height and (sH or aH): height, h_src = (round(sH) if sH else aH), ('Sherdog' if sH else 'ACA')
    country = T['country']
    if S.get('nationality') and S['nationality'] != country and (not country or S['nationality'] in (T.get('born') or '')): country = S['nationality']
    if fid == 'murad-khasaev': country = 'Russia'  # Sherdog: Russia; ACA hometown Khasavyurt (Dagestan). Tapology's flag is Turkey (born Antalya).
    stance = (CTX.get('stances') or {}).get(f['name'], {}).get('stance')

    seedf = {"id": fid, "name": f['name'], "history": rows,
             "sources": [{"label": "Tapology fighter profile", "url": T['source'], "checked": CHECKED},
                         {"label": "Sherdog fighter profile", "url": S['sherdog'], "checked": CHECKED}],
             "record": record,
             "recordScope": "Professional MMA record from Tapology (cross-checked bout by bout with Sherdog)" + ("; includes bouts listed only by Sherdog" if added else ""),
             "historyComplete": True, "historySource": T['source'], "historyChecked": CHECKED,
             "tapology": T['source'], "profile": S['sherdog']}
    if A.get('acaProfile'): seedf['sources'].append({"label": "ACA fighter profile", "url": A['acaProfile'], "checked": CHECKED})
    if T.get('nickname') or S.get('nickname'): seedf['nickname'] = T.get('nickname') or S['nickname']
    if height: seedf['height'] = float(height)
    if T.get('reach_cm'): seedf['reach'] = float(T['reach_cm'])
    if stance: seedf['stance'] = stance
    if country: seedf['country'] = country
    if dob: seedf['birthDate'] = dob; seedf['age'] = age_on(dob)
    elif A.get('age') is not None: seedf['age'] = A['age']
    if nc: seedf['noContests'] = nc
    img = f'public/fighters/{fid}.webp'
    if os.path.exists(img) and A.get('imageSource'):
        seedf['image'] = f'fighters/{fid}.webp'; seedf['imageSource'] = A['imageSource']; seedf['imageDate'] = CHECKED
    excl = {}
    for o in T['otherBouts']:
        if o['kind'] not in ('cancelled', 'upcoming'): excl[o['kind']] = excl.get(o['kind'], 0) + 1
    listed = f"Tapology {T['record']}, Sherdog {S['record']}" + (f", ACA {rec3(A.get('record') or f.get('acaListedRecord'))}" if (A.get('record') or f.get('acaListedRecord')) else '')
    note = [f"Full pro MMA history from Tapology, checked {CHECKED}; {matched} of {len(th)} bouts also found on Sherdog."]
    note.append(f"Listed records: {listed}." + (f" Plus {nc} no contest{'s' if nc != 1 else ''}." if nc else ''))
    if added: note.append("Added from Sherdog (not on Tapology): " + '; '.join(f"{x['date']} {x['result']} vs {x['opponent']}" for x in added) + "." + ("" if all((fid, x['date']) in SHERDOG_ONLY_OPP for x in added) else " Opponent records for these are not known."))
    if excl: note.append("Not counted (Tapology classification): " + ', '.join(f"{v} {k.replace('_', ' ')}" for k, v in sorted(excl.items())) + '.')
    if filled or fixed: note.append(f"{filled + fixed} method/round detail{'s' if filled + fixed != 1 else ''} taken from Sherdog where Tapology had none or mislabelled the finish.")
    if dob_src != 'Tapology' and dob: note.append("Birth date from Sherdog" + (" (matches ACA's listed age; Tapology differs)." if T['birthDate'] else " (not on Tapology)."))
    if not dob: note.append("Birth date not published" + (f"; age {A['age']} is ACA's listed age." if A.get('age') is not None else " and no age listed by ACA."))
    if h_src != 'Tapology' and height: note.append(f"Height from {h_src}" + (f" (Tapology lists {T['height_cm']} cm)." if T['height_cm'] else '.'))
    if fid == 'murad-khasaev': note.append("Country: Sherdog lists Russia and ACA gives his hometown as Khasavyurt; Tapology shows Turkey (born in Antalya).")
    if not T.get('reach_cm'): note.append("Reach not published.")
    if not stance: note.append("Stance not published by ACA, Tapology or Sherdog.")
    if notes: note.append("Source differences: " + '; '.join(notes[:6]) + ('.' if len(notes) <= 6 else f"; and {len(notes) - 6} more."))
    seedf['recordNote'] = ' '.join(note)
    F[fid] = seedf
    report.append((f['name'], record, T['record'], S['record'], len(rows), matched, len(th), len(added), len(notes), seedf.get('birthDate') or f"age {seedf.get('age')}", seedf.get('height'), seedf.get('reach'), country))

# ---------------------------------------------------------------- event + bouts
BFO = 'https://www.bestfightodds.com/events/aca-208-4390'
def american(dec): return int(round((dec - 1) * 100)) if dec >= 2 else int(round(-100 / (dec - 1)))
def odds_for(n):
    b = CB[n]; alt = [o for o in (b.get('oddsAlt') or []) if o.get('format') == 'american' and o.get('a') is not None and o.get('b') is not None]
    o = b.get('odds')
    if alt: return {"a": alt[0]['a'], "b": alt[0]['b'], "asOf": alt[0]['asOf'], "source": BFO}
    if o and o['format'] == 'american': return {"a": o['a'], "b": o['b'], "asOf": o['asOf'], "source": BFO}
    if o and o['format'] == 'decimal': return {"a": american(o['a']), "b": american(o['b']), "asOf": o['asOf'], "source": o['source']}
    return None

STD = "Bout, weight class and order from ACA's official fight card, Sherdog and Tapology, checked October 1, 2026."
EARLY = "Early prelim: on Sherdog, Tapology and Russian media's full card, not yet on ACA's own event page (which lists the top 17 bouts)."
NOTES = {
 22: ["ACA lightweight title, 5 x 5 minutes. Shaikhaev's first defence: he won the interim belt in January 2026 and became champion in April when Abdulvakhabov gave up the title.",
      "Rebooked from ACA 206 (August 15) after both men were injured. About eight months since either fought. Tumenov is on a six-fight win streak, the last four by stoppage.",
      "Shaikhaev missed weight (159.1 lb) in June 2025 but made weight for his interim title fight."],
 21: ["Co-main event, 3 rounds. Abdulvakhabov's first fight at welterweight after vacating the lightweight belt; he last fought in July 2025 (about 15 months ago).",
      "Tibau is 43 and last fought in MMA in October 2025. Two of his 2026 bookings were cancelled."],
 20: ["Vargas was stopped in the first round at ACA 204 on June 19, 2026, 107 days before this fight. Dudaev last fought in October 2025."],
 19: ["Rebooking of a bout cancelled from ACA 200 in February 2026; they have not fought before. ACA bills it as #2 vs #6 at featherweight.",
      "Selimkhanov stopped Rustam Kerimov (also on this card) in round 5 in October 2025, then lost a decision in May 2026."],
 18: ["Ibragimov is the former ACA light heavyweight champion; he lost the belt by TKO in December 2025 and hasn't fought since. His last three fights were five-rounders.",
      "Starodub has won three straight, including Evgeny Erokhin and Husein Kushagov, who are both on this card."],
 17: ["Bantamweight per ACA's announcement, ACA's event page and Sherdog (Tapology lists 145 lb). Kerimov is dropping back down after three fights at featherweight.",
      "Podlesniy's last fight, for the bantamweight belt in March 2026, ended in a no contest after an accidental eye poke."],
 16: ["Rematch: Dzhanaev beat Dolgov by unanimous decision in November 2022.",
      "Dzhanaev was stopped in the first round on July 17, 2026, only 79 days before this fight. Dolgov has lost three in a row."],
 15: ["Matsola's only pro loss was a first-round TKO in April 2026. Grishenko's August 2026 bout at ACA 206 was cancelled; he last fought in March 2026."],
 14: ["On ACA's official card and Sherdog but missing from Tapology's listing. Three rounds is ACA's standard for non-title bouts; no source lists a round count for this fight.",
      "Sulumov pulled out of a February 2026 bout injured, then lost a decision in June. Moraes (ex-UFC, ex-PFL) last fought in October 2025."],
 13: ["ACA says Abdurakov is returning after surgery and had a change of opponent during camp; no details were published. He has lost his last two, both by submission."],
 12: ["Boraev missed the featherweight limit in January 2026 (149.2 lb) and weighed 151.8 lb in May 2026.",
      "Valiev (ex-UFC) withdrew injured from ACA 206 in August and hasn't fought since August 2025."],
 11: ["Evloev has not fought since August 2023, more than three years. Both men are moving up from flyweight.",
      "Figueiredo (ex-UFC) lost his last two in the first round; his last fight was in April 2025."],
 10: ["Hulme has been stopped in his last two fights, most recently on June 19, 2026. Abdulaev was stopped in round 3 in January 2026."],
 9: ["Flyweight per ACA's announcement, both ACA fighter profiles, Sherdog and Tapology; ACA's event page shows 61.7 kg (bantamweight). The October 3 weigh-in settles it.",
     "Gadzhiev lost the ACA flyweight belt in June 2025, then lost a decision at bantamweight, and is returning to flyweight. Israpilov is on a six-fight win streak."],
 8: ["Conrado's August 2026 bout was cancelled after he had weighed in. Both men have lost their last two."],
 7: ["Kushagov has lost five in a row and Erokhin three. Both lost to Sergey Starodub (also on this card) in the past year."],
 6: ["Khasaev has not fought since June 2025 and had two 2026 bookings cancelled."],
 5: [EARLY, "Malsagov's June 2026 decision loss is listed by Sherdog and ACA but not Tapology; it is included here. Astakhov is 38 and has lost his last two."],
 4: [EARLY, "Oliveira fought as recently as June 27, 2026; his 2025 fights were at featherweight."],
 3: [EARLY, "Tsiptauri's bout at ACA 207 three weeks ago was cancelled. Suleymanov's last fight was at bantamweight."],
 2: [EARLY, "Fakov fought 87 days ago; Akhmadov has not fought in a year."],
 1: [EARLY, "Gomes's last bout was at bantamweight after two losses at flyweight. Geroev lost a five-round decision for the ACA Young Eagles belt in November 2025."],
}
DIV = {22: "Lightweight", 21: "Welterweight", 20: "Featherweight", 19: "Featherweight", 18: "Light Heavyweight", 17: "Bantamweight", 16: "Middleweight",
       15: "Heavyweight", 14: "Lightweight", 13: "Welterweight", 12: "Featherweight", 11: "Bantamweight", 10: "Middleweight", 9: "Flyweight",
       8: "Lightweight", 7: "Light Heavyweight", 6: "Lightweight", 5: "Light Heavyweight", 4: "Lightweight", 3: "Flyweight", 2: "Bantamweight", 1: "Bantamweight"}
UNK = ["ACA opposition is harder to grade than UFC opposition; opponent records are as listed by Tapology going into each fight.",
       "No official striking or grappling rates exist for ACA bouts.", "Official weigh-in results were not out when this was added (October 1)."]
fights = []
for n in range(22, 0, -1):
    a, b = [x for x in LIST if x['bout'] == n]
    sec = "Main Card" if n >= 18 else "Prelims" if n >= 6 else "Early Prelims"
    fight = {"id": f"aca208-{a['id']}-{b['id']}", "a": a['id'], "b": b['id'], "division": DIV[n], "rules": "MMA", "rounds": 5 if n == 22 else 3,
             "section": sec, "assessments": {}, "notes": NOTES[n] + ([STD] if n not in (14,) else []), "unknowns": UNK}
    o = odds_for(n)
    if o: fight['odds'] = o
    fights.append(fight)

seed['events'] = [e for e in seed['events'] if e['id'] != EVENT_ID]
seed['events'].append({
    "id": EVENT_ID, "title": "ACA 208: Shaikhaev vs. Tumenov", "promotion": "ACA", "date": EVENT_DATE,
    "time": "First bout 6am ET (1pm Moscow) · main card time not announced",
    "location": "Sport Hall Colosseum, Grozny, Russia",
    "coverage": "Full card · 22 bouts · added Oct 1",
    "source": {"label": "ACA official event page", "url": "https://www.aca-mma.com/en/tournamentnext/-loqsATY7_231", "checked": CHECKED},
    "venue": {"altitudeM": 130, "tz": "Europe/Moscow", "source": "https://en.wikipedia.org/wiki/Grozny (elevation 130 m); ACA cage size not published, left out"},
    "fights": fights})
json.dump(seed, open('lib/seed.json', 'w'), ensure_ascii=False)
print(f"{'fighter':26} {'record':9} {'tapology':9} {'sherdog':9} rows match added diffs  dob/age     ht    reach country")
for r in report: print(f"{r[0]:26} {r[1]:9} {r[2]:9} {r[3]:9} {r[4]:4} {r[5]:2}/{r[6]:<3} {r[7]:3}   {r[8]:3}   {str(r[9]):11} {str(r[10]):5} {str(r[11]):5} {r[12]}")
print('added', len(report), 'fighters,', len(fights), 'bouts; odds on', sum('odds' in f for f in fights))
