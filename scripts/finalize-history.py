"""Resolve reviewed name variants and reconstruct pre-bout records from cached sources."""
import importlib.util,json,re,hashlib,concurrent.futures
from pathlib import Path
spec=importlib.util.spec_from_file_location('fight_collector',Path(__file__).with_name('collect-history.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
path=Path('/workspace/scratch/fight-research/enriched.json');data=json.loads(path.read_text())
# Identities verified against the corresponding opponent's dated upcoming bout listing.
extra={'andrey-koshkin':'/fighter/Andrei-Koshkin-48950','shamil-ramazanov':'/fighter/Shamil-Ramazanov-236207','hiroba-minowa':'/fighter/Koha-Minowa-211597','razhabali-shaydullaev':'/fighter/Rajabali-Shaidullaev-365469','roberto-satoshi-souza':'/fighter/Roberto-Satoshi-de-Souza-148081','ya-man':'/fighter/Ren-Sugiyama-397380','ryo-takagi':'/fighter/Ryo-Takagi-390300'}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
 for fid,p in zip(extra,ex.map(m.parse,[m.BASE+u for u in extra.values()])):
  if p:data[fid]=p
seed=json.loads(Path('lib/seed.json').read_text())
for fid,paths in {'michel-silva':['/fighter/Michel-Silva-70412','/fighter/Michel-Silva-85813','/fighter/Michel-Silva-139805','/fighter/Michel-Silva-144247','/fighter/Michel-Silva-149161','/fighter/Michel-Silva-343951','/fighter/Michel-Silva-493417'],'muslim-ibragimov':['/fighter/Muslim-Ibragimov-235573','/fighter/Muslim-Ibragimov-365403']}.items():
 candidates=[p for u in paths if (m.CACHE/(hashlib.sha256((m.BASE+u).encode()).hexdigest()+'.html')).exists() and (p:=m.parse(m.BASE+u))]
 matches=[p for p in candidates if p['record'].removesuffix('-0')==seed['fighters'][fid].get('record','').removesuffix('-0')]
 if len(matches)==1:data[fid]=matches[0]
# Reparse cached pages with the corrected draw and unknown-round handling.
for fid,p in list(data.items()):data[fid]=m.parse(p['historySource']) or p
opponents={}
for p in m.CACHE.glob('*.html'):
 h=p.read_text();match=re.search(r'<meta property="og:url" content="(//www.sherdog.com/fighter/[^\"]+)"',h)
 if match:
  u='https:'+match[1];cachefile=m.CACHE/(hashlib.sha256(u.encode()).hexdigest()+'.html')
  if cachefile.exists():
   q=m.parse(u)
   if q:opponents[u]=q
opponents.update({p['historySource']:p for p in data.values()})
for p in data.values():
 for x in p['history']:
  o=opponents.get(x['opponentSource'])
  if not o or not o['historyComplete']:continue
  rows=[y for y in o['history'] if y['date']<x['date']]
  x['opponentRecord']=m.record(rows);x['opponentRecordBasis']='reconstructed'
  if o['height']:x['opponentCurrentHeight']=o['height'];x['opponentMeasurementsAsOf']=m.CHECKED
  x['opponentPromotionBouts']=sum(y['promotion']==x['promotion'] for y in rows)
  second=[]
  for y in rows[:10]:
   q=opponents.get(y['opponentSource'])
   if q and q['historyComplete']:
    prior=[z for z in q['history'] if z['date']<y['date']];w,l,d=map(int,m.record(prior).split('-'));second.append((w+.5*d+2)/(w+l+d+4))
  if len(second)>=3:x['secondLevel']=sum(second)/len(second);x['secondLevelCount']=len(second)
path.with_name('enriched-final.json').write_text(json.dumps(data,indent=2))
print('Final dataset:',len(data),'fighters;',sum(len(p['history']) for p in data.values()),'bouts;',sum('opponentRecord' in h for p in data.values() for h in p['history']),'pre-bout opponent records',flush=True)
