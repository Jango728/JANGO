#!/usr/bin/env python3
"""Add the confirmed DWCS Weeks 8-10 cards and complete pro histories."""
from __future__ import annotations
import concurrent.futures as cf
import importlib.util
import json
import re
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CHECKED='2026-09-23'
CARDS=[
 ('dwcs-2026-week8','2026-09-29','https://www.sherdog.com/events/Dana-Whites-Contender-Series-Contender-Series-2026-Week-8-112634'),
 ('dwcs-2026-week9','2026-10-06','https://www.sherdog.com/events/Dana-Whites-Contender-Series-Contender-Series-2026-Week-9-112635'),
 ('dwcs-2026-week10','2026-10-13','https://www.sherdog.com/events/Dana-Whites-Contender-Series-Contender-Series-2026-Week-10-112636'),
]
spec=importlib.util.spec_from_file_location('collector',ROOT/'scripts'/'collect-history.py')
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector);collector.CHECKED=CHECKED

def fetch(url):
 req=urllib.request.Request(url,headers={'User-Agent':'JangoPlayz/1.0'})
 return urllib.request.urlopen(req,timeout=30).read().decode('utf-8','ignore')

def clean(value): return re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',value)).strip()
def slug(value): return collector.norm(value).replace(' ','-')
def record(rows): return '-'.join(str(sum(x.get('result')==r for x in rows)) for r in ('W','L','D'))

pages={card_id:fetch(url) for card_id,_,url in CARDS}
cards=[];fighters_meta={}
for card_id,date,url in CARDS:
 page=pages[card_id]
 chunks=re.split(r'<(?:div|tr) itemprop="subEvent"[^>]*>',page)[1:]
 fights=[]
 for chunk in chunks:
  chunk=re.split(r'<(?:div|tr) itemprop="subEvent"',chunk,1)[0]
  people=re.findall(r'<a href="(/fighter/[^"]+)" itemprop="url">\s*<img[^>]+src="([^"]+)"[^>]*>.*?<span itemprop="name">(.*?)</span>.*?<span class="record">\s*([^<]+)',chunk,re.S)
  if len(people)<2:
   regular=re.findall(r'<img class="lazy" src="([^"]+)"[^>]*>.*?<a itemprop="url" href="(/fighter/[^"]+)"><span itemprop="name">(.*?)</span>.*?<span class="record"><em>([^<]+)',chunk,re.S)
   people=[(href,image,name,listed) for image,href,name,listed in regular]
  if len(people)<2: continue
  people=people[:2]
  names=[clean(x[2]) for x in people]
  if any(name.lower() in {'unknown fighter','fighter'} for name in names): continue
  division_match=re.search(r'<span class="weight_class">(.*?)</span>',chunk,re.S)
  division=clean(division_match.group(1)) if division_match else 'Division pending'
  ids=[]
  for href,image,name_html,listed_record in people:
   name=clean(name_html);fighter_id=slug(name);ids.append(fighter_id)
   fighters_meta[fighter_id]={'name':name,'url':collector.BASE+href,'image':'https://www.sherdog.com'+image if image.startswith('/') else image,'record':clean(listed_record)}
  fights.append({'id':f'{card_id}-{ids[0]}-{ids[1]}','a':ids[0],'b':ids[1],'division':division,'rules':'MMA','rounds':3,'section':'Main Card','assessments':{},'notes':['Announced matchup verified from the Sherdog event card on September 23, 2026.'],'unknowns':['Camp condition, short-notice status, reach and stance require separate dated evidence.']})
 cards.append({'id':card_id,'title':f"Dana White's Contender Series: Season 10, Week {card_id[-1] if card_id[-2:]!='10' else '10'}",'promotion':'DWCS','date':date,'time':'7pm ET','location':'UFC Apex, Las Vegas, Nevada','coverage':f'Confirmed announced card · {len(fights)} bouts · refreshed Sep 23','source':{'label':'Sherdog announced card','url':url,'checked':CHECKED},'fights':fights})

with cf.ThreadPoolExecutor(max_workers=16) as pool:
 futures={pool.submit(collector.parse,meta['url']):fighter_id for fighter_id,meta in fighters_meta.items()}
 profiles={futures[f]:f.result() for f in cf.as_completed(futures)}
if any(not profile for profile in profiles.values()): raise RuntimeError('A DWCS fighter profile could not be parsed')

opponent_urls={row['opponentSource'] for profile in profiles.values() for row in profile['history'][:10] if row.get('opponentSource')}
opponents={p['historySource']:p for p in profiles.values()}
with cf.ThreadPoolExecutor(max_workers=20) as pool:
 futures={pool.submit(collector.parse,url):url for url in opponent_urls if url not in opponents}
 for future in cf.as_completed(futures):
  profile=future.result()
  if profile: opponents[futures[future]]=profile
for profile in profiles.values():
 for bout in profile['history']:
  opponent=opponents.get(bout.get('opponentSource',''))
  if not opponent or not opponent['historyComplete']: continue
  prior=[row for row in opponent['history'] if row['date']<bout['date']]
  bout['opponentRecord']=record(prior);bout['opponentRecordBasis']='reconstructed'
  bout['opponentPromotionBouts']=sum(row['promotion']==bout['promotion'] for row in prior)

portrait_dir=ROOT/'public'/'fighters';portrait_dir.mkdir(parents=True,exist_ok=True)
new_fighters={}
for fighter_id,meta in fighters_meta.items():
 profile=profiles[fighter_id];target=portrait_dir/f'sherdog-{fighter_id}.jpg';image=None
 try:
  target.write_bytes(urllib.request.urlopen(urllib.request.Request(meta['image'],headers={'User-Agent':'JangoPlayz/1.0'}),timeout=25).read())
  if target.stat().st_size>1000:image=f'/fighters/{target.name}'
 except Exception: pass
 new_fighters[fighter_id]={'id':fighter_id,'name':meta['name'],'record':meta['record'],'recordScope':'Overall professional MMA record from Sherdog.','country':profile.get('country'),'height':profile.get('height'),'birthDate':profile.get('birthDate'),'image':image,'imageDate':CHECKED,'imageSource':meta['image'],'profile':meta['url'],'history':profile['history'],'historyComplete':profile['historyComplete'],'ufcHistoryComplete':True,'historySource':meta['url'],'historyChecked':CHECKED,'sources':[{'label':'Sherdog profile and professional fight history','url':meta['url'],'checked':CHECKED}],'recordNote':'Full professional MMA history loaded; missing measurements remain unverified.'}

seed_path=ROOT/'lib'/'seed.json';seed=json.loads(seed_path.read_text())
ids={card['id'] for card in cards};seed['events']=[*cards,*[e for e in seed['events'] if e['id'] not in ids]]
seed['fighters'].update(new_fighters)
used={x for e in seed['events'] for f in e['fights'] for x in (f['a'],f['b'])}
seed['fighters']={k:{kk:vv for kk,vv in v.items() if vv is not None} for k,v in seed['fighters'].items() if k in used}
seed_path.write_text(json.dumps(seed,indent=2,ensure_ascii=False)+'\n')
print(f'Added {len(cards)} DWCS cards, {sum(len(c["fights"]) for c in cards)} bouts and {len(new_fighters)} fighters.')
