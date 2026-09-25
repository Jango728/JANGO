import {technicalContext} from '@/lib/technical-context';
import type {Event,Fight} from '@/lib/types';
export function TechnicalRead({event,fight,compact=false}:{event:Event;fight:Fight;compact?:boolean}){
 const read=technicalContext(event,fight);
 if(!read)return compact?null:<p className="fine">No technical report or footage assessment has been completed for this matchup yet. Unreviewed links do not influence a pick.</p>;
 return <section className="technical-read surface"><p className="eyebrow">TECHNICAL READ · REPORT-BASED</p><h3>{read.assessment}</h3><p>{read.implication}</p><details open={!compact}><summary>Evidence and limitations</summary>{read.evidence.map(e=><div key={e.url}><strong>{e.fighter} · {e.date}</strong><p>{e.note}</p><a className="out" href={e.url} target="_blank" rel="noopener noreferrer">Read original report ↗</a></div>)}<p className="fine">{read.limitation}</p><p className="fine">Our qualitative interpretation, checked September 15, 2026. The statistics percentage above remains separate; no market odds or outside winner picks are used.</p></details></section>;
}
