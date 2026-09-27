import { pastBefore,clamp } from './model';
import {finishTransfer} from './finish-transfer';
import {statsAsOf} from './fight-stats';
import {roundFormAsOf,type RoundForm} from './round-features';
import type { Event,Fight,Fighter,PastFight,Rules } from './types';
export const ROUNDS_MODEL_VERSION='1.3';
/**
 * Share of UFC bouts that go OVER the standard line (7:30 for 3 rounds, 12:30 for 5), by division.
 * League-wide base rates from every UFC bout 2019–2024 in the roster (not fighter data).
 * Five-round rates are shrunk toward the 3-round rate (small samples): heavyweight and lightweight
 * five-rounders end early far more often than the old flat "−4%" assumed.
 */
const OVER_3R:[RegExp,number][]=[[/women.*straw/,.78],[/women.*fly/,.83],[/women.*bantam/,.81],[/women.*feather/,.76],[/light heavy/,.56],[/heavy/,.57],[/middle/,.62],[/welter/,.68],[/light/,.65],[/feather/,.70],[/bantam/,.71],[/fly/,.65],[/straw/,.78]];
const OVER_5R:[RegExp,number][]=[[/women.*straw/,.68],[/women.*fly/,.79],[/women.*bantam/,.76],[/women.*feather/,.73],[/light heavy/,.52],[/heavy/,.40],[/middle/,.71],[/welter/,.77],[/light/,.52],[/feather/,.71],[/bantam/,.75],[/fly/,.60],[/straw/,.68]];
export function divisionOverPrior(division:string,line:number){
 const d=division.toLowerCase(),table=line>=2.5?OVER_5R:OVER_3R;
 return table.find(([re])=>re.test(d))?.[1]??(line>=2.5?.62:.68);
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
const logit=(p:number)=>Math.log(p/(1-p)),sigmoid=(z:number)=>1/(1+Math.exp(-z));
/**
 * Rounds 1.2 — calibrated P(Over) (1.3 adds the round-by-round terms below). Logistic coefficients fitted on
 * UFC bouts 2021–2024 and checked on 2025–26 (scripts/backtest.ts):
 *   division/line base rate · each fighter's weighted duration history (UFC-first, weak-opposition
 *   finishes discounted) · how often both finish and get finished · matched finish routes
 *   (KO wins vs KO losses, subs vs sub losses) ·
 *   the elite-vs-elite rule (similar strong opposition + durable → longer, unless both are proven power).
 */
// Fitted on 2021–24 (intercept .23, prior .97, history 2.04, finish rate −.59, stopped rate −.52, matched −.52;
// elite-vs-elite +.62 on 70 bouts, shrunk to +.3 because 2025–26 didn't confirm it; proven power had only 4 bouts,
// kept at a modest −.4 as the owner's rule rather than a fitted effect).
const C={intercept:.23,prior:.97,hist:2.04,fin:-.59,stopped:-.52,matched:-.52,temper:.3,power:-.4};
/**
 * Rounds 1.3 — round-by-round terms added on top of the 1.2 log-odds (fitted on 2021–24, scripts/backtest-rounds.ts;
 * every rolling fold inside 2021–24 and the 2025–26 test agreed on the sign):
 *  r1   early danger that meets early fragility: each side's round-1 knockdowns + ½ sub attempts per bout × the
 *       other side's round-1 knockdowns suffered per bout (recent bouts weighted most) → Under.
 *  ctrl how long each fighter stays controlled per takedown absorbed (can he get back up?) → longer = Under.
 */
const R13={r1:-4.47,r1Mean:.0406,ctrl:-.282,ctrlMean:1.696,decay:.75};
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
  const n=Math.max(h.length,1);
  return {id:f.id,name:f.name,history:h,rows,known,over:known.filter(x=>x.side==='Over').length,under:known.filter(x=>x.side==='Under').length,exact:rows.filter(x=>x.side==='Exact').length,estimate:(over+2)/(total+4),discounted,finishWins:wins,ko,sub,koLoss,subLoss,
   finRate:wins.reduce((s,x)=>s+finishQuality(x),0)/n,stoppedRate:(koLoss.length+subLoss.length)/n,stats:fight.rules==='MMA'?statsAsOf(f,event.date):null,source:f.historySource};
 });
 const [x,y]=sample,total=x.known.length+y.known.length;
 // Matched finishing threat requires evidence of both attack and the opponent's losses.
 const rate=(xs:PastFight[],h:PastFight[])=>xs.reduce((n,x)=>n+(x.result==='W'?finishQuality(x):1),0)/Math.max(h.length,1);
 const koRisk=Math.max(rate(x.ko,x.history)*rate(y.koLoss,y.history),rate(y.ko,y.history)*rate(x.koLoss,x.history));
 const subRisk=fight.rules==='MMA'?Math.max(rate(x.sub,x.history)*rate(y.subLoss,y.history),rate(y.sub,y.history)*rate(x.subLoss,x.history)):0;
 const enough=x.known.length>=3&&y.known.length>=3,transfer=finishTransfer(fight,a,b,event);
 // Contender Series bouts end early far more often than UFC bouts: 43 of 78 pre-2026 DWCS bouts in our
 // fighters' histories went over 1.5 (55%) against ~68% for the UFC, so the base rate drops 13 points there.
 const prior=clamp(divisionOverPrior(fight.division,line)-(event.promotion==='DWCS'?.13:0),.2,.9);
 // Duration history counts in proportion to how much of it there is (10 known bouts = full weight).
 const hist=((x.estimate+y.estimate)/2-.68)*Math.min(1,total/10);
 const kdx=x.stats&&y.stats?x.stats.kdPer15*y.stats.kdAgainstPer15+y.stats.kdPer15*x.stats.kdAgainstPer15-.07:0;
 const fa=fight.rules==='MMA'?roundFormAsOf(a,event.date,R13.decay):null,fb=fight.rules==='MMA'?roundFormAsOf(b,event.date,R13.decay):null;
 // Fitted on fighters with 3+ UFC bouts each; thinner samples leave the 1.2 lean unchanged.
 const tapeOk=!!fa&&!!fb&&fa.bouts>=3&&fb.bouts>=3;
 const r1x=tapeOk?fa!.r1Threat*fb!.r1Leak+fb!.r1Threat*fa!.r1Leak:null,ctrlTd=tapeOk?(fa!.ctrlPerTd+fb!.ctrlPerTd)/2/60:null;
 const tape=r1x!==null&&ctrlTd!==null?R13.r1*(r1x-R13.r1Mean)+R13.ctrl*(ctrlTd-R13.ctrlMean):0;
 const z=tape+C.intercept+C.prior*logit(prior)+C.hist*hist+C.fin*((x.finRate+y.finRate)/2-.35)+C.stopped*((x.stoppedRate+y.stoppedRate)/2-.2)+C.matched*(Math.max(koRisk,subRisk)-.05)+(transfer.temper?C.temper:0)+(transfer.provenPower?C.power:0);
 const pOver=clamp(sigmoid(z),.05,.95);
 const side=pOver>=.5?'Over':'Under';
 const strength=total===0?'No duration data':!enough?'Very limited data':total<14?'Limited sample':'Last-10 sample';
 const certainty=Math.min(enough?85:62,Math.max(51,Math.round(100*Math.max(pOver,1-pOver))));
 const notes=[...sample.map(s=>`${s.name}: ${s.over}/${s.known.length} known bouts went over ${line}; ${s.under} stayed under.`)];
 if(enough&&Math.max(koRisk,subRisk)>.08)notes.push(subRisk>koRisk?'Submission wins meet a history of submission losses: an earlier finish is plausible.':'Knockout wins meet a history of knockout losses: an earlier finish is plausible.');
 else if(sample.some(s=>s.discounted))notes.push('Early wins against weak or unverified opposition carry less influence.');
 else notes.push('Recent duration patterns drive this lean; weight class alone does not force an early finish.');
 if(enough&&(transfer.temper||transfer.provenPower))notes.splice(2,0,transfer.notes[0]);
 const tapeNote=tapeOk?roundTapeNote(a,b,fa,fb,tape):null;
 if(tapeNote)notes.splice(2,0,tapeNote);
 if(!enough)notes.push(total===0?`No usable duration history yet — this lean comes from the ${fight.division.toLowerCase()} base rate.`:'Sparse duration history: the division base rate carries more of this lean.');
 notes.push(event.promotion==='DWCS'?`Base rate: about ${Math.round(prior*100)}% of Contender Series ${fight.division.toLowerCase()} fights go over ${line}.`:`Base rate: ${Math.round(prior*100)}% of UFC ${fight.division.toLowerCase()} ${fight.rounds}-round fights go over ${line}.`);
 if(event.promotion==='UFC'&&sample.some(s=>s.history.some(h=>h.promotion!=='UFC')))notes.push('UFC experience is prioritised; earlier non-UFC finishes are supporting evidence, not proof of finishing this opponent.');
 return {modelVersion:ROUNDS_MODEL_VERSION,side,line,roundMinutes,scheduledRounds:fight.rounds,thresholdMinutes:line*roundMinutes,confidence:certainty,pOver,prior,strength,sample:sample.map(s=>({id:s.id,name:s.name,over:s.over,under:s.under,known:s.known.length,exact:s.exact,source:s.source})),notes,limited:!enough,
  features:{prior,hist,fin:(x.finRate+y.finRate)/2,stopped:(x.stoppedRate+y.stoppedRate)/2,matched:Math.max(koRisk,subRisk),kdx,temper:transfer.temper,power:transfer.provenPower,r1x,ctrlTd,tape},
  durationEvidence:sample.map(s=>({id:s.id,name:s.name,rows:s.rows.map(r=>({...r.h,side:r.side})),samePromotion:s.known.filter(r=>r.h.promotion===event.promotion).map(r=>r.side),otherPromotions:s.known.filter(r=>r.h.promotion!==event.promotion).map(r=>r.side)}))};
}
export type RoundsPrediction=NonNullable<ReturnType<typeof predictRounds>>;
/** Plain-English line for the round-by-round terms when they move the lean by a meaningful amount. */
function roundTapeNote(a:Fighter,b:Fighter,fa:RoundForm|null,fb:RoundForm|null,tape:number):string|null{
 if(!fa||!fb||Math.abs(tape)<.15)return null;
 if(tape>0)return 'Round-by-round numbers: neither fighter carries much round-1 danger or stays stuck on the bottom, which favours a longer fight.';
 const r1x=fa.r1Threat*fb.r1Leak+fb.r1Threat*fa.r1Leak,ctrl=(fa.ctrlPerTd+fb.ctrlPerTd)/2/60;
 if(R13.r1*(r1x-R13.r1Mean)<=R13.ctrl*(ctrl-R13.ctrlMean)){
  const [x,y]=fa.r1Threat*fb.r1Leak>=fb.r1Threat*fa.r1Leak?[a,b]:[b,a];
  return `Round-1 danger: ${x.name} scores early knockdowns or submission attempts, and ${y.name} has been hurt in round 1 before (UFC round-by-round numbers).`;
 }
 const [who,form]=fa.ctrlPerTd>=fb.ctrlPerTd?[a,fa]:[b,fb];
 return `${who.name} stays controlled for about ${Math.round(form.ctrlPerTd)} seconds per takedown absorbed (UFC round-by-round numbers): long spells on the bottom lead to finishes.`;
}
