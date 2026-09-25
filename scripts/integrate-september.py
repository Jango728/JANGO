"""Integrate verified research snapshots. Does not modify user workspaces or locked picks."""
import json,re,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RESEARCH=ROOT.parent
seed=json.loads((ROOT/'lib/baseline-v6.json').read_text())
def read(p):return json.loads(p.read_text())
def slug(s):return re.sub('[^a-z0-9]+','-',s.lower()).strip('-')
FIELDS={'opponent','date','result','promotion','method','round','minutes','time','rules','division','weightLbs','eventName','opponentRecord','opponentRecordBasis','opponentSource','opponentHeight','opponentReach','opponentCurrentHeight','opponentMeasurementsAsOf','opponentPromotionBouts','opponentStyle','secondLevel','secondLevelCount','source'}
def sourced(f,kind):
 out={'id':slug(f['name']),'name':f['name'],'history':[],'historyComplete':f['historyComplete'],'ufcHistoryComplete':f['historyComplete'],'historyChecked':'2026-09-14','historySource':f['historySource'],'sources':[{'label':'Full professional MMA history','url':f['historySource'],'checked':'2026-09-14'}]}
 for k in ['height','reach','country','birthDate','record']:
  if f.get(k) is not None:out[k]=f[k]
 for row in f['history']:
  h={k:v for k,v in row.items() if k in FIELDS and v is not None}
  if h.get('round',1)<1:h.pop('round',None);h.pop('minutes',None)
  if h.get('opponentRecordBasis'):h['opponentRecordBasis']='reconstructed'
  out['history'].append(h)
 out['history'].sort(key=lambda x:x['date'],reverse=True)
 if f.get('nc'):out['recordNote']=str(f['nc'])+' no contest(s), listed separately from W–L–D.'
 if kind=='ufc':
  out['profile']=f['profileURL'];out['imageSource']=f['profileURL'];photo=f.get('portraitLocalPath');out['sources'].append({'label':'Official UFC profile and combat statistics','url':out['profile'],'checked':'2026-09-14'})
  bio=f.get('officialBio',{});out['style']=bio.get('Fighting style','')
  if f.get('officialHeight') and out.get('height') and abs(f['officialHeight']-out['height'])>.5:out['recordNote']=(out.get('recordNote','')+' Height differs between sources: Sherdog '+str(out['height'])+' cm; UFC '+str(f['officialHeight'])+' cm. Sherdog measurement displayed.').strip()
  mapping={'slpm':'Sig. Str. Landed','sapm':'Sig. Str. Absorbed','tdPer15':'Takedown avg','subPer15':'Submission avg','strikeDefense':'Sig. Str. Defense','tdDefense':'Takedown Defense','kdPer15':'Knockdown Avg','strikeAccuracy':'Striking accuracy','tdAccuracy':'Takedown Accuracy'}
  stats={'source':out['profile'],'asOf':'2026-09-14','scope':'Official UFC career profile aggregates'}
  for key,label in mapping.items():
   raw=f.get('officialCombatStats',{}).get(label,{}).get('value')
   if raw is not None:
    try:stats[key]=float(raw.replace('%','').strip())
    except ValueError:pass
  if len(stats)>3:out['stats']=stats
 else:
  out['profile']=f['historySource'];out['imageSource']=f['photoSource'];photo=f.get('portraitLocal')
 if photo and Path(photo).exists():
  dest=ROOT/'public/fighters'/(out['id']+Path(photo).suffix.lower());shutil.copyfile(photo,dest);out['image']='/fighters/'+dest.name
 return out
