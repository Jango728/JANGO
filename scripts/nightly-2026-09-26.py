#!/usr/bin/env python3
"""Nightly refresh 2026-09-26: add UFC FN Oct 10 + Oct 17, UFC 332 late bout, PFL Chicago full card,
display odds, OKTAGON 94 Stand & Bang rules fix. Fighter data from data/research/new-2026-09-26/."""
import json,glob
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; SEED=ROOT/'lib'/'seed.json'
D='2026-09-26'
s=json.load(open(SEED)); F=s['fighters']; E={e['id']:e for e in s['events']}
new={}
for f in sorted(glob.glob(str(ROOT/'data/research/new-2026-09-26/batch*.json'))):
  new.update(json.load(open(f))['fighters'])
for k,v in new.items():
  for r in v['history']:
    if 'method' not in r: r['method']='Unknown'
  F.setdefault(k,v)
def fight(eid,a,b,div,rounds,section,notes,unk=None):
  assert a in F and b in F,(a,b)
  return {'id':f'{eid}-{a}-{b}','a':a,'b':b,'division':div,'rules':'MMA','rounds':rounds,'section':section,'assessments':{},
          'notes':notes,'unknowns':unk or ['Current camp condition and weigh-in status require separate dated evidence.']}
# UFC FN Oct 10
eid='ufc-fn-290'; n=[f'Card from Tapology, checked {D}; UFC.com lists only the main event so far.']
card=[('brendan-allen','christian-leroy-duncan','Middleweight',5,'Main Card'),('matheus-camilo','jai-herbert','Lightweight',3,'Main Card'),
 ('julius-walker','gerald-meerschaert','Light Heavyweight',3,'Main Card'),('loopy-godinez','ketlen-souza',"Women's Strawweight",3,'Main Card'),
 ('malcolm-wellmaker','otari-tanzilovi','Bantamweight',3,'Prelims'),('darya-zheleznyakova','alice-pereira',"Women's Bantamweight",3,'Prelims'),
 ('ernesta-kareckaite','melissa-gatto',"Women's Flyweight",3,'Prelims'),('rj-harris','allen-frye-jr','Heavyweight',3,'Prelims'),
 ('andre-fili','kai-kamaka-iii','Featherweight',3,'Prelims'),('francisco-prado','ismael-bonfim','Lightweight',3,'Prelims'),
 ('niko-price','leon-shahbazyan','Welterweight',3,'Prelims'),('felipe-franco','brendson-ribeiro','Light Heavyweight',3,'Prelims')]
if eid not in E:
  ev={'id':eid,'title':'UFC Fight Night: Allen vs. Duncan','promotion':'UFC','date':'2026-10-10','time':'Prelims 5pm ET · main card 8pm ET',
   'location':'Meta APEX, Las Vegas, NV','coverage':f'Announced card · 12 bouts · added Sep 26 (bout order from Tapology)',
   'source':{'label':'Tapology event page','url':'https://www.tapology.com/fightcenter/events/146495-ufc-fight-night','checked':D,
     'note':'UFC.com (https://www.ufc.com/event/ufc-fight-night-october-10-2026) lists only the main event so far.'},
   'fights':[fight(eid,*c,n) for c in card]}
  s['events'].append(ev)
# UFC FN Oct 17
eid='ufc-fn-291'; n=[f'Card and bout order from UFC.com, checked {D}.']
card=[('joaquin-buckley','mike-malott','Welterweight',5,'Main Card'),('erin-blanchfield','jasmine-jasudavicius',"Women's Flyweight",3,'Main Card'),
 ('kyle-nelson','cristian-perez-gonzalez','Lightweight',3,'Main Card'),('marc-andre-barriault','kyle-daukaus','Middleweight',3,'Main Card'),
 ('louis-jourdain','timmy-cuamba','Bantamweight',3,'Main Card'),('mandel-nallo','nate-landwehr','Lightweight',3,'Main Card'),
 ('tanner-boser','jhonata-diniz','Heavyweight',3,'Prelims'),('julien-leblanc','gilbert-urbina','Middleweight',3,'Prelims'),
 ('javad-mahjoub','joel-faglier','Heavyweight',3,'Prelims'),('jamey-lyn-horth','katlyn-cerminara',"Women's Flyweight",3,'Prelims'),
 ('chad-anheliger','steven-koslow','Bantamweight',3,'Prelims'),('melissa-croden','chelsea-chandler',"Women's Bantamweight",3,'Prelims'),
 ('cody-chovancek','su-young-you','Bantamweight',3,'Prelims')]
if eid not in E:
  fs=[fight(eid,*c,n) for c in card]
  for f in fs:
    if f['a']=='javad-mahjoub': f['notes'].append('Joel Faglier replaced Louie Sutherland (reported Sep 24–25; Tapology lists Sutherland as withdrawn). UFC.com not yet updated.'); f['unknowns'].append('Faglier is a short-notice replacement.')
  s['events'].append({'id':eid,'title':'UFC Fight Night: Buckley vs. Malott','promotion':'UFC','date':'2026-10-17','time':'Prelims 5pm ET · main card 8pm ET',
   'location':'Rogers Place, Edmonton, Alberta, Canada','coverage':'Announced card · 13 bouts · added Sep 26',
   'source':{'label':'Official UFC card','url':'https://www.ufc.com/event/ufc-fight-night-october-17-2026','checked':D},'fights':fs})
