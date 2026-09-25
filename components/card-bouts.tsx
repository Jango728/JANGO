"use client";
import { useEffect, useState } from "react";
import { Portrait } from "./fight-experience";
import { Flag, UFCRecord } from "./research";
import { recordAtEvent } from "@/lib/model";
import { predict, shortName } from "@/lib/engine";
import { resultFor } from "@/lib/ledger";
import type { Event, Fighter } from "@/lib/types";

export const cardGroup = (section: string) => (/prelim/i.test(section) ? "prelims" : "main");
const price = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function CardBouts({ event, fighters, selected, onSelect }: { event: Event; fighters: Record<string, Fighter>; selected: string; onSelect: (id: string) => void }) {
  const current = event.fights.find((f) => f.id === selected);
  const [group, setGroup] = useState(current ? cardGroup(current.section) : "main");
  useEffect(() => {
    if (current) setGroup(cardGroup(current.section));
  }, [selected, event.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = {
    main: event.fights.filter((f) => cardGroup(f.section) === "main").length,
    prelims: event.fights.filter((f) => cardGroup(f.section) === "prelims").length,
  };
  const bouts = event.fights.filter((f) => cardGroup(f.section) === group);
  function choose(g: "main" | "prelims") {
    setGroup(g);
    const first = event.fights.find((f) => cardGroup(f.section) === g);
    if (first) onSelect(first.id);
  }
  return (
    <aside className="jp-card jp-bouts" aria-label="Fights on this card">
      <div className="jp-seg" role="tablist" aria-label="Card section">
        {(["main", "prelims"] as const).map((g) => (
          <button key={g} role="tab" aria-selected={group === g} className={group === g ? "on" : ""} disabled={!counts[g]} onClick={() => choose(g)}>
            {g === "main" ? "Main card" : "Prelims"} <small>{counts[g]}</small>
          </button>
        ))}
      </div>
      <div className="jp-bout-list">
        {bouts.map((f) => {
          const a = fighters[f.a], b = fighters[f.b];
          const p = predict(f, a, b, event);
          const res = resultFor(event.id, a.name, b.name);
          return (
            <button type="button" key={f.id} className={"jp-bout " + (selected === f.id ? "active" : "")} aria-pressed={selected === f.id} onClick={() => onSelect(f.id)}>
              <div className="jp-bout-names">
                {[a, b].map((x) => {
                  const won = res?.bout.winner && res.bout.winner && (x.name === res.bout.winner || x.name.split(" ").slice(-1)[0] === res.bout.winner.split(" ").slice(-1)[0]);
                  return (
                    <span key={x.id} className={res ? (won ? "won" : "lost") : ""}>
                      <Portrait f={x} small />
                      <b>
                        <Flag country={x.country} /> {x.name}
                      </b>
                      <small>
                        {recordAtEvent(x, event.date, f.rules)} <UFCRecord f={x} date={event.date} />
                      </small>
                    </span>
                  );
                })}
              </div>
              <div className="jp-bout-meta">
                <span>
                  {f.division} · {f.rounds} rds{/title/i.test(f.notes.join(" ")) ? " · Title" : ""}
                </span>
                {res ? (
                  <span className={"jp-result-chip " + (res.winner === null ? "" : res.winner ? "hit" : "miss")}>
                    {res.bout.winner?.split(" ").slice(-1)[0]} · {res.bout.method} R{res.bout.round}
                  </span>
                ) : p.pick ? (
                  <span className="jp-pick-chip">
                    {shortName(fighters[p.pick].name)} · {p.confidence}%
                  </span>
                ) : (
                  <span className="jp-pick-chip pending">N/A · pending</span>
                )}
                <span className="jp-odds" title="Display-only odds — never used by the model">
                  {f.odds ? `${price(f.odds.a)} / ${price(f.odds.b)}` : ""}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
