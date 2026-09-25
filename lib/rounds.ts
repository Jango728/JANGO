import { pastBefore,clamp } from './model';
import {finishTransfer} from './finish-transfer';
import type { Event,Fight,Fighter,PastFight,Rules } from './types';
export const ROUNDS_MODEL_VERSION='1.1';
/** Approximate share of UFC bouts that go OVER the standard line, by division (league-wide base rates, not fighter data). */
export function divisionOverPrior(division:string,line:number){
 const d=division.toLowerCase();
 const women=/women/.test(d);
 const base=/heavyweight/.test(d)&&!/light/.test(d)?.52:/light heavyweight/.test(d)?.58:/middleweight/.test(d)?.64:/welterweight/.test(d)?.68:/lightweight/.test(d)?.69:/featherweight/.test(d)?(women?.8:.7):/bantamweight/.test(d)?(women?.8:.72):/flyweight/.test(d)?(women?.82:.74):/strawweight/.test(d)?.83:.68;
 // A 5-round fight's 2.5 line (12:30) is passed a little less often than a 3-round fight's 1.5 line (7:30).
 return line>=2.5?base-.04:base;
}
export const roundLength=(rules:Rules)=>rules==='MMA'?5:rules==='Muay Thai'||rules==='Kickboxing'?3:null;
export function durationSide(h:PastFight,line:number,roundMinutes:number):'Over'|'Under'|'Exact'|null{
 if(h.result==='NC')return null;
 if(!Number.isFinite(line)||line<=0||!Number.isFinite(roundMinutes)||roundMinutes<=0)return null;
 const clock=h.time?.match(/^(\d+):(\d{2})$/),round=Number.isInteger(h.round)&&h.round!>0?h.round:null;
 const clockMinutes=clock&&Number(clock[2])<60?Number(clock[1])+Number(clock[2])/60:null;
 // Use a valid recorded clock first; total minutes may cover a nonstandard format.
 const elapsed=round&&clockMinutes!==null&&clockMinutes<=roundMinutes?(round-1)*roundMinutes+clockMinutes:
  Number.isFinite(h.minutes)&&h.minutes!>=0?h.minutes!:null;
 if(elapsed!==null){if(Math.abs(elapsed-line*roundMinutes)<1e-6)return 'Exact';return elapsed>line*roundMinutes?'Over':'Under';}
 if(round){if(round-1>line)return 'Over';if(round<line)return 'Under';}
 if(/^Decision\b/i.test(h.method)&&!/Technical Decision/i.test(h.method))return 'Over';
 return null;
}
const ending=(h:PastFight)=>/KO|TKO|Submission/i.test(h.method)&&!/injury|cut|doctor|retire|disqual/i.test(h.method);
function quality(record?:string){if(!record||!/^\d+-\d+(?:-\d+)?$/.test(record))return null;const [w,l,d=0]=record.split('-').map(Number);return (w+.5*d+2)/(w+l+d+4);}
const finishQuality=(h:PastFight)=>{const q=quality(h.opponentRecord);return q===null?.65:clamp(q/.7,.35,1);};
export function predictRounds(fight:Fight,a:Fighter,b:Fighter,event:Event){
 const line=fight.rounds===3?1.5:fight.rounds>=4?2.5:null,roundMinutes=roundLength(fight.rules);
 if(line===null||roundMinutes===null)return null;
 const sample=[a,b].map(f=>{
  const h=pastBefore(f,event.date,fight.rules).filter(x=>x.result!=='NC').slice(0,10);
  const sameLevel=h.filter(x=>x.promotion===event.promotion).length;
  // Prefer demonstrated duration at this level; a regional finish streak is not
  // interchangeable with UFC finishing ability. No promotion-wide KO prior.
  const otherLevel=event.promotion==='UFC'?(sameLevel>=3?.45:.65):.75;
  const rows=h.map((x,i)=>({h:x,side:durationSide(x,line,roundMinutes),weight:Math.pow(.9,i)*(x.promotion===event.promotion?1:otherLevel)*(x.division&&x.division!==fight.division ? .7 : 1)}));
  const known=rows.filter(x=>x.side==='Over'||x.side==='Under');
  let total=0,over=0,discounted=0;
  for(const r of known){let weight=r.weight;const q=quality(r.h.opponentRecord);if(r.side==='Under'&&r.h.result==='W'&&ending(r.h)){weight*=finishQuality(r.h);if(q===null||q<.55)discounted++;}if(/injury|disqual|doctor|cut/i.test(r.h.method))weight*=.35;total+=weight;if(r.side==='Over')over+=weight;}
  const wins=h.filter(x=>x.result==='W'&&ending(x));
  const ko=h.filter(x=>x.result==='W'&&/KO|TKO/i.test(x.method)&&ending(x)),sub=h.filter(x=>x.result==='W'&&/Submission/i.test(x.method)&&ending(x));
  const koLoss=h.filter(x=>x.result==='L'&&/KO|TKO/i.test(x.method)&&ending(x)),subLoss=h.filter(x=>x.result==='L'&&/Submission/i.test(x.method)&&ending(x));
  return {id:f.id,name:f.name,history:h,rows,known,over:known.filter(x=>x.side==='Over').length,under:known.filter(x=>x.side==='Under').length,exact:rows.filter(x=>x.side==='Exact').length,estimate:(over+2)/(total+4),discounted,finishWins:wins,ko,sub,koLoss,subLoss,source:f.historySource};
 });
 const [x,y]=sample,total=x.known.length+y.known.length;
 // Matched finishing threat requires evidence of both attack and the opponent's losses.
 // Division/promotion relevance enters through observed bouts, not invented population priors.
 const rate=(xs:PastFight[],h:PastFight[])=>xs.reduce((n,x)=>n+(x.result==='W'?finishQuality(x):1),0)/Math.max(h.length,1);
 const koRisk=Math.max(rate(x.ko,x.history)*rate(y.koLoss,y.history),rate(y.ko,y.history)*rate(x.koLoss,x.history));
 const subRisk=fight.rules==='MMA'?Math.max(rate(x.sub,x.history)*rate(y.subLoss,y.history),rate(y.sub,y.history)*rate(x.subLoss,x.history)):0;
 const enough=x.known.length>=3&&y.known.length>=3,transfer=finishTransfer(fight,a,b,event);
 const history=clamp((x.estimate+y.estimate)/2-(enough?.12*Math.max(koRisk,subRisk):0)+(enough?transfer.overAdjustment:0),.15,.85);
 // Blend fighter history with the division base rate; thin histories lean on the base rate.
 const prior=divisionOverPrior(fight.division,line),trust=Math.min(.7,total/20);
 const overIndex=clamp(trust*history+(1-trust)*prior,.15,.85);
 const side=overIndex>=.5?'Over':'Under';
 const strength=total===0?'No duration data':!enough?'Very limited data':total<14?'Limited sample':'Last-10 sample';
 const certainty=Math.min(enough?80:62,Math.max(51,Math.round(50+Math.abs(overIndex-.5)*80)));
 const notes=[...sample.map(s=>`${s.name}: ${s.over}/${s.known.length} known bouts went over ${line}; ${s.under} stayed under.`)];
 if(enough&&Math.max(koRisk,subRisk)>0)notes.push(subRisk>koRisk?'Submission wins meet a history of submission losses: an earlier finish is plausible.':'Knockout wins meet a history of knockout losses: an earlier finish is plausible.');
 else if(sample.some(s=>s.discounted))notes.push('Early wins against weak or unverified opposition carry less influence.');
 else notes.push('Recent duration patterns drive this lean; weight class alone does not force an early finish.');
 if(enough&&(transfer.temper||transfer.provenPower))notes.splice(2,0,transfer.notes[0]);
 if(!enough)notes.push(total===0?`No usable duration history yet — this lean comes from the ${fight.division.toLowerCase()} base rate.`:'Sparse duration history: the division base rate carries more of this lean.');
 if(/heavyweight/i.test(fight.division)&&!/light/i.test(fight.division))notes.push('Heavyweight: one clean shot ends fights early far more often than in lighter divisions.');
 if(event.promotion==='UFC'&&sample.some(s=>s.history.some(h=>h.promotion!=='UFC')))notes.push('UFC experience is prioritised; earlier non-UFC finishes are supporting evidence, not proof of finishing this opponent.');
 return {modelVersion:ROUNDS_MODEL_VERSION,side,line,roundMinutes,scheduledRounds:fight.rounds,thresholdMinutes:line*roundMinutes,confidence:certainty,strength,sample:sample.map(s=>({id:s.id,name:s.name,over:s.over,under:s.under,known:s.known.length,exact:s.exact,source:s.source})),notes,limited:!enough,
  durationEvidence:sample.map(s=>({id:s.id,name:s.name,rows:s.rows.map(r=>({...r.h,side:r.side})),samePromotion:s.known.filter(r=>r.h.promotion===event.promotion).map(r=>r.side),otherPromotions:s.known.filter(r=>r.h.promotion!==event.promotion).map(r=>r.side)}))};
}
export type RoundsPrediction=NonNullable<ReturnType<typeof predictRounds>>;