ufc=read(RESEARCH/'research-331/ufc331.json');ufc_fighters=read(RESEARCH/'research-331/enriched-fighters.json');dwcs=read(RESEARCH/'research-dwcs/card.json');dwcs_fighters=read(RESEARCH/'research-dwcs/enriched-fighters.json')
for key,f in ufc_fighters.items():seed['fighters'][key]=sourced(f,'ufc');seed['fighters'][key]['id']=key
for key,f in dwcs_fighters.items():seed['fighters'][key]=sourced(f,'dwcs');seed['fighters'][key]['id']=key
card={'id':'ufc331','title':'UFC 331: Van vs. Pantoja 2','promotion':'UFC','date':'2026-09-19','time':'Main card 9pm ET · early prelims 5pm ET','location':ufc['venue'],'coverage':'Full card · 12 bouts · refreshed Sep 15; Moicano–Ortega removed','source':{'label':'Official UFC card','url':ufc['sourceURL'],'checked':'2026-09-15','note':'Moicano–Ortega removed from latest official listing. Steveson–Sharaf moved to main card.'},'fights':[]}
for row in ufc['bouts']:
 if 'Renato Moicano' in row['names']:continue
 a,b=map(slug,row['names']);division=re.sub(r' (Title )?Bout$','',row['division']);notes=[row['roundsNote']]
 if row['rounds']==5:notes.append('Five-round format confirmed in official UFC announcement: '+ufc['announcementURL'])
 if a=='joshua-van':notes.append('Their first meeting ended by arm injury at 0:26 of round 1. That result is not evidence of a conventional knockout matchup.')
 f={'id':'ufc331-'+a+'-'+b,'a':a,'b':b,'division':division,'rules':'MMA','rounds':row['rounds'],'section':'Main Card' if a=='gable-steveson' else row['section'],'assessments':{},'notes':notes,'unknowns':['No verified current camp-readiness assessment.']}
 if all(re.fullmatch('[+-]?[0-9]+',x or '') for x in row['odds']):f['odds']={'a':int(row['odds'][0]),'b':int(row['odds'][1]),'asOf':'2026-09-14T05:10:53Z','source':ufc['sourceURL']}
 card['fights'].append(f)
dcard={'id':'dwcs-2026-week6','title':'DWCS: Season 10 · Week 6','promotion':'DWCS','date':dwcs['date'],'time':'7pm ET · 23:00 UTC','location':dwcs['venue'],'coverage':'Full card · 5 bouts · all 10 fighters weighed in','source':{'label':'Confirmed weigh-in card','url':dwcs['sources'][1],'checked':'2026-09-14'},'fights':[]}
for row in dwcs['fights']:
 dcard['fights'].append({'id':dcard['id']+'-'+row['a']+'-'+row['b'],'a':row['a'],'b':row['b'],'division':row['division'],'rules':'MMA','rounds':3,'section':'Main event' if row.get('mainEvent') else 'Main Card','assessments':{},'notes':['Three five-minute rounds.','Official weigh-in: '+str(row['weighInA'])+' lb / '+str(row['weighInB'])+' lb.'],'unknowns':['Comparable striking/grappling aggregates not verified.','Reach measurements unavailable.']})
seed['events']=[card,dcard]+[e for e in seed['events'] if e['id'] not in [card['id'],dcard['id']]]
# Append completed results for future analysis, preserving all pre-event rows.
results=read(ROOT/'lib/noche-results.json');noche=next(e for e in seed['events'] if e['id']=='noche-2026')
for fight,actual in zip(noche['fights'],results['bouts']):
 for own,other in [(fight['a'],fight['b']),(fight['b'],fight['a'])]:
  f=seed['fighters'][own];o=seed['fighters'][other]
  if any(h['date']==results['date'] and h['opponent']==o['name'] for h in f['history']):continue
  h={'opponent':o['name'],'date':results['date'],'result':'W' if f['name']==actual['winner'] else 'L','promotion':'UFC','method':actual['detail'] if actual['method']=='DEC' else actual['method']+' ('+actual['detail']+')','round':actual['round'],'time':actual['time'],'minutes':actual['elapsedSeconds']/60,'rules':'MMA','division':fight['division'],'source':results['sources']['officialCard'],'opponentRecord':read(ROOT/'lib/baseline-v6.json')['fighters'][other].get('record',''),'opponentRecordBasis':'reported','opponentSource':o.get('historySource',o.get('profile',''))}
  if actual['method']=='SUB':h['method']='Submission ('+actual['detail']+')'
  f['history'].insert(0,h);f['historyChecked']='2026-09-14'
  if f.get('historyComplete'):f['record']='-'.join(str(sum(x['result']==r for x in f['history'])) for r in ['W','L','D'])
noche['coverage']='Completed · 13 results · archived forecasts in Picks & results'
(ROOT/'lib/seed.json').write_text(json.dumps(seed,ensure_ascii=False,indent=2)+'\n')
print('Integrated',len(card['fights']),'UFC331 bouts,',len(dcard['fights']),'DWCS bouts;',len(seed['fighters']),'fighters')
