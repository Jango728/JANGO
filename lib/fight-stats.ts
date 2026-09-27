/**
 * UFC striking / grappling numbers computed AS OF a date, from per-fight stat lines
 * (UFCStats via public/roster/roster.json). Only bouts strictly before the event count,
 * so a backtest never sees the future.
 *
 * lib/stats-timeline.json carries one compact row per UFC bout for every seed fighter
 * (built by scripts/build-stats-timeline.ts). Rows: [date, sec, sl, osl, tdl, tda, otdl, otda, kd, okd, ctrl, octrl, sub, sa, osa].
 */
import timeline from "./stats-timeline.json";
import type { Fighter } from "./types";

/** [date, seconds, sigLanded, sigAbsorbed, tdLanded, tdAttempted, oppTdLanded, oppTdAttempted, kd, kdAgainst, ctrlSec, oppCtrlSec, subAttempts, sigAttempted?, oppSigAttempted?] */
export type StatRow = [string, number, number, number, number, number, number, number, number, number, number, number, number, number?, number?];

type Timeline = { asOf: string; source: string; fighters: Record<string, { dob?: string; rows: StatRow[] }> };
const TL = timeline as unknown as Timeline;
export const STATS_TIMELINE_AS_OF = TL.asOf;

/** A fighter object may carry its own rows (backtests, roster profiles); otherwise the bundled timeline is used. */
export type WithTimeline = Fighter & { ufcTimeline?: StatRow[] };
export const timelineFor = (f: Fighter): StatRow[] | null => (f as WithTimeline).ufcTimeline ?? TL.fighters[f.id]?.rows ?? null;
export const timelineDob = (f: Fighter): string | undefined => TL.fighters[f.id]?.dob;

/**
 * League-wide per-minute averages (UFC 2021–2026) used to shrink small samples:
 * a fighter with 8 UFC minutes is mostly the league average, one with 60+ minutes is mostly himself.
 */
export const LEAGUE = { slpm: 3.9, tdPer15: 1.25, tdDef: 0.64, kdPer15: 0.26, ctrlShare: 0.18, subPer15: 0.45, strAcc: 0.45, strDef: 0.55 };
const PRIOR_MIN = 15; // minutes of league-average "ghost" fight time added to every sample
const PRIOR_TDA = 6; // takedown attempts of league-average defence added to every sample
const PRIOR_SA = 60; // significant-strike attempts of league-average accuracy/defence added to every sample

export type AsOfStats = {
  fights: number;
  minutes: number;
  slpm: number;
  sapm: number;
  tdPer15: number;
  tdDef: number;
  kdPer15: number;
  kdAgainstPer15: number;
  /** Share of fight time spent in control of the opponent minus share spent being controlled (−1…1). */
  ctrlEdge: number;
  subPer15: number;
  /** Significant-strike accuracy (landed / attempted), shrunk; null when attempts aren't in the timeline. */
  strAcc: number | null;
  /** Significant-strike defence (1 − opponent landed / attempted), shrunk; null when unavailable. */
  strDef: number | null;
};

/** Shrunk UFC rates from bouts strictly before `date`, or null when there are none. */
export function statsAsOf(f: Fighter, date: string): AsOfStats | null {
  const rows = timelineFor(f);
  if (!rows) return null;
  let n = 0, sec = 0, sl = 0, osl = 0, tdl = 0, otdl = 0, otda = 0, kd = 0, okd = 0, ctrl = 0, octrl = 0, sub = 0;
  let sa = 0, osa = 0, slA = 0, oslA = 0, withAtt = 0;
  for (const r of rows) {
    if (!(r[0] < date) || !(r[1] > 0)) continue;
    n++;
    sec += r[1]; sl += r[2]; osl += r[3]; tdl += r[4]; otdl += r[6]; otda += r[7]; kd += r[8]; okd += r[9]; ctrl += r[10]; octrl += r[11]; sub += r[12];
    if (r[13] !== undefined && r[14] !== undefined) { sa += r[13]; osa += r[14]; slA += r[2]; oslA += r[3]; withAtt++; }
  }
  if (!n) return null;
  const min = sec / 60, m = min + PRIOR_MIN;
  return {
    fights: n,
    minutes: Math.round(min * 10) / 10,
    slpm: (sl + LEAGUE.slpm * PRIOR_MIN) / m,
    sapm: (osl + LEAGUE.slpm * PRIOR_MIN) / m,
    tdPer15: ((tdl + (LEAGUE.tdPer15 / 15) * PRIOR_MIN) / m) * 15,
    tdDef: (otda - otdl + LEAGUE.tdDef * PRIOR_TDA) / (otda + PRIOR_TDA),
    kdPer15: ((kd + (LEAGUE.kdPer15 / 15) * PRIOR_MIN) / m) * 15,
    kdAgainstPer15: ((okd + (LEAGUE.kdPer15 / 15) * PRIOR_MIN) / m) * 15,
    ctrlEdge: (ctrl - octrl) / 60 / m,
    subPer15: ((sub + (LEAGUE.subPer15 / 15) * PRIOR_MIN) / m) * 15,
    strAcc: withAtt ? (slA + LEAGUE.strAcc * PRIOR_SA) / (sa + PRIOR_SA) : null,
    strDef: withAtt ? 1 - (oslA + (1 - LEAGUE.strDef) * PRIOR_SA) / (osa + PRIOR_SA) : null,
  };
}
