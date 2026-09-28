/**
 * Roster fighter → engine Fighter, shared by the backtests (scripts/backtest-data.ts), the Matchmaker
 * (lib/matchmaker.ts) and fighter profiles (merge of seed + roster rows).
 *
 * public/roster/roster.json has UFC bouts only (UFCStats). A fighter rebuilt from it gets:
 *  - a UFC-only history where each opponent's record is that opponent's UFC record strictly before the bout
 *    ("reconstructed"), exactly what the historical backtest validated the engine on;
 *  - per-bout stat rows (lib/fight-stats.ts StatRow) so statsAsOf() works for any date;
 *  - round-by-round summary rows (lib/round-features.ts) when public/roster/rounds.json is available.
 * Nothing here filters by date: the engine only reads bouts strictly before the event date.
 *
 * Type-only imports from lib/roster.ts keep this module free of React so Node scripts can use it.
 */
import type { PastFight } from "./types";
import type { StatRow, WithTimeline } from "./fight-stats";
import { roundRowsFromRoster, type RoundsDoc, type WithRounds } from "./round-features";
import type { RosterBout, RosterFighter } from "./roster";

type HistoryOnly = { history: Pick<RosterBout, "date" | "result">[] };
/** The minimum a roster row needs for conversion (the backtest reads roster.json directly). */
export type RosterLike = Pick<RosterFighter, "slug" | "name" | "dob" | "heightIn" | "reachIn" | "stance" | "weightClass"> & { history: RosterBout[] };

const DAY = 86400000;
/** Minutes elapsed from the official round + clock (undefined when the clock is missing). */
export const clockMinutes = (round?: number, time?: string) => {
  const [m, s] = (time ?? "").split(":").map(Number);
  return round && Number.isFinite(m) ? (round - 1) * 5 + m + (s || 0) / 60 : undefined;
};
/** Inches → centimetres, one decimal (the seed stores heights and reaches in cm; see docs/SCHEMA.md). */
export const inToCm = (v: number | null | undefined) => (v ? Math.round(v * 2.54 * 10) / 10 : undefined);
/** Whole years between a birth date and a date. */
export const ageOn = (dob: string | null | undefined, date: string) => (dob ? Math.floor((Date.parse(date) - Date.parse(dob)) / (365.25 * DAY)) : undefined);

/** An opponent's UFC record strictly before `date` (NC excluded), plus how many UFC bouts that is. */
export function ufcRecordBefore(bySlug: Map<string, HistoryOnly>, slug: string | null | undefined, date: string) {
  const r = slug ? bySlug.get(slug) : undefined;
  if (!r) return { rec: undefined as string | undefined, n: undefined as number | undefined };
  const rows = r.history.filter((h) => h.date < date && h.result !== "NC");
  const n = (x: string) => rows.filter((h) => h.result === x).length;
  return { rec: `${n("W")}-${n("L")}-${n("D")}`, n: rows.length };
}

/** One roster bout as an engine history row (opponent record reconstructed from the roster). */
export function rosterPastFight(h: RosterBout, bySlug: Map<string, HistoryOnly>): PastFight & { opponentSlug?: string | null; title?: boolean } {
  const o = ufcRecordBefore(bySlug, h.opponentSlug, h.date);
  return {
    opponent: h.opponent, date: h.date, result: h.result, promotion: "UFC", method: h.method, round: h.round, time: h.time,
    minutes: clockMinutes(h.round, h.time), rules: "MMA", division: h.weightClass, eventName: h.event,
    opponentRecord: o.rec, opponentRecordBasis: "reconstructed", opponentPromotionBouts: o.n, source: "roster",
    opponentSlug: h.opponentSlug, title: !!h.title,
  };
}

/** Per-bout UFCStats totals in lib/fight-stats.ts StatRow layout (bouts with a stat line only). */
export function rosterStatRows(history: RosterBout[]): StatRow[] {
  return history
    .filter((h) => h.s && h.s.sec > 0)
    .map((h) => {
      const s = h.s!;
      return [h.date, s.sec, s.sl, s.osl, s.tdl, s.tda, s.otdl, s.otda, s.kd, s.okd, s.ctrl, s.octrl, s.sub, s.sa, s.osa];
    });
}

/**
 * Engine-ready profile for a roster fighter: UFC-only history, stat timeline and round timeline.
 * `ageDate` sets the listed `age` (production semantics: the age on the data date; the engine prefers birthDate).
 */
export function rosterProfile(r: RosterLike, bySlug: Map<string, HistoryOnly>, rounds: RoundsDoc | null, ageDate: string): WithTimeline & WithRounds {
  return {
    id: r.slug, name: r.name, history: r.history.map((h) => rosterPastFight(h, bySlug)), sources: [], historyComplete: false, ufcHistoryComplete: true,
    height: inToCm(r.heightIn), reach: inToCm(r.reachIn),
    stance: r.stance ?? undefined, birthDate: r.dob ?? undefined,
    age: ageOn(r.dob, ageDate), ufcTimeline: rosterStatRows(r.history),
    roundTimeline: rounds ? roundRowsFromRoster(r.slug, r.history as Parameters<typeof roundRowsFromRoster>[1], rounds) : undefined,
  };
}

// ---------- merging a seed profile with roster bouts it's missing ----------

/** A history row with the roster's extras when we know them. `opponentSlug: null` = opponent not in the roster. */
export type MergedRow = PastFight & { opponentSlug?: string | null; title?: boolean };
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 2 * DAY;
const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
const tok = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, " ").replace(/[^a-z0-9\s-]/g, "").split(/[\s-]+/).filter(Boolean).sort().join(" ");
const sameName = (a: string, b: string) => {
  if (!a || !b) return false;
  if (norm(a) === norm(b) || tok(a) === tok(b)) return true;
  const ta = tok(a).split(" "), tb = tok(b).split(" ");
  return ta.filter((t) => t.length > 2 && tb.includes(t)).length >= Math.min(2, Math.min(ta.length, tb.length));
};

/** A roster bout as a display row (profiles): UFCStats minutes, no reconstructed opponent record. */
export function rosterDisplayRow(b: RosterBout): MergedRow {
  return {
    opponent: b.opponent, date: b.date, result: b.result, promotion: "UFC", method: b.method, round: b.round, time: b.time,
    minutes: b.s?.sec ? b.s.sec / 60 : clockMinutes(b.round, b.time), rules: "MMA", division: b.weightClass, eventName: b.event,
    source: "UFCStats", opponentSlug: b.opponentSlug, title: !!b.title,
  };
}

/**
 * Seed rows + roster UFC bouts the seed is missing (dedupe: same date ±2 days and the same opponent or result),
 * newest first. Matched seed rows gain the roster's opponent link and title flag. `toRow` converts the extra bouts.
 */
export function mergeRosterRows(seedRows: PastFight[], ros: RosterBout[] | undefined, toRow: (b: RosterBout) => MergedRow = rosterDisplayRow): MergedRow[] {
  if (!ros?.length) return seedRows;
  const used = new Set<RosterBout>();
  const out: MergedRow[] = seedRows.map((h) => {
    const m = ros.find((r) => !used.has(r) && near(r.date, h.date) && (sameName(r.opponent, h.opponent) || r.result === h.result));
    if (!m) return h;
    used.add(m);
    return { ...h, opponentSlug: m.opponentSlug, title: !!m.title };
  });
  for (const r of ros) if (!used.has(r)) out.push(toRow(r));
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
