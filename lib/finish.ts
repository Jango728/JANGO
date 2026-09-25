import {pastBefore} from './model';
import {predictRounds} from './rounds';
import {finishTransfer} from './finish-transfer';
import type {Fighter,Fight,Event,PastFight,Rules} from './types';
export type FinishMethod='ko'|'submission'|'decision';
export const FINISH_LABELS:Record<FinishMethod,string>={ko:'KO / TKO',submission:'Submission',decision:'Decision'};
export const allowedFinishes=(rules:Rules):FinishMethod[]=>rules==='MMA'?['ko','submission','decision']:rules==='Grappling'?['submission','decision']:['ko','decision'];
export function methodOf(h:PastFight):FinishMethod|null{
 if(h.result==='NC'||/injury|doctor|cut|retire|disqual|technical decision/i.test(h.method))return null;
 if(/submission|\bsub\b/i.test(h.method))return 'submission';
 if(/\b(?:tko|ko)\b/i.test(h.method))return 'ko';
 if(/decision|\b(?:ud|sd|md|dec)\b/i.test(h.method))return 'decision';
 return null;
}
function oppositionDiscount(record?:string){if(!record||!/^\d+-\d+(?:-\d+)?$/.test(record))return .65;const [w,l,d=0]=record.split('-').map(Number);return Math.min(1,Math.max(.35,((w+.5*d+2)/(w+l+d+4))/.7));}
export function predictFinish(fight:Fight,a:Fighter,b:Fighter,event:Event,winnerId:string|null){
 if(!winnerId||![a.id,b.id].includes(winnerId))return null;
 const winner=winnerId===a.id?a:b,opponent=winnerId===a.id?b:a,methods=allowedFinishes(fight.rules);
 const wh=pastBefore(winner,event.date,fight.rules).filter(h=>h.result!=='NC').slice(0,10),oh=pastBefore(opponent,event.date,fight.rules).filter(h=>h.result!=='NC').slice(0,10);
 const wins=wh.filter(h=>h.result==='W'&&methods.includes(methodOf(h)!)),losses=oh.filter(h=>h.result==='L'&&methods.includes(methodOf(h)!));
 const scores=Object.fromEntries(methods.map(m=>[m,1])) as Record<FinishMethod,number>;
 wh.forEach((h,i)=>{const m=methodOf(h);if(h.result==='W'&&m&&methods.includes(m))scores[m]+=Math.pow(.9,i)*(m==='decision'?1:oppositionDiscount(h.opponentRecord));});
 oh.forEach((h,i)=>{const m=methodOf(h);if(h.result==='L'&&m&&methods.includes(m))scores[m]+=.8*Math.pow(.9,i);});
 const transfer=finishTransfer(fight,a,b,event);
 for(const m of methods)if(m!=='decision')scores[m]*=transfer.finishMultiplier;
 const rounds=predictRounds(fight,a,b,event),under=rounds?.side==='Under'&&rounds.confidence!==null;
 // An evidence-backed Under excludes a decision; otherwise tied scores prefer decision.
 const candidates=under?methods.filter(m=>m!=='decision'):methods;
 const method=candidates.reduce((best,m)=>scores[m]>scores[best]||scores[m]===scores[best]&&m==='decision'?m:best,candidates[0]);
 const matchingWins=wins.filter(h=>methodOf(h)===method).length,matchingLosses=losses.filter(h=>methodOf(h)===method).length;
 const limited=wins.length<3||losses.length<2;
 const reasons=[`${winner.name}: ${matchingWins} of ${wins.length} classified recent wins by ${FINISH_LABELS[method].toLowerCase()}.`,`${opponent.name}: ${matchingLosses} of ${losses.length} classified recent losses by this method.`];
 if(transfer.temper)reasons.push(transfer.notes[0]);
 if(under)reasons.push('The rounds model leans Under, so a decision is excluded from this scenario.');
 if(!wins.length&&!losses.length)reasons.splice(0,reasons.length,'No classified win/loss methods available. This is a fallback illustration, not an evidence-backed method pick.');
 return {modelVersion:'0.2',winnerId,method,label:FINISH_LABELS[method],limited,reasons,sources:[winner,opponent].flatMap(f=>f.historySource?[{name:f.name,url:f.historySource}]:[])};
}
export type FinishPrediction=NonNullable<ReturnType<typeof predictFinish>>;
