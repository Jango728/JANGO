"use client";
// Film room tab: report-based technical read, verified footage, official clips and search links.
// Loaded on first use (it needs the clip catalog and every fighter profile).
import { ArrowUpRight } from "lucide-react";
import { TechnicalRead } from "./technical-context";
import { Portrait } from "./fight-experience";
import { ClipStrip } from "./clip-strip";
import { clipsForFighter } from "@/lib/clips";
import { technicalContext } from "@/lib/technical-context";
import { FOOTAGE } from "@/lib/footage";
import type { Event, Fight, Fighter } from "@/lib/types";

export function FilmRoom({ a, b, event, fight }: { a: Fighter; b: Fighter; event: Event; fight: Fight }) {
  const film = FOOTAGE.filter((v) => [a.id, b.id].includes(v.fighter) && v.date < event.date);
  const clips = [...clipsForFighter(a.name), ...clipsForFighter(b.name)];
  return (
    <div className="jp-film">
      {technicalContext(event, fight) && <TechnicalRead event={event} fight={fight} />}
      <div className="jp-card">
        <h3 className="jp-h3">Film room</h3>
        {film.length ? (
          <div className="footage-grid">
            {film.map((v) => (
              <a key={v.url} href={v.url} target="_blank" rel="noopener noreferrer" className="footage-card">
                <span className="jp-tag">{v.kind}</span>
                <strong>
                  {v.title} <ArrowUpRight size={14} aria-hidden="true" />
                </strong>
                <span>
                  {v.publisher} · {v.date}
                </span>
                <p>Watch for: {v.focus}</p>
              </a>
            ))}
          </div>
        ) : (
          <p className="jp-fine">No verified full fights, breakdowns or technical reports linked yet for this matchup. Unreviewed links never influence a pick.</p>
        )}
        {clips.length > 0 && (
          <div className="jp-film-clips">
            <h4 className="jp-h4">Official clips</h4>
            <ClipStrip clips={clips} />
          </div>
        )}
        <div className="jp-film-search">
          {[a, b].map((f) => (
            <div key={f.id}>
              <Portrait f={f} small />
              <strong>{f.name}</strong>
              <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(f.name + " full fight UFC")}`} target="_blank" rel="noopener noreferrer">
                YouTube full fights <ArrowUpRight size={12} aria-hidden="true" />
              </a>
              <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(f.name + " fight breakdown")}`} target="_blank" rel="noopener noreferrer">
                Breakdowns <ArrowUpRight size={12} aria-hidden="true" />
              </a>
              {f.instagram && (
                <a href={f.instagram} target="_blank" rel="noopener noreferrer">
                  Instagram <ArrowUpRight size={12} aria-hidden="true" />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
