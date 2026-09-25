import { analyze, historySummary, usableStats } from './model';
import type { Fighter, Fight, Event, CombatStats } from './types';
import {formatHeight,formatReach,formatHeightDelta,formatReachDelta} from './measurements';
export type Prediction = ReturnType<typeof analyze>;
export type Reason = {title:string; text:string; source?:string; side:string; impact:number};
// A conservative display of model conviction, not a fitted probability.
// Evidence gaps already shrink the directional edge; cap the display until validated.
export function confidence(p:Prediction){
 if(!p.pick)return null;
 const strength=35*(1-Math.exp(-Math.abs(p.edge)/7.5));
 const evidence=.65+.35*(p.coverage/100);
 const experience=p.topLevelBouts>=6?1:p.topLevelBouts>=3?.95:.85;
 return Math.round(Math.max(51,Math.min(85,50+strength*evidence*experience)));
}
export function statLeader(a:unknown,b:unknown,lower=false):'a'|'b'|null {
 if(typeof a!=='number'||typeof b!=='number'||!Number.isFinite(a)||!Number.isFinite(b)||a===b)return null;
 return (lower?a<b:a>b)?'a':'b';
}
export function strikingLosses(f:Fighter,date:string,rules:Fight['rules']){return historySummary(f,date,rules).recent.filter(x=>x.result==='L'&&/KO|TKO/i.test(x.method)&&!/injury|doctor|cut|retire/i.test(x.method));}
export function conciseReasons(p:Prediction,a:Fighter,b:Fighter,event:Event,fight:Fight){
 const ah=historySummary(a,event.date,fight.rules),bh=historySummary(b,event.date,fight.rules);
 const reasons:Reason[]=p.factors.flatMap(f=>{
  if(f.score===null||!f.score||!f.weight)return [];
  const left=f.score>0,w=left?a:b,l=left?b:a,wh=left?ah:bh,lh=left?bh:ah;
  let title=f.label,text=f.note;
  if(f.id==='opposition'){title='Tougher opposition';text=`${w.name} faced the stronger schedule by opponents’ pre-fight records. This includes losses, not just wins.`;}
  if(f.id==='style'){title=f.basis==='Direct matchup and finish-route evidence'?'Head-to-head and finish routes':'Style and finish routes';const ws=usableStats(w,event.date,fight.rules),ls=usableStats(l,event.date,fight.rules);text=f.note;if(f.basis==='Measured combat statistics'&&ws?.tdPer15!==undefined&&ls?.tdPer15!==undefined&&ws.tdPer15>ls.tdPer15)text=`${ws.tdPer15} takedowns / 15 min vs ${ls.tdPer15}.${ls.tdDefense!==undefined?` ${l.name} stops ${ls.tdDefense}% of attempts.`:''}`;else if(f.basis==='Measured combat statistics'&&ws?.slpm!==undefined&&ws.sapm!==undefined&&ls?.slpm!==undefined&&ls.sapm!==undefined)text=`Net strikes: ${(ws.slpm-ws.sapm).toFixed(2)} vs ${(ls.slpm-ls.sapm).toFixed(2)} per minute for ${w.name}.`;}
  if(f.id==='form'){title='Better recent results';text=`${w.name}: ${wh.record} in the last ${wh.recent.length}. ${l.name}: ${lh.record} in ${lh.recent.length}.`;}
  if(f.id==='size'){title='Range advantage';text=w.reach&&l.reach&&w.reach>l.reach?`${w.name} has ${formatReachDelta(w.reach-l.reach)} more reach. Height: ${formatHeight(w.height)} vs ${formatHeight(l.height)}.`:`Listed height and reach give ${w.name} a small range edge.`;}
  if(f.id==='distance'){title='Success in longer fights';text=`In bouts reaching round 3: ${w.name} ${wh.longRecord}; ${l.name} ${lh.longRecord}. Last 10 only.`;}
  if(f.id==='context'){title='Activity advantage';text=`${w.name}: ${wh.layoff} days since fighting. ${l.name}: ${lh.layoff}. Camp condition is unverified.`;}
  return [{title,text,side:w.id,impact:Math.abs(f.score*f.weight),source:f.source||w.historySource}];
 }).sort((x,y)=>y.impact-x.impact);
 const supporting=reasons.filter(r=>r.side===p.pick).slice(0,5);
 const opposing=reasons.filter(r=>r.side!==p.pick);
 if(p.pick){
  const w=p.pick===a.id?a:b,l=p.pick===a.id?b:a,ws=usableStats(w,event.date,fight.rules),ls=usableStats(l,event.date,fight.rules);
  const losses=strikingLosses(w,event.date,fight.rules);
  if(losses.length&&ls?.kdPer15!==undefined&&ws?.kdPer15!==undefined&&ls.kdPer15>ws.kdPer15)opposing.unshift({title:'The knockout counterargument',text:`${l.name}: ${ls.kdPer15} knockdowns / 15 min vs ${ws.kdPer15}. ${w.name} has ${losses.length} KO/TKO losses in the last 10.`,side:l.id,impact:0,source:l.stats?.source});
  const recent=historySummary(w,event.date,fight.rules).recent;let streak=0;for(const bout of recent){if(bout.result!=='L')break;streak++;}
  if(streak>=3)opposing.unshift({title:'The losing-streak warning',text:`${w.name} has lost ${streak} straight fights. A tougher past schedule does not erase those results.${l.height&&w.height&&l.height>w.height?` ${l.name} is also ${formatHeightDelta(l.height-w.height)} taller.`:''}`,side:l.id,impact:0,source:w.historySource});
 }
 return {supporting: supporting.length?supporting:reasons.slice(0,5),counter:opposing[0]??null};
}
export const COMBAT_METRICS:{label:string;key:keyof CombatStats;unit:string;lower?:boolean;group:'striking'|'grappling';context?:string}[]=[
 {label:'Strikes landed',key:'slpm',unit:'/ min',group:'striking'},
 {label:'Strikes absorbed',key:'sapm',unit:'/ min',lower:true,group:'striking'},
 {label:'Striking accuracy',key:'strikeAccuracy',unit:'%',group:'striking'},
 {label:'Striking defence',key:'strikeDefense',unit:'%',group:'striking'},
 {label:'Knockdowns',key:'kdPer15',unit:'/ 15 min',group:'striking'},
 {label:'Takedowns landed',key:'tdPer15',unit:'/ 15 min',group:'grappling'},
 {label:'Takedown accuracy',key:'tdAccuracy',unit:'%',group:'grappling'},
 {label:'Takedown defence',key:'tdDefense',unit:'%',group:'grappling'},
 {label:'Submission attempts',key:'subPer15',unit:'/ 15 min',group:'grappling',context:'More attempts shows activity, not submission success.'},
 {label:'Control time',key:'controlPer15',unit:'min / 15 min',group:'grappling',context:'More time shows control, not necessarily damage.'}
];
