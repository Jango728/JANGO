/**
 * Pure helpers behind the Breakdown infographic (Matchmaker and every Fight center bout):
 * divisions, as-of-date stat lines, skill percentiles, common opponents and recent form.
 * No fighter directory, rankings or seed data here, so the Fight center's Breakdown chunk stays small.
 * Every helper reads only bouts strictly before the date it's given (the event date), so a finished
 * bout's breakdown never sees the fight itself or anything after it.
 */
import { timelineFor, type StatRow } from "./fight-stats";
import { normName, type Roster, type RosterFighter } from "./roster-load";
import type { Fighter, PastFight } from "./types";

export const fmtLongDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// ---------- divisions ----------

export type MMDivision = { name: string; short: string; code: string; limit: number; women: boolean };
export const MM_DIVISIONS: MMDivision[] = [
  { name: "Flyweight", short: "FLY", code: "fly", limit: 125, women: false },
  { name: "Bantamweight", short: "BW", code: "bw", limit: 135, women: false },
  { name: "Featherweight", short: "FW", code: "fw", limit: 145, women: false },
  { name: "Lightweight", short: "LW", code: "lw", limit: 155, women: false },
  { name: "Welterweight", short: "WW", code: "ww", limit: 170, women: false },
  { name: "Middleweight", short: "MW", code: "mw", limit: 185, women: false },
  { name: "Light Heavyweight", short: "LHW", code: "lhw", limit: 205, women: false },
  { name: "Heavyweight", short: "HW", code: "hw", limit: 265, women: false },
  { name: "Women's Strawweight", short: "W115", code: "wsw", limit: 115, women: true },
  { name: "Women's Flyweight", short: "W125", code: "wfw", limit: 125, women: true },
  { name: "Women's Bantamweight", short: "W135", code: "wbw", limit: 135, women: true },
  { name: "Women's Featherweight", short: "W145", code: "wfe", limit: 145, women: true },
];
export const divisionByName = (n?: string | null) => (n ? MM_DIVISIONS.find((d) => d.name.toLowerCase() === n.toLowerCase().trim()) : undefined);
export const divisionByCode = (c?: string | null) => (c ? MM_DIVISIONS.find((d) => d.code === c) : undefined);

// ---------- analysis helpers (infographics) ----------

export type DisplayStats = {
  fights: number;
  minutes: number;
  slpm: number;
  sapm: number;
  strAcc: number | null;
  strDef: number | null;
  kdPer15: number;
  tdPer15: number;
  tdAcc: number | null;
  tdDef: number | null;
  subPer15: number;
  ctrlPer15: number;
  source: "timeline" | "official";
};

/** Raw UFC rates from bouts strictly before `date` (UFCStats formulas, no shrinkage — what a stat sheet shows). */
export function displayStats(f: Fighter, date: string): DisplayStats | null {
  const rows: StatRow[] = (timelineFor(f) ?? []).filter((r) => r[0] < date && r[1] > 0);
  if (rows.length) {
    let sec = 0, sl = 0, osl = 0, tdl = 0, tda = 0, otdl = 0, otda = 0, kd = 0, ctrl = 0, sub = 0, sa = 0, osa = 0, slA = 0, oslA = 0, att = 0;
    for (const r of rows) {
      sec += r[1]; sl += r[2]; osl += r[3]; tdl += r[4]; tda += r[5]; otdl += r[6]; otda += r[7]; kd += r[8]; ctrl += r[10]; sub += r[12];
      if (r[13] !== undefined && r[14] !== undefined) { sa += r[13]; osa += r[14]; slA += r[2]; oslA += r[3]; att++; }
    }
    const min = sec / 60;
    return {
      fights: rows.length, minutes: min, slpm: sl / min, sapm: osl / min,
      strAcc: att && sa ? slA / sa : null, strDef: att && osa ? 1 - oslA / osa : null,
      kdPer15: (kd / min) * 15, tdPer15: (tdl / min) * 15, tdAcc: tda ? tdl / tda : null, tdDef: otda ? 1 - otdl / otda : null,
      subPer15: (sub / min) * 15, ctrlPer15: ctrl / 60 / (min / 15), source: "timeline",
    };
  }
  const s = f.stats;
  if (s && s.asOf < date && s.slpm !== undefined && s.sapm !== undefined)
    return {
      fights: 0, minutes: 0, slpm: s.slpm, sapm: s.sapm, strAcc: s.strikeAccuracy !== undefined ? s.strikeAccuracy / 100 : null, strDef: s.strikeDefense !== undefined ? s.strikeDefense / 100 : null,
      kdPer15: s.kdPer15 ?? 0, tdPer15: s.tdPer15 ?? 0, tdAcc: s.tdAccuracy !== undefined ? s.tdAccuracy / 100 : null, tdDef: s.tdDefense !== undefined ? s.tdDefense / 100 : null,
      subPer15: s.subPer15 ?? 0, ctrlPer15: s.controlPer15 ?? 0, source: "official",
    };
  return null;
}

