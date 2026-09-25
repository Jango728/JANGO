#!/usr/bin/env python3
"""Apply the confirmed Allen-to-Keita UFC 333 replacement before enrichment."""
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
seed_path=ROOT/'lib'/'seed.json'
spec=importlib.util.spec_from_file_location('collector',ROOT/'scripts'/'collect-history.py')
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)
profile=collector.parse('https://www.sherdog.com/fighter/Losene-Keita-287481')
if not profile: raise RuntimeError('Losene Keita profile unavailable')
seed=json.loads(seed_path.read_text())
event=next(e for e in seed['events'] if e['id']=='ufc333')
fight=next(f for f in event['fights'] if 'arnold-allen' in (f['a'],f['b']))
if fight['a']=='arnold-allen': fight['a']='losene-keita'
else: fight['b']='losene-keita'
fight['id']=fight['id'].replace('arnold-allen','losene-keita')
fight['notes']=['Aaron Pico vs Losene Keita replacement verified from the Sherdog card and current reporting on September 23, 2026.']
seed['fighters']['losene-keita']={
 'id':'losene-keita','name':'Losene Keita','record':'17-2-0','country':profile.get('country','Belgium'),
 'height':profile.get('height'),'birthDate':profile.get('birthDate'),'history':profile['history'],
 'historyComplete':profile['historyComplete'],'ufcHistoryComplete':False,
 'historySource':profile['historySource'],'historyChecked':'2026-09-23','profile':profile['historySource'],
 'sources':[{'label':'Sherdog professional fight history','url':profile['historySource'],'checked':'2026-09-23'}],
 'recordNote':'UFC 333 replacement verified September 23, 2026. UFC profile measurements and portrait remain pending.'
}
used={x for e in seed['events'] for f in e['fights'] for x in (f['a'],f['b'])}
seed['fighters']={k:v for k,v in seed['fighters'].items() if k in used}
seed_path.write_text(json.dumps(seed,indent=2,ensure_ascii=False)+'\n')
print('Patched UFC 333: Aaron Pico vs Losene Keita')
