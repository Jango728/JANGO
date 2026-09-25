import type { Event, Fight, Fighter, Factor, Weights, Review, PastFight, Rules } from "./types";
import {formatHeight,formatReach} from './measurements';
export const MODEL_VERSION="0.4";
export const FACTORS: {id:Factor;label:string;help:string}[] = [
 {id:"opposition",label:"Quality of opposition",help:"Last 10: smoothed opponent records before each bout, prior experience in that promotion, and second-level opposition when at least 3 records are verified. No promotion popularity or ranking bonus."},
 {id:"style",label:"Striking & grappling matchup",help:"Sourced striking differential, takedown rate against the opponent’s defence, submission attempts and knockdowns. Career aggregates stay labelled and cannot enter an earlier backtest."},
 {id:"size",label:"Height & reach",help:"A small, capped combined reach and height signal. Measurements are not strength ratings. Nationality and appearance receive no points."},
 {id:"distance",label:"Rounds & pace",help:"Last 10: results in bouts reaching round 3, with at least 3 such bouts per fighter. Early finishes leave endurance unproven; they do not imply poor cardio."},
 {id:"form",label:"Recent performance · last 10",help:"Up to 10 completed bouts under the same rules, newest weighted most (0.9 decay). Draws are half a result, no contests are excluded. Every available bout is shown."},
 {id:"context",label:"Camp & readiness · last 10",help:"A limited activity proxy: days since the last fight, usual turnaround, and weight changes in the last 10. Long inactivity or a very short turnaround adds a small uncertainty penalty. Actual camp quality remains unverified."}
];
export const DEFAULT_WEIGHTS:Weights={opposition:35,style:30,size:10,distance:10,form:10,context:5};
export const clamp=(v:number,min=-1,max=1)=>Math.max(min,Math.min(max,v));
export function pastBefore(f:Fighter,date:string,rules?:Rules){return f.history.filter(x=>x.date&&x.date<date&&(!rules||x.rules===rules||(!x.rules&&rules==='MMA'))).sort((a,b)=>b.date.localeCompare(a.date));}
export function resultRecord(h:PastFight[]){const n=(r:string)=>h.filter(x=>x.result===r).length;return `${n('W')}-${n('L')}-${n('D')}${n('NC')?` (${n('NC')} NC)`:''}`;}
export function recordAtEvent(f:Fighter,date:string,rules:Rules='MMA'){return f.historyComplete&&rules==='MMA'?resultRecord(pastBefore(f,date,rules)):f.record||'Record pending';}
export function ufcRecord(f:Fighter,date:string){return f.historyComplete||f.ufcHistoryComplete?resultRecord(pastBefore(f,date,'MMA').filter(x=>x.promotion==='UFC')):null;}
const days=(a:string,b:string)=>Math.round((Date.parse(a)-Date.parse(b))/86400000);
const outcome=(h:PastFight)=>h.result==='W'?1:h.result==='L'?0:.5;
const normName=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const opponentQuality=(value?:string)=>{if(!value||!/^\d+-\d+(?:-\d+)?$/.test(value))return .55;const [w,l,d=0]=value.split('-').map(Number);return (w+.5*d+2)/(w+l+d+4);};
const cleanFinish=(h:PastFight)=>/KO|TKO|Submission/i.test(h.method)&&!/injury|cut|doctor|retire|disqual/i.test(h.method);
const finishCredibility=(row:PastFight)=>{const nums=row.opponentRecord?.split('-').map(Number),total=nums?.reduce((sum,n)=>sum+n,0)??0,experience=.7+.3*Math.min(total,20)/20,promotion=.9+.1*Math.min(row.opponentPromotionBouts??0,8)/8;return opponentQuality(row.opponentRecord)*experience*promotion;};
function finishRoute(history:PastFight[]){
 let weight=0,attack=0,vulnerability=0;
 history.slice(0,10).forEach((row,index)=>{const recency=Math.pow(.9,index);weight+=recency;if(row.result==='W'&&cleanFinish(row))attack+=recency*finishCredibility(row);if(row.result==='L'&&cleanFinish(row))vulnerability+=recency;});
 return {attack:weight?attack/weight:0,vulnerability:weight?vulnerability/weight:0};
}
function directMatchup(history:PastFight[],opponent:string){
 const rows=history.slice(0,10).map((row,index)=>({row,index})).filter(x=>normName(x.row.opponent)===normName(opponent)&&['W','L'].includes(x.row.result));
 if(!rows.length)return null;let score=0,weight=0;for(const {row,index} of rows){const w=Math.pow(.85,index);score+=(row.result==='W'?1:-1)*w;weight+=w;}return {score:score/weight,count:rows.length,latest:rows[0].row};
}
export function historySummary(f:Fighter,date:string,rules:Rules='MMA'){
 const all=pastBefore(f,date,rules),recent=all.slice(0,10),decided=recent.filter(x=>x.result!=='NC');
 const intervals=recent.slice(0,-1).map((x,i)=>days(x.date,recent[i+1].date)).sort((a,b)=>a-b);
 const median=intervals.length?(intervals[Math.floor((intervals.length-1)/2)]+intervals[Math.floor(intervals.length/2)])/2:null;
 const knownTime=recent.filter(x=>x.minutes!==undefined),long=decided.filter(x=>(x.round||0)>=3);
 const delay=recent.length?days(date,recent[0].date):null;
 const weighted=decided.reduce((s,x,i)=>s+outcome(x)*Math.pow(.9,i),0),weights=decided.reduce((s,_,i)=>s+Math.pow(.9,i),0);
 const divisions=[...new Set(recent.map(x=>x.division).filter(Boolean))] as string[];
 return {all,recent,decided,record:resultRecord(recent),median,layoff:delay,form:weights?(weighted+1)/(weights+2):null,long,longRecord:resultRecord(long),firstRound:recent.filter(x=>x.round===1).length,finishes:recent.filter(x=>x.result==='W'&&/KO|TKO|Submission/i.test(x.method)).length,avgMinutes:knownTime.length?knownTime.reduce((s,x)=>s+x.minutes!,0)/knownTime.length:null,timeCount:knownTime.length,divisions,divisionCount:recent.filter(x=>x.division).length};
}
export function strengthOfSchedule(history:PastFight[]){
 const valid=history.slice(0,10).filter(x=>/^\d+-\d+(?:-\d+)?$/.test(x.opponentRecord||''));
 if(valid.length<3)return null;
 let total=0,weight=0;
 valid.forEach(x=>{const i=history.indexOf(x);const [w,l,d=0]=x.opponentRecord!.split('-').map(Number);const wr=(w+d*.5+2)/(w+l+d+4);const experience=Math.min(w+l+d,20)/20;const promotion=x.opponentPromotionBouts===undefined?null:Math.min(x.opponentPromotionBouts,10)/10;const base=.85*wr+.15*experience;const experienced=promotion===null?base:.9*base+.1*promotion;const second=x.secondLevel!==undefined&&(x.secondLevelCount||0)>=3?clamp(x.secondLevel,0,1):null;const score=second===null?experienced:.85*experienced+.15*second;const recency=Math.pow(.9,i);total+=score*recency;weight+=recency;});
 return {score:total/weight,count:valid.length,secondLevelCount:valid.filter(x=>x.secondLevel!==undefined&&(x.secondLevelCount||0)>=3).length};
}
export function usableStats(f:Fighter,eventDate:string,rules:Rules){return rules==='MMA'&&f.stats&&f.stats.asOf<eventDate?f.stats:null;}
export function analyze(fight:Fight,a:Fighter,b:Fighter,event:Event,_weights:Weights,_review?:Review){
 // Deliberately ignore opinions, manual ratings, market odds, flags and appearance.
 const weights=DEFAULT_WEIGHTS;
 const ah=historySummary(a,event.date,fight.rules),bh=historySummary(b,event.date,fight.rules),sa=strengthOfSchedule(ah.recent),sb=strengthOfSchedule(bh.recent);
 const ast=usableStats(a,event.date,fight.rules),bst=usableStats(b,event.date,fight.rules);
 const factors=FACTORS.map(f=>{
  let score:number|null=null,note="More verified evidence is needed on both fighters.",basis="Missing evidence",source:string|undefined;
  if(f.id==='opposition'&&sa&&sb){score=clamp((sa.score-sb.score)*2);note=`Last 10 opponent-record coverage: ${sa.count}/${ah.recent.length} for ${a.name}; ${sb.count}/${bh.recent.length} for ${b.name}. Schedule index ${Math.round(sa.score*100)} vs ${Math.round(sb.score*100)}. Second-level coverage ${sa.secondLevelCount} vs ${sb.secondLevelCount}. Reconstructed records use results before that bout; later record corrections may still be reflected.`;basis='Pre-bout opponent records';source=a.historySource;}
  if(f.id==='style'&&ast&&bst){
   const signals:{score:number;weight:number;label:string}[]=[];
   if(ast.slpm!==undefined&&ast.sapm!==undefined&&bst.slpm!==undefined&&bst.sapm!==undefined)signals.push({score:clamp(((ast.slpm-ast.sapm)-(bst.slpm-bst.sapm))/5),weight:.5,label:`strike differential ${(ast.slpm-ast.sapm).toFixed(2)} vs ${(bst.slpm-bst.sapm).toFixed(2)}/min`});
   if(ast.tdPer15!==undefined&&bst.tdDefense!==undefined&&bst.tdPer15!==undefined&&ast.tdDefense!==undefined)signals.push({score:clamp((ast.tdPer15*(1-bst.tdDefense/100)-bst.tdPer15*(1-ast.tdDefense/100))/3),weight:.3,label:`TD rate ${ast.tdPer15} vs ${bst.tdPer15}/15 min; TD defence ${ast.tdDefense}% vs ${bst.tdDefense}%`});
   if(ast.subPer15!==undefined&&bst.subPer15!==undefined)signals.push({score:clamp((ast.subPer15-bst.subPer15)/3),weight:.1,label:`submission attempts ${ast.subPer15} vs ${bst.subPer15}/15 min`});
   if(ast.kdPer15!==undefined&&bst.kdPer15!==undefined)signals.push({score:clamp((ast.kdPer15-bst.kdPer15)/2),weight:.1,label:`knockdowns ${ast.kdPer15} vs ${bst.kdPer15}/15 min`});
   if(signals.length>=2){const sample=Math.min(1,Math.min(ah.all.filter(x=>['UFC','DWCS'].includes(x.promotion)).length,bh.all.filter(x=>['UFC','DWCS'].includes(x.promotion)).length)/8);score=signals.reduce((s,x)=>s+x.score*x.weight,0)*sample;note=`Official profile aggregates: ${signals.map(x=>x.label).join('; ')}. Small career samples reduce the signal. These are not last-10 bout statistics or a validated tactical forecast. Control time is unavailable.`;basis='Measured combat statistics';source=ast.source;}
  }
  if(f.id==='style'){
   const ar=finishRoute(ah.recent),br=finishRoute(bh.recent),route=clamp(((ar.attack+br.vulnerability)-(br.attack+ar.vulnerability))*1.2),head=directMatchup(ah.recent,b.name);
   if(Math.abs(route)>=.04||head){
    const historyScore=clamp(route*.7+(head?.score||0)*.9);
    score=score===null?historyScore:clamp(score*.65+historyScore*.35);
    const headNote=head?` Their loaded series is ${head.count>1?`${head.count} fights`:'one fight'}; the latest was a ${head.latest.result==='W'?'win':'loss'} for ${a.name} on ${head.latest.date}.`:'';
    note=`Matched finish routes: credible recent stoppage attack ${Math.round(ar.attack*100)} vs ${Math.round(br.attack*100)}; stoppage-loss exposure ${Math.round(ar.vulnerability*100)} vs ${Math.round(br.vulnerability*100)}.${headNote} Finishes over inexperienced opponents are discounted.`;
    basis=head?'Direct matchup and finish-route evidence':'Matched finish-route evidence';source=a.historySource;
   }
  }
  if(f.id==='size'){
   const reach=(a.reach||0)>0&&(b.reach||0)>0?clamp((a.reach!-b.reach!)/20,-.4,.4):null;const height=(a.height||0)>0&&(b.height||0)>0?clamp((a.height!-b.height!)/25,-.25,.25):null;
   if(reach!==null||height!==null){score=(reach===null?0:.8*reach)+(height===null?0:.2*height);note=`Reach ${a.reach===undefined?'unknown':formatReach(a.reach)} vs ${b.reach===undefined?'unknown':formatReach(b.reach)}; height ${a.height===undefined?'unknown':formatHeight(a.height)} vs ${b.height===undefined?'unknown':formatHeight(b.height)}. Combined and capped so size cannot dominate. Effective range and strength are not established by measurements.`;basis='Sourced measurements';source=a.profile;}
  }
  if(f.id==='distance'&&ah.long.length>=3&&bh.long.length>=3){const val=(xs:PastFight[])=>(xs.reduce((s,x)=>s+outcome(x),0)+1)/(xs.length+2);score=clamp(val(ah.long)-val(bh.long))*.5;note=`Within the last 10, bouts reaching round 3: ${a.name} ${ah.longRecord} (${ah.long.length}); ${b.name} ${bh.longRecord} (${bh.long.length}). This is observed late-bout success, not a cardio measurement. ${fight.rounds>3?'Five-round capacity still needs separate evidence.':''}`;basis='Last-10 distance evidence';}
  if(f.id==='form'&&ah.decided.length>=3&&bh.decided.length>=3){
   const streak=(rows:PastFight[])=>{let n=0;for(const row of rows){if(row.result!=='L')break;n++;}return n};
   const as=streak(ah.recent),bs=streak(bh.recent);
   // Four or more consecutive losses are treated as a distinct decline signal.
   // This prevents an excellent old schedule from erasing sustained current results.
   const decline=clamp((bs>=4?Math.min(.45,(bs-3)*.09):0)-(as>=4?Math.min(.45,(as-3)*.09):0),-.45,.45);
   score=clamp((ah.form!-bh.form!)*1.5+decline);note=`${a.name}: ${ah.record} in ${ah.recent.length} available bouts${as>=4?`; ${as} straight losses`:''}; ${b.name}: ${bh.record} in ${bh.recent.length}${bs>=4?`; ${bs} straight losses`:''}. Last 10 maximum, newest weighted most (0.9 decay), with smoothing. NCs carry no result signal. Finishes ${ah.finishes} vs ${bh.finishes}; opponent strength is scored separately.`;basis='Last-10 results and sustained decline';
  }
  if(f.id==='context'&&ah.recent.length>=3&&bh.recent.length>=3&&ah.layoff!==null&&bh.layoff!==null){
   const risk=(d:number)=>d>365?-Math.min(.35,(d-365)/730):d<45?-Math.min(.25,(45-d)/180):0;
   const ageRisk=(age?:number)=>age===undefined?0:Math.min(.25,Math.max(0,age-32)/20);
   score=clamp(risk(ah.layoff)-risk(bh.layoff)+ageRisk(b.age)-ageRisk(a.age));note=`${a.name}: ${ah.layoff} days since last bout; typical gap ${ah.median===null?'unknown':Math.round(ah.median)+' days'}; age ${a.age??'unknown'}. ${b.name}: ${bh.layoff} days; typical gap ${bh.median===null?'unknown':Math.round(bh.median)+' days'}; age ${b.age??'unknown'}. Weight-class fields verified in ${ah.divisionCount}/${ah.recent.length} and ${bh.divisionCount}/${bh.recent.length} bouts. ${ah.divisions.length>1||bh.divisions.length>1?'Weight-class changes need review. ':''}Only long layoffs, extremely short turnarounds and a modest post-32 age curve receive capped influence. Camp quality remains unverified.`;basis='Last-10 activity and age proxy';}
  return {...f,score,note,basis,source,weight:Math.max(0,Number(weights[f.id])||0)};
 });
 const total=factors.reduce((s,f)=>s+f.weight,0),known=factors.filter(f=>f.score!==null),covered=known.reduce((s,f)=>s+f.weight,0);
 const coverage=total?Math.round(covered/total*100):0;
 // Missing factors reduce coverage, but no longer dilute the known evidence a second time.
 const raw=covered?known.reduce((s,f)=>s+f.score!*f.weight,0)/covered*100:0,edge=Math.round(raw*10)/10;
 const substantive=known.some(f=>(f.id==='opposition'||f.id==='style')&&f.weight>0);
 const enoughHistory=ah.decided.length>=3&&bh.decided.length>=3;
 const directional=ah.decided.length>=2&&bh.decided.length>=2&&Math.abs(raw)>=.1;
 const supported=coverage>=45&&substantive&&enoughHistory&&Math.abs(raw)>=.5;
 const pick=directional?(raw>0?a.id:b.id):null;
 const topLevel=(h:PastFight[])=>h.filter(x=>['UFC','DWCS'].includes(x.promotion)).length;
 const topLevelBouts=Math.min(topLevel(ah.recent),topLevel(bh.recent));
 const experienceWarning=topLevelBouts<3?'At least one fighter has fewer than three loaded UFC/DWCS bouts. Accomplishments in another sport do not prove MMA striking defense, reactions or cage decision-making.':topLevelBouts<6?'The matchup has a limited shared UFC/DWCS sample. Treat the confidence as provisional.':null;
 const label=!pick?'Insufficient history':!supported?'Data-limited lean':topLevelBouts<3?'Speculative lean':Math.abs(raw)<5?'Marginal lean':Math.abs(raw)>=18?'Stronger lean':'Slight lean';
 return {edge,coverage,pick,modelVersion:MODEL_VERSION,factors,label,topLevelBouts,experienceWarning,missing:factors.filter(f=>f.score===null).map(f=>f.label),notes:[`${a.name}: ${ah.record} across ${ah.recent.length} latest ${fight.rules} bouts. ${b.name}: ${bh.record} across ${bh.recent.length}.`,...(experienceWarning?[experienceWarning]:[]),...factors.filter(f=>f.score!==null&&f.weight>0&&Math.abs(f.score)>.01).sort((a,b)=>Math.abs(b.score!*b.weight)-Math.abs(a.score!*a.weight)).slice(0,3).map(f=>`${f.label} favours ${f.score!>0?a.name:b.name}. ${f.note}`)]};
}
export function fairMarket(a:number,b:number){const implied=(n:number)=>n<0?-n/(-n+100):100/(n+100);if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)<100||Math.abs(b)<100)return null;const x=implied(a),y=implied(b);return {a:x/(x+y),b:y/(x+y)};}
