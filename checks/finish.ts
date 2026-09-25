import assert from 'node:assert/strict';
import {predictFinish,methodOf,allowedFinishes} from '../lib/finish';
import {SEED_EVENTS,SEED_FIGHTERS} from '../lib/data';
import {analyze,DEFAULT_WEIGHTS} from '../lib/model';
import {predictRounds} from '../lib/rounds';
import type {PastFight} from '../lib/types';
const h:PastFight={opponent:'Example',date:'2025-01-01',result:'W',promotion:'UFC',rules:'MMA',method:'Submission (Rear-Naked Choke)',opponentRecord:'15-2-0',minutes:3,round:1};
assert.equal(methodOf(h),'submission');assert.equal(methodOf({...h,method:'TKO (Punches)'}),'ko');assert.equal(methodOf({...h,method:'Decision (Split)'}),'decision');assert.equal(methodOf({...h,result:'NC'}),null);assert.equal(methodOf({...h,method:'TKO (Doctor stoppage)'}),null);
assert(!allowedFinishes('Kickboxing').includes('submission'));assert(!allowedFinishes('Muay Thai').includes('submission'));
const event=SEED_EVENTS[0],fight=event.fights[0],a=SEED_FIGHTERS[fight.a],b=SEED_FIGHTERS[fight.b];
assert.equal(predictFinish(fight,a,b,event,null),null);assert.equal(predictFinish(fight,a,b,event,'unknown'),null);
const rows=Array.from({length:8},(_,i)=>({...h,date:`2025-${String(i+1).padStart(2,'0')}-01`}));
const wa={...a,history:rows},lo={...b,history:rows.map(h=>({...h,result:'L' as const}))};
const p=predictFinish(fight,wa,lo,event,a.id)!;assert.equal(p.method,'submission');
const contaminated={...wa,history:[...rows,{...h,date:'2027-01-01',method:'KO'},{...h,rules:'Kickboxing' as const,method:'KO',date:'2026-01-01'}]};
assert.deepEqual(predictFinish({...fight,odds:{a:10000,b:-10000,source:'https://example.com',asOf:event.date}},contaminated,lo,event,a.id),p);
const empty=predictFinish(fight,{...a,history:[]},{...b,history:[]},event,a.id)!;assert.equal(empty.method,'decision');assert(empty.limited);
for(const e of SEED_EVENTS)for(const f of e.fights){const a=SEED_FIGHTERS[f.a],b=SEED_FIGHTERS[f.b],winner=analyze(f,a,b,e,DEFAULT_WEIGHTS).pick,r=predictFinish(f,a,b,e,winner);if(r){assert(allowedFinishes(f.rules).includes(r.method));assert.equal(r.winnerId,winner);const total=predictRounds(f,a,b,e);if(total?.side==='Under')assert.notEqual(r.method,'decision');}}
console.log('Finish checks passed: legal methods, source cutoff, odds independence, abstention and consistency with round totals.');
