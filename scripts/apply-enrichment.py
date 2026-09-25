"""Apply reviewed public-source collection to the dated bundled research snapshot."""
import json,re,html
from pathlib import Path
root=Path(__file__).resolve().parent.parent
seed=json.loads((root/'lib/seed.json').read_text())
legacy=json.loads((root/'lib/legacy-fighters.json').read_text())
profiles=json.loads(Path('/workspace/scratch/fight-research/enriched-final.json').read_text())
for fid,p in profiles.items():
 f=seed['fighters'][fid];f['recordNote']=legacy.get(fid,{}).get('recordNote',''); f['history']=[{k:v for k,v in h.items() if v is not None and not(k=='round' and not v)} for h in p['history']];f['historyComplete']=p['historyComplete'];f['historySource']=p['historySource'];f['historyChecked']='2026-09-10';f['ufcHistoryComplete']=p['historyComplete']
 if p['country']:f['country']=p['country']
 if not f.get('record'):f['record']=p['record']
 elif f['record'].removesuffix('-0')!=p['record'].removesuffix('-0'):f['recordNote']=f"Promotion profile reports {f['record']}; reconstructed Sherdog record is {p['record']}. Review this discrepancy before relying on the overall total."
 if p['nc']:f['recordNote']=(f.get('recordNote','')+' '+str(p['nc'])+' no contest(s), kept separate.').strip()
 if not f.get('height') and p['height']:f['height']=p['height']
 if p['birthDate'] and re.fullmatch(r'\d{4}-\d{2}-\d{2}',p['birthDate']):f['birthDate']=p['birthDate']
 f['sources']=[x for x in f['sources'] if 'Sherdog' not in x['label']]+[{'label':'Sherdog professional fight history','url':p['historySource'],'checked':'2026-09-10','note':'Full pro MMA results verified against the listed totals where labelled complete. Opponent pre-bout records reconstructed from dated results. No editorial predictions or odds used.'}]
divfile=Path('/workspace/scratch/fight-research/divisions.json')
if divfile.exists():
 divisions=json.loads(divfile.read_text())
 for f in seed['fighters'].values():
  for h in f['history']:
   for row in divisions.get(h.get('source',''),[]):
    if f.get('historySource','').replace('https://www.sherdog.com','') in row['fighters'] and h.get('opponentSource','').replace('https://www.sherdog.com','') in row['fighters']:h['division']=row['division']
seed['fighters']['jean-silva']['tapology']='https://www.tapology.com/fightcenter/fighters/144286-jean-silva'
seed['fighters']['jose-miguel-delgado']['profile']='https://www.ufc.com/athlete/jose-miguel-delgado'
seed['fighters']['rongzhu']['profile']='https://www.ufc.com/athlete/rong-zhu'
files=list(Path('/workspace/scratch/fight-assets').glob('*-source.html'))+list(Path('/workspace/scratch/fight-research').glob('*.html'))
byurl={}
for p in files:
 h=p.read_text();m=re.search('<link rel="canonical" href="([^"]+)',h)
 if m and m[1].startswith('https://www.ufc.com/athlete/') and m[1] not in byurl:byurl[m[1]]=h
fields={'Sig. Str. Landed':'slpm','Sig. Str. Absorbed':'sapm','Takedown avg':'tdPer15','Submission avg':'subPer15','Sig. Str. Defense':'strikeDefense','Takedown Defense':'tdDefense','Knockdown Avg':'kdPer15'}
clean=lambda x:re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]*>',' ',x))).strip()
for f in seed['fighters'].values():
 h=byurl.get(f.get('profile',''))
 if not h:continue
 vals={clean(k):clean(v) for v,k in re.findall(r'class="c-stat-compare__number">(.*?)</div>\s*<div class="c-stat-compare__label">(.*?)</div>',h,re.S)}
 stats={}
 for label,key in fields.items():
  if label in vals:
   m=re.search(r'[\d.]+',vals[label])
   if m:stats[key]=float(m[0])
 for label,key in [('Striking accuracy','strikeAccuracy'),('Takedown Accuracy','tdAccuracy')]:
  m=re.search(r'<title>'+label+r' (\d+)%</title>',h,re.I)
  if m:stats[key]=float(m[1])
 if len(stats)>=3:
  f['stats']={'asOf':'2026-09-10','source':f['profile'],'scope':'UFC profile career aggregate; reporting sample not fully specified',**stats}
  f['sources']=[x for x in f['sources'] if x['label']!='Official UFC combat statistics']+[{'label':'Official UFC combat statistics','url':f['profile'],'checked':'2026-09-10','note':'Career profile aggregates, not per-bout last-10 statistics. Not used for events on or before this collection date.'}]
for e in seed['events']:
 for f in e['fights']:
  f['assessments']={};f['notes']=[];f.pop('odds',None)
(root/'lib/seed.json').write_text(json.dumps(seed,ensure_ascii=False,indent=2)+'\n')
print('Applied',len(profiles),'histories;',sum(f.get('historyComplete',False) for f in seed['fighters'].values()),'complete;',sum(bool(f.get('stats')) for f in seed['fighters'].values()),'combat profiles')
