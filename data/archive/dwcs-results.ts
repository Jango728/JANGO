export type DwcsBout={fightId:string;a:string;b:string;winner:string;loser:string;method:'KO'|'TKO'|'SUB'|'DEC';detail:string;round:number;time:string};
export type DwcsForecast={fightId:string;a:string;b:string;pick:string;rounds:{side:'Over'|'Under';line:number};finish:{method:'ko'|'submission'|'decision';label:string}|null};
export type DwcsCard={id:string;label:string;date:string;source:{label:string;url:string;checked:string};bouts:DwcsBout[];lessons:string[];retrospective:boolean;forecasts?:DwcsForecast[];archive?:{sourceCommit:string;publishedAt:string;reproducedAt:string;basis:string}};

const checked='2026-09-24';
const ufc='https://www.ufc.com/dwcs';
const resultOnly=['Result record only. No pre-event forecast was preserved, so this card is excluded from accuracy and no hindsight pick is inferred.'];
const bout=(week:number,slug:string,a:string,b:string,winner:string,method:DwcsBout['method'],detail:string,round:number,time:string):DwcsBout=>({fightId:`dwcs-s10-w${week}-${slug}`,a,b,winner,loser:winner===a?b:a,method,detail,round,time});
const card=(week:number,date:string,bouts:DwcsBout[],url=ufc):DwcsCard=>({id:`dwcs-s10-w${week}`,label:`DWCS S10 · Week ${week}`,date,source:{label:week===1?'ESPN fight results':week===4?'MMA Fighting results':'UFC DWCS season results',url,checked},bouts,lessons:resultOnly,retrospective:true});

export const dwcsCards:DwcsCard[]=[
 card(5,'2026-09-08',[
  bout(5,'quentin-pasley-arlind-berisha','Quentin Pasley','Arlind Berisha','Quentin Pasley','KO','KO (elbows)',1,'4:41'),
  bout(5,'isaac-moreno-reginaldo-geraldo-jr','Isaac Moreno','Reginaldo Geraldo Jr','Isaac Moreno','DEC','Unanimous decision',3,'5:00'),
  bout(5,'martin-kozak-christian-echols','Martin Kozák','Christian Echols','Martin Kozák','TKO','TKO',2,'1:32'),
  bout(5,'apollo-gomes-kwon-won-il','Apollo Gomes','Kwon Won-il','Apollo Gomes','DEC','Unanimous decision',3,'5:00'),
  bout(5,'christian-natividad-colton-loud','Christian Natividad','Colton Loud','Christian Natividad','KO','KO (body punch)',1,'1:10'),
 ]),
 card(4,'2026-09-01',[
  bout(4,'adam-darby-patrick-rivera','Adam Darby','Patrick Rivera','Adam Darby','TKO','TKO (doctor stoppage)',3,'2:42'),
  bout(4,'modestino-rodrigues-brandon-holmes','Modestino Rodrigues','Brandon Holmes','Modestino Rodrigues','TKO','TKO',1,'0:15'),
  bout(4,'silvestre-sanchez-liam-mccraken','Silvestre Sanchez','Liam McCraken','Silvestre Sanchez','KO','KO',3,'2:44'),
  bout(4,'gabriel-lorenco-charlie-cleveland','Gabriel Lorenço','Charlie Cleveland','Gabriel Lorenço','KO','KO (elbow and punches)',1,'2:02'),
  bout(4,'adam-livingston-hunter-smith','Adam Livingston','Hunter Smith','Adam Livingston','DEC','Split decision',3,'5:00'),
 ],'https://www.mmafighting.com/dana-whites-contender-series/455617/dwcs-season-10-week-4-results'),
 card(3,'2026-08-25',[
  bout(3,'alex-apodaca-bella-mir','Alex Apodaca','Bella Mir','Alex Apodaca','DEC','Unanimous decision',3,'5:00'),
  bout(3,'guilherme-uriel-mario-piazzon','Guilherme Uriel','Mario Piazzon','Guilherme Uriel','SUB','Guillotine choke',1,'0:50'),
  bout(3,'sean-clancy-jr-gary-balletto-jr','Sean Clancy Jr','Gary Balletto Jr','Sean Clancy Jr','TKO','TKO (elbows)',2,'3:54'),
  bout(3,'ronald-humphrey-alexis-miranda','Ronald Humphrey','Alexis Miranda','Ronald Humphrey','SUB','Rear-naked choke',1,'4:03'),
  bout(3,'nick-galanti-carlos-petruzzella','Nick Galanti','Carlos Petruzzella','Nick Galanti','KO','KO',1,'0:35'),
 ]),
 card(2,'2026-08-18',[
  bout(2,'kaik-brito-namo-fazil','Kaik Brito','Namo Fazil','Kaik Brito','KO','KO',3,'0:12'),
  bout(2,'trent-miller-douglas-henrique-rodrigues','Trent Miller','Douglas Henrique Rodrigues','Trent Miller','SUB','Technical submission (Von Flue choke)',2,'1:04'),
  bout(2,'cristian-perez-logan-paxton','Cristian Pérez','Logan Paxton','Cristian Pérez','TKO','TKO',2,'1:06'),
  bout(2,'alik-lorenz-mahamed-aly','Alik Lorenz','Mahamed Aly','Alik Lorenz','KO','KO',1,'2:23'),
  bout(2,'roman-puga-taner-trembley','Roman Puga','Taner Trembley','Roman Puga','DEC','Unanimous decision',3,'5:00'),
 ]),
 card(1,'2026-08-11',[
  bout(1,'anthony-wint-matt-adams','Anthony Wint','Matt Adams','Anthony Wint','TKO','TKO',1,'0:34'),
  bout(1,'abe-alsaghir-fabrizio-escarrega','Abe Alsaghir','Fabrizio Escarrega','Abe Alsaghir','DEC','Split decision',3,'5:00'),
  bout(1,'bilal-hasan-mridul-saikia','Bilal Hasan','Mridul Saikia','Bilal Hasan','TKO','TKO',1,'0:45'),
  bout(1,'tom-pagliarulo-ananias-mulumba','Tom Pagliarulo','Ananias Mulumba','Tom Pagliarulo','TKO','TKO',3,'4:24'),
  bout(1,'joseph-kropschot-jonathan-kunneman','Joseph Kropschot','Jonathan Kunneman','Joseph Kropschot','DEC','Unanimous decision',3,'5:00'),
 ],'https://www.espn.com/mma/fightcenter/_/id/600055018/league/ufc'),
];