export type RadarAxis = { key: string; label: string; get: (s: DisplayStats) => number | null; pool: (r: RosterFighter) => number | null; lower?: boolean };
export const RADAR_AXES: RadarAxis[] = [
  { key: "vol", label: "Volume", get: (s) => s.slpm, pool: (r) => r.stats.slpm },
  { key: "def", label: "Defence", get: (s) => (s.strDef === null ? null : s.strDef * 100), pool: (r) => r.stats.strDef },
  { key: "pow", label: "Power", get: (s) => s.kdPer15, pool: (r) => r.stats.kdPer15 },
  { key: "wre", label: "Wrestling", get: (s) => s.tdPer15, pool: (r) => r.stats.tdPer15 },
  { key: "tdd", label: "TD defence", get: (s) => (s.tdDef === null ? null : s.tdDef * 100), pool: (r) => r.stats.tdDef },
  { key: "sub", label: "Submissions", get: (s) => s.subPer15, pool: (r) => r.stats.subPer15 },
];
const poolCache = new Map<string, number[][]>();
/** Percentile (0–100) of each radar axis vs every roster fighter with 25+ UFC minutes. */
export function radarPercentiles(s: DisplayStats | null, roster: Roster): (number | null)[] {
  let pools = poolCache.get(roster.asOf);
  if (!pools) {
    const fs = [...roster.bySlug.values()].filter((r) => r.stats.minutes >= 25);
    pools = RADAR_AXES.map((ax) => fs.map(ax.pool).filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b));
    poolCache.set(roster.asOf, pools);
  }
  return RADAR_AXES.map((ax, i) => {
    const v = s ? ax.get(s) : null;
    const p = pools![i];
    if (v === null || !Number.isFinite(v) || !p.length) return null;
    let lo = 0, hi = p.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (p[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    let eq = lo;
    while (eq < p.length && p[eq] === v) eq++;
    return Math.round(((lo + eq) / 2 / p.length) * 100);
  });
}

const key = (n: string) => normName(n);
export type SharedOpponent = { name: string; slug?: string | null; a: PastFight[]; b: PastFight[] };
/** Opponents both fighters have faced (MMA, before `date`), most recent first; and their previous meetings. */
export function commonOpponents(a: Fighter, b: Fighter, date: string) {
  const rows = (f: Fighter) => f.history.filter((h) => h.date < date && (h.rules ?? "MMA") === "MMA");
  const ra = rows(a), rb = rows(b);
  const meetings = ra.filter((h) => key(h.opponent) === key(b.name));
  const byA = new Map<string, PastFight[]>();
  for (const h of ra) if (key(h.opponent) !== key(b.name)) byA.set(key(h.opponent), [...(byA.get(key(h.opponent)) ?? []), h]);
  const shared: SharedOpponent[] = [];
  const done = new Set<string>();
  for (const h of rb) {
    const k = key(h.opponent);
    if (done.has(k) || k === key(a.name) || !byA.has(k)) continue;
    done.add(k);
    const aRows = byA.get(k)!, bRows = rb.filter((x) => key(x.opponent) === k);
    const slug = ([...aRows, ...bRows] as (PastFight & { opponentSlug?: string | null })[]).find((x) => x.opponentSlug !== undefined)?.opponentSlug;
    shared.push({ name: h.opponent, slug, a: aRows, b: bRows });
  }
  shared.sort((x, y) => Math.max(...[...y.a, ...y.b].map((r) => Date.parse(r.date))) - Math.max(...[...x.a, ...x.b].map((r) => Date.parse(r.date))));
  return { shared, meetings };
}

/** Last n MMA results before the date, newest first. */
export const recentRows = (f: Fighter, date: string, n = 8) =>
  f.history.filter((h) => h.date < date && (h.rules ?? "MMA") === "MMA").sort((x, y) => y.date.localeCompare(x.date)).slice(0, n);

export const methodLetter = (m: string, result: string) =>
  result === "NC" || /overturned|no contest/i.test(m) ? "NC" : /\b(t?ko)\b/i.test(m) ? "KO" : /submission|\bsub\b/i.test(m) ? "SUB" : /decision|\b(ud|sd|md)\b/i.test(m) ? "DEC" : /\bdq\b|disqual/i.test(m) ? "DQ" : "—";
