"""Read weight classes from frequently shared public event result pages."""
from pathlib import Path
import json,hashlib,re,html,urllib.request,concurrent.futures
cache=Path('/workspace/scratch/fight-research/history-cache')
profiles=json.loads(Path('/workspace/scratch/fight-research/enriched.json').read_text())
freq={}
for p in profiles.values():
 for h in p['history'][:10]:freq[h['source']]=freq.get(h['source'],0)+1
urls=sorted(freq,key=lambda u:-freq[u])[:80]
output=Path('/workspace/scratch/fight-research/divisions.json');result=json.loads(output.read_text()) if output.exists() else {}
def fetch(u):
 p=cache/(hashlib.sha256(u.encode()).hexdigest()+'.html')
 try:
  if p.exists():h=p.read_text()
  else:
   h=urllib.request.urlopen(u,timeout=15).read().decode();p.write_text(h)
  parts=re.findall(r'<tr\b[^>]*>(.*?)</tr>',h,re.S)
  # The main event is outside the table.
  a=h.find('<div class="fight_card">');b=h.find('class="new_table',a)
  if a>=0:parts.append(h[a:b])
  rows=[]
  for part in parts:
   m=re.search(r'class="weight_class">(.*?)</span>',part,re.S)
   fighters=set(re.findall(r'href="(/fighter/[^\"]+)',part))
   if m and len(fighters)==2:
    division=html.unescape(re.sub('<[^>]*>','',m[1])).strip()
    if division:rows.append({'fighters':sorted(fighters),'division':division})
  return u,rows
 except Exception:return u,[]
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
 for u,rows in ex.map(fetch,[u for u in urls if u not in result]):
  if rows:result[u]=rows
  output.write_text(json.dumps(result,indent=2))
print('Verified weight classes from',len(result),'event pages',flush=True)
