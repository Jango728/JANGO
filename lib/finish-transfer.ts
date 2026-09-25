import {pastBefore,strengthOfSchedule,usableStats} from './model';
import type {Fight,Fighter,Event,PastFight} from './types';
const stoppage=(h:PastFight)=>/\bko\b|\btko\b|submission/i.test(h.method)&&!/doctor|injury|cut|retire|disqual/i.test(h.method);
function recordQuality(record?:string){if(!record||!/^\d+-\d+(?:-\d+)?$/.test(record))return null;const [w,l,d=0]=record.split('-').map(Number);return (w+.5*d+2)/(w+l+d+4)}
/** Context signal, not a claim that two fighters are elite or stylistically identical. */
export function finishTransfer(fight:Fight,a:Fighter,b:Fighter,event:Event){
 const rows=[a,b].map(f=>{
  const history=pastBefore(f,event.date,fight.rules).filter(h=>h.result!=='NC').slice(0,10),schedule=strengthOfSchedule(history);
  const stopWins=history.filter(h=>h.result==='W'&&stoppage(h)),stopLosses=history.filter(h=>h.result==='L'&&stoppage(h)),decisions=history.filter(h=>/decision/i.test(h.method)&&!/technical/i.test(h.method));
  const known=stopWins.map(h=>recordQuality(h.opponentRecord)).filter((q):q is number=>q!==null);
  const stats=usableStats(f,event.date,fight.rules);
  return {name:f.name,history,schedule,stopWins,stopLosses,decisions,known,stats};
 });
 const [x,y]=rows,comparable=!!x.schedule&&!!y.schedule&&x.schedule.count>=3&&y.schedule.count>=3&&Math.min(x.schedule.score,y.schedule.score)>=.6&&Math.abs(x.schedule.score-y.schedule.score)<.1;
 const durable=rows.every(r=>r.history.length>=5&&r.stopLosses.length<=1&&r.decisions.length>=2);
 const provenPower=rows.every(r=>r.stats?.kdPer15!==undefined&&r.stats.kdPer15>=.8&&r.stopWins.filter(h=>/\b(?:tko|ko)\b/i.test(h.method)&&(recordQuality(h.opponentRecord)??0)>=.6).length>=2);
 const temper=comparable&&durable&&!provenPower;
 const notes:string[]=[];
 if(temper)notes.push('Similar verified opposition and few recent stoppage losses: their finish rates may not carry over against each other. A longer fight gets more consideration.');
 if(provenPower)notes.push('Both have frequent recorded knockdowns and KO wins over opponents with strong pre-fight records. That keeps a finish plausible even in a close matchup.');
 if(rows.some(r=>r.stopWins.length>r.known.length))notes.push('Some past finish wins lack verified opponent records. They do not prove the same finishing ability at today’s level.');
 if(!comparable)notes.push('Comparable opposition has not been established for both fighters. Similar records alone do not establish equal ability.');
 if(!durable)notes.push('The loaded history does not establish strong recent durability for both fighters.');
 return {temper,provenPower,notes,overAdjustment:temper?.07:0,finishMultiplier:temper?.72:1,summary:rows.map(r=>({name:r.name,bouts:r.history.length,stoppageWins:r.stopWins.length,stoppageLosses:r.stopLosses.length,decisions:r.decisions.length,verifiedFinishOpponents:r.known.length}))};
}
