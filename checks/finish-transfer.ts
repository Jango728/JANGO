import assert from 'node:assert/strict';
import {finishTransfer} from '../lib/finish-transfer';
import {predictRounds} from '../lib/rounds';
import {choreography,JOINTS,SCENE_LENGTH} from '../lib/fight-choreography';
import {SEED_EVENTS,SEED_FIGHTERS} from '../lib/data';
import type {PastFight} from '../lib/types';
const event=SEED_EVENTS[0],fight={...event.fights[0],rounds:3},a=SEED_FIGHTERS[fight.a],b=SEED_FIGHTERS[fight.b];
const history:PastFight[]=Array.from({length:10},(_,i)=>({opponent:'Example',date:`2025-${String(12-i).padStart(2,'0')}-01`,result:'W',promotion:'UFC',rules:'MMA',method:i<4?'KO':'Decision',opponentRecord:'15-2-0',minutes:i<4?6:15,round:i<4?2:3}));
const x={...a,history,stats:undefined},y={...b,history,stats:undefined};
assert(finishTransfer(fight,x,y,event).temper,'Comparable credible opposition with durability should temper finish extrapolation');
const power={asOf:'2025-01-01',source:'https://example.com',scope:'Career',kdPer15:1};
assert(!finishTransfer(fight,{...x,stats:power},{...y,stats:power},event).temper,'Verified power should preserve finish plausibility');
assert(finishTransfer(fight,{...x,stats:{...power,asOf:'2027-01-01'}},{...y,stats:power},event).temper,'Future stats must not enter the matchup');
const weak=history.map(h=>({...h,opponentRecord:'2-8-0'}));assert(!finishTransfer(fight,{...x,history:weak},{...y,history:weak},event).temper,'Equally weak opposition does not prove comparable high-level skill');
const unknown=history.map(h=>({...h,opponentRecord:undefined}));assert(!finishTransfer(fight,{...x,history:unknown},{...y,history:unknown},event).temper);
const withContext=predictRounds(fight,x,y,event)!,withPower=predictRounds(fight,{...x,stats:power},{...y,stats:power},event)!;
assert(withContext.side==='Over'&&withPower.side==='Under','Opponent context must actually influence a borderline rounds lean');
for(const method of ['ko','submission','decision'] as const){
 for(let t=0;t<=SCENE_LENGTH;t+=.025){const s=choreography(method,t);for(const actor of [s.winner,s.loser,s.ref]){assert(actor.position.every(Number.isFinite));for(const k of JOINTS)assert(actor.pose[k].every(Number.isFinite));assert(Math.hypot(actor.position[0],actor.position[2])<2.6,'Actors should remain inside the cage');}}
 const last=choreography(method,SCENE_LENGTH);
 if(method==='decision')assert(last.winner.pose.rw[1]>last.winner.pose.head[1]);else assert(last.loser.pose.head[1]<.3,'Stopped fighter remains on the canvas');
}
console.log('Matchup transfer and continuous cage scene checks passed.');
