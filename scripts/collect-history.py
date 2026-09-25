"""Refresh public factual MMA histories. Never extracts odds, rankings or editorial picks.
Run from the project root. Raw source cache lives outside the repository.
All inferred pre-bout records use dated professional results and are labelled reconstructed.
"""
import concurrent.futures as cf
import datetime as dt
import hashlib
import html
import json
from pathlib import Path
import re
import unicodedata
import urllib.parse
import urllib.request

CACHE=Path('/workspace/scratch/fight-research/history-cache'); CACHE.mkdir(parents=True,exist_ok=True)
OUT=Path('/workspace/scratch/fight-research/enriched.json')
BASE='https://www.sherdog.com'
CHECKED='2026-09-10'
def clean(s): return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',s))).strip()
def norm(s): return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
def fetch(url):
    p=CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.html')
    if p.exists(): return p.read_text()
    try:
        with urllib.request.urlopen(url,timeout=18) as r: h=r.read().decode()
        if 'Checking your browser' in h or 'FIGHT HISTORY' not in h and '/fighter/' in url: return ''
        p.write_text(h); return h
    except Exception: return ''
def record(rows):
    return '-'.join(str(sum(x['result']==r for x in rows)) for r in ['W','L','D'])
def parse(url):
    h=fetch(url)
    if not h:return None
    name=re.search(r'<span class="fn"[^>]*>(.*?)</span>',h,re.S)
    if not name:return None
    title=clean(name[1]); history=[]
    body=h[h.find('FIGHT HISTORY - PRO'):]
    table=re.search(r'<table[^>]*>(.*?)</table>',body,re.S)
    if not table:return None
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>',table[1],re.S):
        cols=re.findall(r'<td\b[^>]*>(.*?)</td>',row,re.S)
        if len(cols)<6:continue
        res=re.search(r'final_result ([^" ]+)',cols[0]);opp=re.search(r'href="(/fighter/[^\"]+)"[^>]*>(.*?)</a>',cols[1],re.S)
        event=re.search(r'href="(/events/[^\"]+)"[^>]*>(.*?)</a>',cols[2],re.S)
        date=re.search(r'(\w{3}) / (\d{1,2}) / (\d{4})',clean(cols[2]));method=re.search(r'<b>(.*?)</b>',cols[3],re.S)
        if not all([res,opp,event,date,method]):continue
        result={'win':'W','loss':'L','draw':'D','nc':'NC','no_contest':'NC'}.get(res[1])
        if not result:continue
        day=dt.datetime.strptime(' '.join(date.groups()),'%b %d %Y').date().isoformat()
        ename=clean(event[2]);promo=ename.split(' - ')[0]
        if 'Road to UFC' in ename:promo='Road to UFC'
        elif ename.startswith('UFC'):promo='UFC'
        elif 'Contender Series' in ename:promo='DWCS'
        elif ename.startswith('PFL'):promo='PFL'
        elif ename.startswith('ACA'):promo='ACA'
        elif ename.startswith('ACB'):promo='ACB'
        elif ename.startswith('Rizin'):promo='RIZIN'
        elif ename.lower().startswith('oktagon'):promo='OKTAGON'
        elif ename.startswith('ONE'):promo='ONE'
        x={'opponent':clean(opp[2]),'date':day,'result':result,'promotion':promo,'eventName':ename,'method':clean(method[1]),'rules':'MMA','source':BASE+event[1],'opponentSource':BASE+opp[1]}
        if clean(cols[4]).isdigit() and int(clean(cols[4]))>0:x['round']=int(clean(cols[4]))
        t=re.fullmatch(r'(\d+):(\d+)',clean(cols[5]))
        if t and x.get('round') and x['round']<=5:
            x['time']=clean(cols[5])
            # Standard modern MMA format only; unusual older formats remain unknown.
            if day>='2001-01-01' and (promo in ['UFC','DWCS','PFL','ACA','ACB','OKTAGON','ONE'] or ename.startswith('Bellator')):x['minutes']=round((x['round']-1)*5+int(t[1])+int(t[2])/60,3)
        history.append(x)
    counts={}
    for k,label in [('W','win'),('L','lose'),('D','draws'),('NC','nc')]:
        m=re.search(r'class="winloses '+label+r'"[^>]*>\s*<span>[^<]*</span>\s*<span>(\d+)</span>',h,re.S)
        counts[k]=int(m[1]) if m else 0
    complete=bool(history) and all(sum(x['result']==k for x in history)==v for k,v in counts.items())
    country=re.search(r'itemprop="nationality"[^>]*>(.*?)</',h,re.S)
    ht=re.search(r'itemprop="height"[^>]*>(.*?)</td>',h,re.S)
    height=re.search(r'([\d.]+)\s*cm',clean(ht[1])) if ht else None
    dob=re.search(r'itemprop="birthDate"[^>]*>(.*?)</',h,re.S)
    birth=None
    if dob:
        try:birth=dt.datetime.strptime(clean(dob[1]),'%b %d, %Y').date().isoformat()
        except ValueError:pass
    return {'name':title,'history':sorted(history,key=lambda x:x['date'],reverse=True),'historyComplete':complete,'record':record(history),'nc':counts['NC'],'historySource':url,'country':clean(country[1]) if country else None,'height':float(height[1]) if height else None,'birthDate':birth}

