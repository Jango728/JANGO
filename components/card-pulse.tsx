import { Activity, CalendarClock, Clock3, ShieldAlert, Trophy } from "lucide-react";
import { predict } from "@/lib/engine";
import { predictRounds } from "@/lib/rounds";
import type { Event, Fighter } from "@/lib/types";

export function CardPulse({ event, fighters }: { event: Event; fighters: Record<string, Fighter> }) {
  const rows = event.fights.flatMap((f) => {
    const a = fighters[f.a], b = fighters[f.b];
    if (!a || !b) return [];
    return [{ p: predict(f, a, b, event), r: predictRounds(f, a, b, event), a, b }];
  });
  const strongest = rows.filter((r) => r.p.confidence).sort((x, y) => (y.p.confidence ?? 0) - (x.p.confidence ?? 0))[0];
  const winner = strongest ? (strongest.p.pick === strongest.a.id ? strongest.a : strongest.b) : null;
  const under = rows.filter((r) => r.r?.side === "Under").length;
  const pending = rows.filter((r) => r.p.status === "pending" || r.p.evidenceLabel === "Limited" || r.p.evidenceLabel === "Pending").length;
  // Days until fight night, in Toronto time (the site's home time zone)
  const todayTo = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
  const days = Math.round((Date.parse(event.date) - Date.parse(todayTo)) / 86400000);
  const when = days === 0 ? "Tonight" : days === 1 ? "Tomorrow" : days > 1 ? `In ${days} days` : null;
  return (
    <section className="jp-pulse" aria-label="Card summary">
      <div className="jp-pulse-title">
        <Activity size={16} /> Card pulse
      </div>
      <div>
        <Trophy size={15} />
        <span>Best bet on the model</span>
        <strong>{winner ? `${winner.name} · ${strongest.p.confidence}%` : "Pending"}</strong>
      </div>
      <div>
        <Clock3 size={15} />
        <span>Rounds leans</span>
        <strong>
          {rows.length - under} over · {under} under
        </strong>
      </div>
      <div>
        <ShieldAlert size={15} />
        <span>Thin data</span>
        <strong>
          {pending} of {rows.length}
        </strong>
      </div>
      {when && (
        <div className={days <= 1 ? "soon" : ""}>
          <CalendarClock size={15} />
          <span>Fight night</span>
          <strong>{when}</strong>
        </div>
      )}
    </section>
  );
}
