import { useState } from "react";
import type { EnginePrediction } from "@/lib/engine";
import { shortName } from "@/lib/engine";
import type { Fighter } from "@/lib/types";

/** What each factor actually measures, in plain words. */
const WHAT: Record<string, string> = {
  opposition: "Results against the quality of opposition: who they beat and who beat them",
  h2h: "What happened when these two met before",
  losses: "Did they lose to good fighters or to weak ones?",
  level: "Wins and experience inside the UFC itself",
  form: "Results in their last few fights",
  style: "UFC strikes, accuracy, defence, takedowns and control (only fights before this card)",
  finish: "Who ends fights early vs who's hard to put away",
  size: "Height and reach advantage",
  distance: "How they do when fights go deep",
  momentum: "Win or loss streak coming in",
  activity: "Time since their last fight (ring rust)",
  age: "Where each fighter is on the age curve",
  scouting: "Lessons from our round-by-round reviews of past fights",
  tape: "UFC round-by-round numbers: who wins the late rounds, and who gets taken down whenever the other side shoots",
};

const GROUPS: { id: string; title: string }[] = [
  { id: "resume", title: "Résumé" },
  { id: "matchup", title: "Style matchup" },
  { id: "readiness", title: "Form & readiness" },
];

const strength = (v: number) => (Math.abs(v) >= 0.45 ? "Big edge" : Math.abs(v) >= 0.18 ? "Clear edge" : "Slight edge");

/** Every factor on one diverging bar: left = fighter A's edge, right = fighter B's. No weights shown. */
export function EdgeMap({ p, a, b }: { p: EnginePrediction; a: Fighter; b: Fighter }) {
  const rows = p.signals.filter((s) => s.id !== "h2h" || s.score !== null);
  const [openId, setOpenId] = useState<string | null>(null);
  const an = shortName(a.name), bn = shortName(b.name);
  const tally = rows.reduce((t, s) => {
    if (s.score === null || Math.abs(s.score) < 0.03) return t;
    s.score > 0 ? t.a++ : t.b++;
    return t;
  }, { a: 0, b: 0 });
  return (
    <section className="jp-card jp-edges" aria-label="Where the edges are">
      <header className="jp-edges-head">
        <h3 className="jp-h3">Where the edges are</h3>
        <p className="jp-edges-sub">
          Each bar leans toward the fighter who has the advantage. <b className="a">{an}</b> leads {tally.a} {tally.a === 1 ? "factor" : "factors"}, <b className="b">{bn}</b> leads {tally.b}.
        </p>
        <div className="jp-edges-legend">
          <span className="a">◀ {an}</span>
          <span className="b">{bn} ▶</span>
        </div>
      </header>
      {GROUPS.map((g) => {
        const list = rows.filter((s) => s.model === g.id);
        if (!list.length) return null;
        return (
          <div className="jp-edge-group" key={g.id}>
            <h4 className="jp-edge-gtitle">{g.title}</h4>
            <div className="jp-edge-rows">
              {list.map((s) => {
                const v = s.score ?? 0;
                const w = Math.max(6, Math.min(100, Math.abs(v) * 100));
                const side = s.score === null ? "none" : Math.abs(v) < 0.03 ? "even" : v > 0 ? "a" : "b";
                const verdict = side === "none" ? "Not enough data" : side === "even" ? "Even" : `${strength(v)} · ${side === "a" ? an : bn}`;
                const isOpen = openId === s.id;
                return (
                  <div className={"jp-edge-item" + (isOpen ? " open" : "")} key={s.id}>
                    <button
                      type="button"
                      className={"jp-edge " + side + (isOpen ? " sel" : "")}
                      aria-expanded={isOpen}
                      onClick={() => setOpenId(isOpen ? null : s.id)}
                    >
                      <div className="jp-edge-bar left">{side === "a" && <i style={{ width: `${w}%` }} />}</div>
                      <span className="jp-edge-label">
                        <strong>{s.label}</strong>
                        <em className={"jp-edge-verdict " + side}>{verdict}</em>
                      </span>
                      <div className="jp-edge-bar right">{side === "b" && <i style={{ width: `${w}%` }} />}</div>
                    </button>
                    {isOpen && (
                      <p className="jp-edge-why">
                        <span className="jp-edge-what">{WHAT[s.id] ?? s.label}.</span>{" "}
                        {s.reason ? <><b>{s.reason.title}.</b> {s.reason.text}</> : s.score === null ? "We don't have enough verified data on both fighters to score this yet." : "Neither fighter has a real advantage here."}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="jp-fine jp-edges-foot">Tap any row to see why. Dashed bar = not enough verified data yet.</p>
    </section>
  );
}
