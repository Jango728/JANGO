"use client";
import { lazy, Suspense } from 'react';
import { Timer } from 'lucide-react';
import { tierFor } from '@/lib/engine';
// The per-bout evidence table (and its UI-library code) loads only on the full Rounds tab.
const DurationEvidence=lazy(()=>import('./duration-evidence').then(m=>({default:m.DurationEvidence})));
import { predictRounds } from '@/lib/rounds';
import type { Event,Fight,Fighter } from '@/lib/types';
/** A locked bout's frozen rounds call (lib/displayed-pick.ts): undefined = not locked, null = none was frozen. */
export type LockedRounds={side:string;line:number;agrees:boolean}|null|undefined;
export function RoundsPick({fight,a,b,event,compact=false,lock}:{fight:Fight;a:Fighter;b:Fighter;event:Event;compact?:boolean;lock?:LockedRounds}){
 const live=predictRounds(fight,a,b,event);
 if(lock===null)return <div className="rounds-pick"><strong>{fight.rounds}-round bout</strong><p>No rounds call was frozen for this bout before the card locked.</p></div>;
 // Locked: the frozen side/line is the call; today's model only explains it when it agrees.
 const r=live&&lock?{...live,side:lock.side,line:lock.line}:live;
 const todayNote=live&&lock&&!lock.agrees?`Locked call from before the fight. Today's model leans ${live.side} ${live.line}${live.confidence===null?'':` (${live.confidence}%)`}.`:null;
 const notes=todayNote?[todayNote]:(r?.notes??[]);
 const conf=(x:NonNullable<typeof r>)=>lock?'Locked pick':x.confidence===null?"Low evidence":`${x.confidence}% · ${tierFor(x.confidence)}`;
 if(!r)return <div className="rounds-pick"><strong>{fight.rounds}-round bout</strong><p>No standard 1.5 / 2.5 total applies to this format.</p></div>;
 if(compact)return <section className="rounds-summary surface" aria-label="Rounds prediction"><div className="rounds-compact"><div><span>Rounds pick</span><strong>{r.side} {r.line}</strong></div><div><span>{lock?'Frozen before the fight':`Confidence · ${fight.rounds} rounds`}</span><strong>{conf(r)}</strong></div></div><ul className={todayNote?'rounds-locked-note':undefined}>{notes.slice(0,3).map((note,i)=><li key={i}>{note}</li>)}</ul></section>;
 const half=r.roundMinutes/2,clock=`${Math.floor(half)}:${String(Math.round(half%1*60)).padStart(2,'0')}`;
 return <section className="rounds-pick"><div className="rounds-pick-heading"><div><p className="eyebrow"><Timer size={14}/> ROUNDS PICK</p><h4>{r.side} {r.line} <span>rounds</span></h4></div>{lock?<div><strong>Locked <small>pick</small></strong><span>frozen before the fight</span></div>:<div><strong>{r.confidence===null?'Very low':r.confidence+'%'} <small>{r.confidence===null?'confidence':tierFor(r.confidence)}</small></strong><span>{r.strength} · unvalidated</span></div>}</div><div className="rounds-timeline" role="img" aria-label={`${fight.rounds} scheduled rounds. ${r.side} ${r.line} rounds.`}>{Array.from({length:fight.rounds},(_,i)=><span key={i} aria-hidden="true">R{i+1}</span>)}<i style={{left:`${r.line/fight.rounds*100}%`}}/><div className={'rounds-zone '+r.side.toLowerCase()} style={r.side==='Over'?{left:`${r.line/fight.rounds*100}%`,right:0}:{left:0,width:`${r.line/fight.rounds*100}%`}}/></div><p className="rounds-cutoff">{fight.rounds} × {r.roundMinutes}-minute rounds · Cutoff: {clock} elapsed in round {Math.ceil(r.line)}</p><p className="rounds-meaning">{r.side==='Over'?'Fight continues beyond':'Fight ends before'} the cutoff.</p>{!lock&&r.limited&&<p className="rounds-limited">{r.confidence===null?'Fallback guess — no usable duration history.':'Tentative guess — limited duration history.'}</p>}<ul className={todayNote?'rounds-locked-note':undefined}>{notes.slice(0,3).map((n,i)=><li key={i}>{n}</li>)}</ul><Suspense fallback={null}><DurationEvidence prediction={live??r} promotion={event.promotion}/></Suspense><div className="stat-sources">{r.sample.map(s=>s.source&&<a className="out" key={s.id} href={s.source} target="_blank" rel="noopener noreferrer">{s.name} history ↗</a>)}</div></section>;
}