# UFC 332 late bout + spelling
ev=E['ufc332']
if 'benardo' not in F['bernardo-sopaj']['name'].lower(): F['bernardo-sopaj']['name']='Benardo Sopaj'
if not any(f['a']=='jacobe-smith' for f in ev['fights']):
  f=fight('ufc332','jacobe-smith','bruce-whitehead','Welterweight',3,'Prelims',
   [f'Added {D}: reported Sep 24 (MMA Mania, Middle Easy) and listed on Tapology; not yet on UFC.com. Section and bout position unconfirmed.'],
   ['Whitehead is a UFC debutant on about 9 days notice.'])
  idx=max(i for i,x in enumerate(ev['fights']) if x['section']=='Prelims')+1
  ev['fights'].insert(idx,f)
ev['coverage']='Announced card · 14 bouts · refreshed Sep 26'; ev['source']['checked']=D
# PFL Chicago full card
ev=E['pfl-chicago2']
ev['title']='PFL Chicago: Carmouche vs. Bishop 2'; ev['time']='Prelims 6pm ET · main card 11pm ET'
ev['coverage']='Full card · 14 bouts · finalized Sep 23, added Sep 26'
ev['source']={'label':'PFL official full-card release','url':'https://pflmma.com/news/full-card-finalized-for-pfl-chicago-on-october-16-at-wintrust-arena','checked':D}
n=[f'Card from PFL release (Sep 23), cross-checked with Tapology {D}.']
pc=[('timur-khizriev','gabriel-braga','Featherweight',3,'Main Card'),('sarvarjon-khamidov','rafael-do-nascimento','Bantamweight',3,'Main Card'),
 ('oualy-tandia','jp-saint-louis','Welterweight',3,'Main Card'),('emiliano-sordi','abraham-bably','Light Heavyweight',3,'Main Card'),
 ('gamid-khizriev','michael-boylan','Lightweight',3,'Prelims'),('shannon-clark','lucero-acosta',"Women's Flyweight",3,'Prelims'),
 ('cassio-barao','kevin-pease','Lightweight',3,'Prelims'),('eliezer-kubanza','trey-waters','Welterweight',3,'Prelims'),
 ('cobey-fehr','rosario-romero','Bantamweight',3,'Prelims'),('paulina-wisniewska','chelsea-hackett',"Women's Flyweight",3,'Prelims'),
 ('noah-hermosillo','caden-cox','Featherweight',3,'Prelims'),('benita-van-rooij','giulliany-perea',"Women's Strawweight",3,'Prelims'),
 ('levan-khabalaev','morquez-forest','Lightweight',3,'Prelims')]
have={(f['a'],f['b']) for f in ev['fights']}
for c in pc:
  if (c[0],c[1]) not in have: ev['fights'].append(fight('pfl-chicago2',*c,n))
for f in ev['fights']:
  if f['a']=='liz-carmouche': f['section']='Main Card'; f['division']="Women's Flyweight"; f.setdefault('notes',[]).append('Inaugural PFL women\'s flyweight world title, 5 rounds.') if not f['notes'] else None
# odds (display only)
BFO289='https://www.bestfightodds.com/events/ufc-vegas-121-4368'; B1='https://www.bestfightodds.com/events/ufc-332-4330'; B2='https://www.bestfightodds.com/events/ufc-332-4378'
O={('raul-rosas-jr','raoni-barcelos'):(-159,130,BFO289),('norma-dumont','ailin-perez'):(128,-156,BFO289),('luis-hernandez','sedriques-dumas'):(-247,197,BFO289),
 ('mehemmedeli-osmanli','ilimbek-akylbek-uulu'):(-295,226,BFO289),('brady-hiestand','rinya-nakamura'):(292,-380,BFO289),('rodolfo-vieira','robert-bryczek'):(-161,132,BFO289),
 ('rodolfo-bellato','christian-edwards'):(-177,145,BFO289),('elves-brener','josiah-harrell'):(107,-125,BFO289),('montel-jackson','ricky-simon'):(-219,178,BFO289),
 ('john-castaneda','alatengheili'):(-360,270,BFO289),('vanessa-demopoulos','yazmin-jauregui'):(600,-910,BFO289),
 ('natalia-silva','wang-cong'):(-207,164,B1),('deiveson-figueiredo','payton-talbott'):(432,-675,B1),('king-green','esteban-ribovics'):(230,-280,B2),
 ('khaos-williams','roberto-soldic'):(228,-300,B2),('ateba-gautier','roman-kopylov'):(-200,165,B2),('imanol-rodriguez','alden-coria'):(-165,130,B2),
 ('damian-pinas','andrey-pulyaev'):(-500,350,B2),('marcus-mcghee','bernardo-sopaj'):(-150,110,B2),('johnny-walker','mick-parkin'):(-150,120,B2),
 ('rafael-dos-anjos','alexander-hernandez'):(200,-250,B2),('marvin-vettori','ismail-naurdiev'):(100,-125,B2),('court-mcgee','eric-nolan'):(200,-251,B2)}
for eid in ('ufc-fn-289','ufc332'):
  for f in E[eid]['fights']:
    o=O.get((f['a'],f['b']))
    if o: f['odds']={'a':o[0],'b':o[1],'asOf':D,'source':o[2]}
  E[eid]['source']['checked']=D
E['ufc-fn-289']['coverage']='Final card · 12 bouts · all fighters made weight (Sep 25)'
# OKTAGON 94 Stand & Bang
for f in E['oktagon-94']['fights']:
  if f['a']=='edmon-avagyan' and f['rules']!='Muay Thai':
    f['rules']='Muay Thai'; f['notes'].append(f'Corrected {D}: OKTAGON bills this as a "Stand & Bang" striking bout (Tapology: pro Muay Thai, modified rules, MMA gloves, 5x3 min) — not MMA and not a title fight. Avagyan has no pro MMA record (1-0 pro boxing).')
E['oktagon-94']['coverage']='Temporary one-off event · 10 bouts · all weighed in (Sep 25)'
json.dump(s,open(SEED,'w'),ensure_ascii=False)
print('fighters',len(F),'events',len(s['events']))