def main():
    seed=json.loads(Path('lib/seed.json').read_text())
    mma={fid for e in seed['events'] for f in e['fights'] if f['rules']=='MMA' for fid in [f['a'],f['b']]}
    event=Path('/workspace/scratch/fight-research/sherdog-event-noche.html').read_text()
    known={norm(clean(n)):BASE+u for u,n in re.findall(r'<a[^>]*href="(/fighter/[^\"]+)"[^>]*>(.*?)</a>',event,re.S) if clean(n)}
    known.update({norm(seed['fighters'][fid]['name']):BASE+u for fid,u in {'andrey-koshkin':'/fighter/Andrei-Koshkin-48950','shamil-ramazanov':'/fighter/Shamil-Ramazanov-236207','hiroba-minowa':'/fighter/Koha-Minowa-211597','razhabali-shaydullaev':'/fighter/Rajabali-Shaidullaev-365469','roberto-satoshi-souza':'/fighter/Roberto-Satoshi-de-Souza-148081','ya-man':'/fighter/Ren-Sugiyama-397380','ryo-takagi':'/fighter/Ryo-Takagi-390300'}.items()})
    known[norm('Jose Miguel Delgado')]=BASE+'/fighter/Jose-Delgado-307733'
    known[norm('Rongzhu')]=BASE+'/fighter/Zhu-Rong-233823'
    known[norm('Sean King III')]=BASE+'/fighter/Sean-King-423706'
    known[norm('Tommy Gantt')]=known.get(norm('Thomas Gantt'),'')
    def resolve(fid):
        f=seed['fighters'][fid];u=known.get(norm(f['name']))
        if u:
            p=parse(u)
            if p:return fid,p
        page=fetch(BASE+'/stats/fightfinder?'+urllib.parse.urlencode({'SearchTxt':f['name']}))
        candidates={BASE+u for u,n in re.findall(r'<a[^>]*href="(/fighter/[^\"]+)"[^>]*>(.*?)</a>',page,re.S) if norm(clean(n))==norm(f['name'])}
        found=[p for u in candidates if (p:=parse(u))]
        if len(found)==1:return fid,found[0]
        exact=[p for p in found if p['record'].removesuffix('-0')==(f.get('record') or '').removesuffix('-0')]
        return fid,exact[0] if len(exact)==1 else None
    
    profiles={}
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for fid,p in ex.map(resolve,sorted(mma,key=lambda x:(x not in {f['a'] for f in seed['events'][0]['fights']}|{f['b'] for f in seed['events'][0]['fights']},x))):
            if p: profiles[fid]=p
            print('Profile',fid,len(p['history']) if p else 'unresolved',flush=True)
    OUT.write_text(json.dumps(profiles,indent=2))
    opponent_urls={x['opponentSource'] for p in profiles.values() for x in p['history'][:10]}
    opponents={p['historySource']:p for p in profiles.values()}
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for u,p in zip(sorted(opponent_urls-opponents.keys()),ex.map(parse,sorted(opponent_urls-opponents.keys()))):
            if p:opponents[u]=p
    print('Opponent profiles',len(opponents),flush=True)
    for p in profiles.values():
        for x in p['history']:
            o=opponents.get(x['opponentSource'])
            if not o or not o['historyComplete']:continue
            rows=[y for y in o['history'] if y['date']<x['date']]
            x['opponentRecord']=record(rows); x['opponentRecordBasis']='reconstructed'
            # Current profile measurements are displayed with date, not treated as historical size.
            
            if o['height']:x['opponentCurrentHeight']=o['height']
            x['opponentMeasurementsAsOf']=CHECKED
            x['opponentPromotionBouts']=sum(y['promotion']==x['promotion'] for y in rows)
            second=[]
            for y in rows[:10]:
                q=opponents.get(y['opponentSource'])
                if q and q['historyComplete']:
                    prior=[z for z in q['history'] if z['date']<y['date']]
                    w,l,d=map(int,record(prior).split('-'));second.append((w+.5*d+2)/(w+l+d+4))
            if len(second)>=3:
                x['secondLevel']=sum(second)/len(second);x['secondLevelCount']=len(second)
    OUT.write_text(json.dumps(profiles,indent=2))
    print('Saved',len(profiles),'fighters',sum(len(p['history']) for p in profiles.values()),'bouts',flush=True)

if __name__=='__main__':main()
