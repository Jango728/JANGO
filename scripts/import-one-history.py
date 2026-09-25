"""Import explicitly labelled Muay Thai rows from saved public MTR profiles.

Usage: python scripts/import-one-history.py PATH_TO_PROFILES
The directory contains slugs.json (fighter id -> profile slug) and slug.html.
Only completed bouts strictly before the card date are admitted.
"""
import json, re, sys
from pathlib import Path
from datetime import datetime
from lxml import html

repo = Path(__file__).resolve().parents[1]
source_dir = Path(sys.argv[1])
seed_path = repo / 'lib/seed.json'
seed = json.loads(seed_path.read_text())
slugs = json.loads((source_dir / 'slugs.json').read_text())
cutoff = next(e['date'] for e in seed['events'] if e['id'] == 'one170')
clean = lambda node: ' '.join(node.text_content().split())
report = {}
for fighter_id, slug in sorted(slugs.items()):
    doc = html.parse(str(source_dir / (slug + '.html')))
    profile = 'https://muaythairecords.com/fighters/' + slug
    history = {}
    for row in doc.xpath('//a[contains(@href,"/fighters/")]/parent::div/parent::div'):
        children = row.xpath('./div')
        if len(children) != 3:
            continue
        detail, opponent, event = map(clean, children)
        if not detail.endswith('Muay Thai'):
            continue
        result = re.match(r'^(WIN|LOSS|DRAW|NC)\s+(.+?)\s*(?:-|$)', detail)
        date = re.search(r'(\d+)(?:st|nd|rd|th) (\w+) (\d{4})', event)
        if not result or not date or not opponent:
            continue
        date = datetime.strptime(' '.join(date.groups()), '%d %b %Y').strftime('%Y-%m-%d')
        if date >= cutoff:
            continue
        links = children[2].xpath('.//a[contains(@href,"/events/")]')
        if not links:
            continue
        name, url = clean(links[0]), links[0].get('href')
        method = result[2].strip()
        round_match = re.search(r'\bR(\d+)\b', method)
        method = re.sub(r'\s*R\d+\b', '', method).strip()
        method = {'UD':'Decision (Unanimous)', 'SD':'Decision (Split)', 'MD':'Decision (Majority)', 'DEC':'Decision'}.get(method, method)
        h = dict(opponent=opponent,date=date,result={'WIN':'W','LOSS':'L','DRAW':'D','NC':'NC'}[result[1]],promotion='ONE' if name.startswith(('ONE ', 'The Inner Circle')) else re.sub(r'\s+\d.*$', '', name),method=method,rules='Muay Thai',eventName=name,source=url)
        if round_match:
            h['round'] = int(round_match[1])
        weight = re.search(r'/\s*([\d.]+)\s*LBS', detail)
        if weight:
            h['weightLbs'] = float(weight[1])
            # ONE's named divisions differ from stadium Muay Thai divisions.
            if h['promotion'] == 'ONE':
                h['division'] = {115:'Atomweight',125:'Strawweight',135:'Flyweight',145:'Bantamweight',155:'Featherweight',170:'Lightweight',185:'Welterweight',205:'Middleweight',225:'Light Heavyweight',265:'Heavyweight'}.get(h['weightLbs'], 'Catchweight')
        history[(date,opponent)] = h
    if fighter_id == 'maisangngern-sor-yingcharoenkarnchang':
        source = 'https://www.onefc.com/videos/down-and-out-maisangngern-kos-suajan-in-a-muay-thai-slugfest/'
        history[('2025-08-29','Suajan Sor Isarachot')] = dict(opponent='Suajan Sor Isarachot',date='2025-08-29',result='W',promotion='ONE',method='KO',round=2,rules='Muay Thai',eventName='ONE Friday Fights 122',source=source)
    rows = sorted(history.values(), key=lambda h:h['date'], reverse=True)
    f = seed['fighters'][fighter_id]
    for label, key in [('Height:','height'),('Reach:','reach')]:
        labels = doc.xpath('//span[normalize-space(text())="'+label+'"]')
        if labels:
            value = re.search(r'(\d+(?:\.\d+)?)\s*cm',clean(labels[0].getparent()))
            if value:
                f[key] = float(value[1])
    f.update(history=rows,historyComplete=False,historySource=profile,historyChecked='2026-09-11',recordScope='Indexed Muay Thai bouts',recordNote='Record counts the sourced Muay Thai bouts below, not the complete career. Boxing, kickboxing and other rules are excluded; opponent pre-fight records remain unverified.')
    f['record'] = '-'.join(str(sum(h['result']==v for h in rows)) for v in ('W','L','D'))
    nc = sum(h['result']=='NC' for h in rows)
    if nc:
        f['recordScope'] += ' · '+str(nc)+' NC'
    f['sources'] = [s for s in f['sources'] if s['url'] != profile] + [dict(label='Muay Thai Records · indexed history',url=profile,checked='2026-09-11',note=f['recordNote'])]
    report[fighter_id] = dict(bouts=len(rows),record=f['record'],source=profile)
    if not rows:
        f.pop('record', None)
seed_path.write_text(json.dumps(seed,ensure_ascii=False,indent=2)+'\n')
(repo/'lib/one-history-coverage.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
