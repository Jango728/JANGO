import type {Event,Fighter} from './types';

const espn='https://www.espn.com/mma/fightcenter/_/id/600060738/league/ufc';
const official='https://www.ufc.com/story/4b65ddd2-e496-4a89-8bdf-ad9ed551c89a';
const source=(label:string)=>[{label,url:espn,checked:'2026-09-23',note:'Pre-event record reconstructed from the post-fight record and the verified result.'}];
const fighter=(id:string,name:string,record:string,country:string):Fighter=>({id,name,record,recordScope:'Pre-event record · full history not loaded',country,history:[],sources:source('ESPN result card'),profile:espn,historyComplete:false,ufcHistoryComplete:false});

export const DWCS_WEEK7_FIGHTERS:Record<string,Fighter>={
 'norbert-novenyi-jr':fighter('norbert-novenyi-jr','Norbert Növényi Jr.','10-1-0','Hungary'),
 'theo-haig':fighter('theo-haig','Theo Haig','7-1-0','United States'),
 'jaden-ortega':fighter('jaden-ortega','Jaden Ortega','6-0-0','United States'),
 'alvi-dasuyev':fighter('alvi-dasuyev','Alvi Dasuyev','9-0-0','Belgium'),
 'marcos-degli':fighter('marcos-degli','Marcos Degli','14-3-0','Brazil'),
 'paris-moran':fighter('paris-moran','Paris Moran','14-3-0','United States'),
 'callum-connor':fighter('callum-connor','Callum Connor','8-0-0','England'),
 'piero-guaylupo':fighter('piero-guaylupo','Piero Guaylupo','11-0-0','Peru'),
 'emilio-quissua':fighter('emilio-quissua','Emilio Quissua','8-0-0','Germany'),
 'damian-piwowarczyk':fighter('damian-piwowarczyk','Damian Piwowarczyk','11-4-0','Poland')
};

const fight=(id:string,a:string,b:string,division:string,section:string):Event['fights'][number]=>({id,a,b,division,rules:'MMA',rounds:3,section,assessments:{},notes:['Completed September 22, 2026. Result is recorded separately; no frozen pre-event forecast exists.'],unknowns:['Full pre-event fighter histories and comparable combat statistics were not loaded before the event.']});

export const DWCS_WEEK7_EVENT:Event={
 id:'dwcs-2026-week7',title:'DWCS Season 10 · Week 7',promotion:'DWCS',date:'2026-09-22',time:'7pm ET',location:'Meta APEX, Las Vegas, Nevada',coverage:'Completed card · 5 official results · retrospective only',
 source:{label:'UFC Week 7 results',url:official,checked:'2026-09-23',note:'Results cross-checked against ESPN FightCenter.'},
 fights:[
  fight('dwcs-2026-week7-norbert-novenyi-jr-theo-haig','norbert-novenyi-jr','theo-haig','Middleweight','Main event'),
  fight('dwcs-2026-week7-jaden-ortega-alvi-dasuyev','jaden-ortega','alvi-dasuyev','Welterweight','Main Card'),
  fight('dwcs-2026-week7-marcos-degli-paris-moran','marcos-degli','paris-moran','Flyweight','Main Card'),
  fight('dwcs-2026-week7-callum-connor-piero-guaylupo','callum-connor','piero-guaylupo','Lightweight','Main Card'),
  fight('dwcs-2026-week7-emilio-quissua-damian-piwowarczyk','emilio-quissua','damian-piwowarczyk','Light Heavyweight','Main Card')
 ]
};