dwcsCards.unshift({
 id:'dwcs-s10-w6',label:'DWCS S10 · Week 6',date:'2026-09-15',source:{label:'UFC DWCS season results',url:ufc,checked},retrospective:false,
 archive:{sourceCommit:'4eaf8d1',publishedAt:'in pre-event commit 4eaf8d1',reproducedAt:checked,basis:'Default model output preserved in the historical pre-event revision; not a personally locked pick.'},
 lessons:[
  'The model went 2–3 on winners. It correctly backed Akbar Abdullaev and Luis Hernandez, including their winning methods, but picked Zevan Hunt, Oscar Ravello and Antônio Monteiro instead of the eventual winners.',
  'The 1.5-round model went 4–1. It correctly anticipated three early finishes and Williams–Monteiro going long; Abdullaev–Santos ended in 19 seconds after the model leaned Over.',
  'Winner and method signals must stay separate. The model correctly expected KO/TKO in Ravello–Cavalcanti while selecting the wrong fighter; that is a method read, not a correct fight pick.',
 ],
 bouts:[
  {fightId:'dwcs-2026-week6-zevan-hunt-mayton-perea',a:'Zevan Hunt',b:'Mayton Perea',winner:'Mayton Perea',loser:'Zevan Hunt',method:'KO',detail:'KO',round:1,time:'0:45'},
  {fightId:'dwcs-2026-week6-oscar-ravello-igor-cavalcanti',a:'Oscar Ravello',b:'Igor Cavalcanti',winner:'Igor Cavalcanti',loser:'Oscar Ravello',method:'TKO',detail:'TKO',round:1,time:'1:38'},
  {fightId:'dwcs-2026-week6-akbar-abdullaev-ednilson-santos',a:'Akbar Abdullaev',b:'Ednilson Santos',winner:'Akbar Abdullaev',loser:'Ednilson Santos',method:'KO',detail:'KO',round:1,time:'0:19'},
  {fightId:'dwcs-2026-week6-luis-hernandez-hugo-guillon',a:'Luis Hernandez',b:'Hugo Guillon',winner:'Luis Hernandez',loser:'Hugo Guillon',method:'SUB',detail:'Rear-naked choke',round:2,time:'1:01'},
  {fightId:'dwcs-2026-week6-tyshawn-williams-antonio-monteiro',a:'Tyshawn Williams',b:'Antônio Monteiro',winner:'Tyshawn Williams',loser:'Antônio Monteiro',method:'DEC',detail:'Unanimous decision',round:3,time:'5:00'},
 ],
 forecasts:[
  {fightId:'dwcs-2026-week6-zevan-hunt-mayton-perea',a:'Zevan Hunt',b:'Mayton Perea',pick:'Zevan Hunt',rounds:{side:'Under',line:1.5},finish:{method:'submission',label:'Submission'}},
  {fightId:'dwcs-2026-week6-oscar-ravello-igor-cavalcanti',a:'Oscar Ravello',b:'Igor Cavalcanti',pick:'Oscar Ravello',rounds:{side:'Under',line:1.5},finish:{method:'ko',label:'KO / TKO'}},
  {fightId:'dwcs-2026-week6-akbar-abdullaev-ednilson-santos',a:'Akbar Abdullaev',b:'Ednilson Santos',pick:'Akbar Abdullaev',rounds:{side:'Over',line:1.5},finish:{method:'ko',label:'KO / TKO'}},
  {fightId:'dwcs-2026-week6-luis-hernandez-hugo-guillon',a:'Luis Hernandez',b:'Hugo Guillon',pick:'Luis Hernandez',rounds:{side:'Under',line:1.5},finish:{method:'submission',label:'Submission'}},
  {fightId:'dwcs-2026-week6-tyshawn-williams-antonio-monteiro',a:'Tyshawn Williams',b:'Antonio Monteiro',pick:'Antonio Monteiro',rounds:{side:'Over',line:1.5},finish:{method:'submission',label:'Submission'}},
 ],
});
