/**
 * Machine-generated scouting tags from UFCStats round-by-round numbers (source "ufcstats-rounds").
 *
 * These are SUGGESTIONS, kept apart from the human scouting notes in data/scouting.json (which come from
 * reading round-by-round reports). Computed as of a date from bouts strictly before it, so they can be
 * backtested. data/scouting-auto.json is the current snapshot for seed fighters (scripts/build-stats-timeline.ts).
 *
 * Engine use: none. The backtest (scripts/backtest-rounds.ts, engine v1.3 study) found that feeding these
 * tags into the film-study signal — even only where no human note covers the trait — did not improve
 * out-of-sample results, so the engine uses the underlying round numbers directly (the "tape" signal and
 * the rounds 1.3 terms) and the tags are shown as labelled, machine-generated hints only.
 */
import type { Fighter } from "./types";
import type { ScoutTag } from "./scouting";
import { roundFormAsOf, type RoundForm } from "./round-features";

export type AutoTag = Extract<ScoutTag, "cardio-fade" | "chin-concern" | "td-vulnerable" | "durable" | "power">;
export type AutoNote = { tag: AutoTag; kind: "strength" | "weakness"; note: string; source: "ufcstats-rounds" };

/** Which human-note tags already cover the same trait (a human note always wins). */
export const AUTO_TRAIT: Record<AutoTag, ScoutTag[]> = {
  "cardio-fade": ["cardio-fade", "five-round-proven"],
  "chin-concern": ["chin-concern", "durable"],
  durable: ["chin-concern", "durable"],
  "td-vulnerable": ["td-vulnerable"],
  power: ["power"],
};

/**
 * Thresholds sit near the top/bottom 10% of active UFC fighters and need a minimum of evidence:
 *  cardio-fade   ≥ 3 bouts reaching round 3; late-round output ≤ 78% of round 1 (shrunk)
 *  chin-concern  ≥ 3 knockdowns suffered at ≥ 0.55 per 15 min, or 2+ knockdowns suffered in the last 3 bouts
 *  durable       ≥ 75 UFC minutes, never knocked down or stopped by strikes; or survived 2+ knockdowns and never KO'd
 *  td-vulnerable ≥ 6 takedowns absorbed; opponents complete ≥ 50% of attempts (shrunk)
 *  power         ≥ 4 knockdowns scored at ≥ 0.8 per 15 min
 */
export function autoNotesFrom(f: Fighter, r: RoundForm): AutoNote[] {
  const out: AutoNote[] = [];
  const n = (tag: AutoTag, kind: AutoNote["kind"], note: string) => out.push({ tag, kind, note, source: "ufcstats-rounds" });
  const x = r.raw;
  if (x.fadeBouts >= 3 && r.fade <= 0.78)
    n("cardio-fade", "weakness", `Output drops late: in UFC fights reaching round 3, ${f.name} throws about ${Math.round(r.fade * 100)}% as many significant strikes per minute from round 3 on as in round 1.`);
  if ((x.okd >= 3 && r.droppedPer15 >= 0.55) || r.recentDropped >= 2)
    n("chin-concern", "weakness", r.recentDropped >= 2 ? `Knocked down ${r.recentDropped} times in the last 3 UFC fights.` : `Knocked down ${x.okd} times in ${Math.round(x.minutes)} UFC minutes (${r.droppedPer15.toFixed(2)} per 15 min).`);
  else if ((x.minutes >= 75 && x.okd === 0 && x.koLosses === 0) || (x.dropped >= 2 && x.koLosses === 0))
    n("durable", "strength", x.okd === 0 ? `Never knocked down in ${Math.round(x.minutes)} UFC minutes.` : `Dropped in ${x.dropped} UFC rounds and survived every time; never stopped by strikes in the UFC.`);
  if (x.tdAgainst >= 6 && r.tdAtWill >= 0.5)
    n("td-vulnerable", "weakness", `Opponents complete ${Math.round((x.tdAgainst / Math.max(1, x.tdaAgainst)) * 100)}% of their takedown attempts (${x.tdAgainst} of ${x.tdaAgainst}), then keep control for about ${Math.round(r.ctrlPerTd)} s per takedown.`);
  if (x.kd >= 4 && r.kdPer15 >= 0.8)
    n("power", "strength", `${x.kd} knockdowns scored in ${Math.round(x.minutes)} UFC minutes (${r.kdPer15.toFixed(2)} per 15 min).`);
  return out;
}

/** Auto notes for a fighter from UFC bouts strictly before `date` (none without round data). */
export function autoScoutNotes(f: Fighter, date: string): AutoNote[] {
  const r = roundFormAsOf(f, date);
  return r && r.bouts >= 2 ? autoNotesFrom(f, r) : [];
}
