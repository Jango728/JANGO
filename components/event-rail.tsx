"use client";
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PromotionLogo } from "./promotion-logo";
import { ledgerFor } from "@/lib/ledger";
import type { Event } from "@/lib/types";

const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
export const shortTitle = (t: string) => t.replace(/^Dana White's Contender Series:\s*/i, "DWCS ").replace(/^UFC Fight Night:\s*/i, "Fight Night · ");

export function status(e: Event, today: string) {
  if (e.date > today) return e.fights.length ? "Upcoming" : "Card TBA";
  if (e.date === today) return "Fight day";
  return ledgerFor(e.id)?.results ? "Results in" : "Awaiting results";
}

export function EventRail({ events, selected, today, onSelect }: { events: Event[]; selected: string; today: string; onSelect: (e: Event) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = rail.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selected)}"]`);
    node?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selected]);
  const nudge = (dir: number) => rail.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  return (
    <div className="jp-rail-wrap">
      <button className="jp-rail-arrow" aria-label="Earlier cards" onClick={() => nudge(-1)}>
        <ChevronLeft size={18} />
      </button>
      <div className="jp-rail" ref={rail} role="listbox" aria-label="Fight cards">
        {events.map((e) => {
          const s = status(e, today);
          const main = e.fights[0];
          return (
            <button key={e.id} data-id={e.id} role="option" aria-selected={e.id === selected} className={"jp-event " + (e.id === selected ? "on" : "")} onClick={() => onSelect(e)}>
              <span className="jp-event-top">
                <PromotionLogo promotion={e.promotion} />
                <span className={"jp-status s-" + s.toLowerCase().replace(/\s+/g, "-")}>{s}</span>
              </span>
              <strong>{shortTitle(e.title)}</strong>
              <span className="jp-event-sub">
                {fmt(e.date)} · {e.fights.length ? `${e.fights.length} bouts` : "lineup pending"}
                {main && main.rounds === 5 ? " · 5-rd main" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <button className="jp-rail-arrow" aria-label="Later cards" onClick={() => nudge(1)}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
