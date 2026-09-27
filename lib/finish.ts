import {pastBefore} from './model';
import {predictRounds} from './rounds';
import {finishTransfer} from './finish-transfer';
import {statsAsOf} from './fight-stats';
import type {Fighter,Fight,Event,PastFight,Rules} from './types';
export type FinishMethod='ko'|'submission'|'decision';
export const FINISH_MODEL_VERSION='1.3';
export const FINISH_LABELS:Record<FinishMethod,string>={ko:'KO / TKO',submission:'Submission',decision:'Decision'};
export const allowedFinishes=(rules:Rules):FinishMethod[]=>rules==='MMA'?['ko','submission','decision']:rules==='Grappling'?['submission','decision']:['ko','decision'];
export function methodOf(h:PastFight):FinishMethod|null{
 if(h.result==='NC'||/injury|doctor|cut|retire|disqual|technical decision/i.test(h.method))return null;
 if(/submission|\bsub\b/i.test(h.method))return 'submission';
 if(/\b(?:tko|ko)\b/i.test(h.method))return 'ko';
 if(/decision|\b(?:ud|sd|md|dec)\b/i.test(h.method))return 'decision';
 return null;
}
const sigmoid=(z:number)=>1/(1+Math.exp(-z)),logit=(p:number)=>{const q=Math.min(.9999,Math.max(1e-4,p));return Math.log(q/(1-q));};
/** Last-10 method profile: share of bouts won by KO / sub, lost by KO / sub, and decided on the cards. */
function profile(f:Fighter,event:Event,rules:Rules){
 const h=pastBefore(f,event.date,rules).filter(x=>x.result!=='NC').slice(0,10),n=Math.max(h.length,1);
 const share=(r:'W'|'L',m:FinishMethod)=>h.filter(x=>x.result===r&&methodOf(x)===m).length/n;
 return {h,koW:share('W','ko'),subW:share('W','submission'),koL:share('L','ko'),subL:share('L','submission'),dec:h.filter(x=>/decision/i.test(x.method)).length/n};
}
/**
 * Method 1.2 — two calibrated steps, fitted on UFC bouts 2021–2024 and checked on 2025–26 (1.3: same formula, reads rounds 1.3):
 *  1. P(decision) from the rounds model's P(Over) and both fighters' decision rates.
 *  2. If it's finished: submission vs KO from the winner's finish routes, the loser's stoppage
 *     losses, and as-of UFC rates (sub attempts vs takedown defence, knockdowns vs chin).
 * The most likely of KO / submission / decision is the pick. An Under rounds pick rules out a decision.
 */
export function predictFinish(fight:Fight,a:Fighter,b:Fighter,event:Event,winnerId:string|null){
 if(!winnerId||![a.id,b.id].includes(winnerId))return null;
 const winner=winnerId===a.id?a:b,opponent=winnerId===a.id?b:a,methods=allowedFinishes(fight.rules);
 const w=profile(winner,event,fight.rules),l=profile(opponent,event,fight.rules);
 const rounds=predictRounds(fight,a,b,event),under=rounds?.side==='Under'&&rounds.confidence!==null;
 const transfer=finishTransfer(fight,a,b,event);
 const pOver=rounds?.pOver??.68;
 const pDec=sigmoid(-.69+.81*logit(pOver)+.69*((w.dec+l.dec)/2-.5));
 const sw=fight.rules==='MMA'?statsAsOf(winner,event.date):null,sl=fight.rules==='MMA'?statsAsOf(opponent,event.date):null;
 const subx=sw&&sl?sw.subPer15*(1-sl.tdDef)-.2:0,kdx=sw&&sl?sw.kdPer15*sl.kdAgainstPer15-.07:0;
 const pSubGivenFinish=sigmoid(-.56+1.33*w.subW-1.29*w.koW+1.13*l.subL+.24*l.koL+.63*subx-.54*kdx);
 const probs:Record<FinishMethod,number>={decision:pDec,submission:(1-pDec)*pSubGivenFinish,ko:(1-pDec)*(1-pSubGivenFinish)};
 // Rule sets without submissions (kickboxing, Muay Thai) fold that share into KO; grappling folds KO into submission.
 if(!methods.includes('submission')){probs.ko+=probs.submission;probs.submission=0;}
 if(!methods.includes('ko')){probs.submission+=probs.ko;probs.ko=0;}
 // An evidence-backed Under excludes a decision; otherwise ties prefer decision.
 const candidates=under?methods.filter(m=>m!=='decision'):methods;
 const method=candidates.reduce((best,m)=>probs[m]>probs[best]||probs[m]===probs[best]&&m==='decision'?m:best,candidates[0]);
 const wins=w.h.filter(x=>x.result==='W'&&methods.includes(methodOf(x)!)),losses=l.h.filter(x=>x.result==='L'&&methods.includes(methodOf(x)!));
 const matchingWins=wins.filter(h=>methodOf(h)===method).length,matchingLosses=losses.filter(h=>methodOf(h)===method).length;
 const limited=wins.length<3||losses.length<2;
 const reasons=[`${winner.name}: ${matchingWins} of ${wins.length} classified recent wins by ${FINISH_LABELS[method].toLowerCase()}.`,`${opponent.name}: ${matchingLosses} of ${losses.length} classified recent losses by this method.`];
 if(method==='decision')reasons.push(`About ${Math.round(pDec*100)}% of fights like this go to the judges.`);
 else reasons.push(`Chance it's finished: about ${Math.round((1-pDec)*100)}%; ${method==='submission'?'submission':'KO/TKO'} is the likelier route.`);
 if(transfer.temper)reasons.push(transfer.notes[0]);
 if(under)reasons.push('The rounds model leans Under, so a decision is excluded from this scenario.');
 if(!wins.length&&!losses.length)reasons.splice(0,2,'No classified win/loss methods available. This leans on the division and rounds base rates.');
 return {modelVersion:FINISH_MODEL_VERSION,winnerId,method,label:FINISH_LABELS[method],probabilities:probs,limited,reasons,sources:[winner,opponent].flatMap(f=>f.historySource?[{name:f.name,url:f.historySource}]:[])};
}
export type FinishPrediction=NonNullable<ReturnType<typeof predictFinish>>;
