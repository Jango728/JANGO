/**
 * How fights actually go — round-level features from UFCStats round-by-round numbers.
 *
 * Nobody here watches the tape, so the round-by-round stat lines stand in for it: did he
 * slow down after round 1, did he get dropped and come back, was he taken down whenever the
 * other man wanted, does he win rounds or just survive them. Every number is computed from
 * bouts strictly BEFORE the event date (backtests never see the future).
 *
 * Source: public/roster/rounds.json (scripts/build-roster.py) → one summary row per UFC bout
 * per fighter. lib/round-timeline.json carries those rows for seed fighters only
 * (scripts/build-stats-timeline.ts); backtests attach rows to roster fighters directly.
 */
import timeline from "./round-timeline.json";
import type { Fighter } from "./types";

/** Per-round stat line layout in public/roster/rounds.json. */
export const RL = { kd: 0, sigL: 1, sigA: 2, headL: 3, groundL: 4, totL: 5, tdL: 6, tdA: 7, sub: 8, rev: 9, ctrl: 10 } as const;
export type RoundLine = number[];

/**
 * One bout, one fighter. [date, ...numbers] in ROW order.
 *  sec       fight seconds          rounds  scored rounds (final round counts only if ≥ 60 s)
 *  r1A/r1L   own sig strikes attempted / landed in round 1 (per-minute rates use r1Sec)
 *  lateA/L   own sig strikes attempted / landed in rounds 3+ (lateSec seconds)
 *  oR1A/oLateA  opponent's attempts in round 1 / rounds 3+
 *  oLateL    sig strikes absorbed in rounds 3+
 *  okd/kd    knockdowns suffered / scored   okdR1/kdR1 in round 1
 *  dropped   rounds in which he was knocked down; droppedOk = of those, rounds he survived (wasn't stopped in)
 *  oHead     head strikes absorbed
 *  won/lost/close  scored rounds won / lost / within a whisker (strikes, knockdowns, takedowns, control)
 *  oTdR1/oTdaR1, oTdLate/oTdaLate  takedowns absorbed / attempted against him, round 1 vs later
 *  rev       reversals            oCtrl  seconds controlled by the opponent     subR1  sub attempts in round 1
 *  r45Sec/r45L/r45OL  seconds, own sig landed, sig absorbed in rounds 4–5
 *  finDrop   1 = dropped the opponent and finished him, 0 = dropped him but didn't finish, −1 = never dropped him
 *  koLoss    1 = he lost this bout by KO/TKO
 */
export const ROW = [
  "sec", "rounds", "r1Sec", "r1A", "r1L", "lateSec", "lateA", "lateL", "oR1A", "oLateA", "oLateL",
  "kd", "okd", "kdR1", "okdR1", "dropped", "droppedOk", "oHead", "won", "lost", "close",
  "oTdR1", "oTdaR1", "oTdLate", "oTdaLate", "rev", "oCtrl", "subR1", "r45Sec", "r45L", "r45OL", "finDrop", "koLoss",
] as const;
export type RowField = (typeof ROW)[number];
export type RoundRow = [string, ...number[]];
const I = Object.fromEntries(ROW.map((k, i) => [k, i + 1])) as Record<RowField, number>;

/** Round "edge" used as a stand-in for a judge's card: strikes, knockdowns, takedowns, control. */
export function roundEdge(me: RoundLine, op: RoundLine) {
  return (me[RL.sigL] - op[RL.sigL]) + 8 * (me[RL.kd] - op[RL.kd]) + 3 * (me[RL.tdL] - op[RL.tdL]) + (me[RL.ctrl] - op[RL.ctrl]) / 30;
}

/**
 * Summarise one bout for one fighter. `round`/`time` are the official finish round and clock;
 * `finished` = he won inside the distance (KO/TKO or submission).
 */
export function summarizeBout(date: string, me: RoundLine[], op: RoundLine[], round: number, time: string, finished: boolean, stopped: boolean, koLoss = false, roundSec = 300): RoundRow {
  const [m, s] = time.split(":").map(Number);
  const lastSec = Math.max(0, Math.min(roundSec, (m || 0) * 60 + (s || 0)));
  const n = Math.min(me.length, op.length, round || me.length);
  const secOf = (i: number) => (i === n - 1 ? lastSec || roundSec : roundSec);
  const v: Record<RowField, number> = Object.fromEntries(ROW.map((k) => [k, 0])) as Record<RowField, number>;
  for (let i = 0; i < n; i++) {
    const a = me[i], b = op[i], sec = secOf(i);
    v.sec += sec;
    if (i === 0) { v.r1Sec = sec; v.r1A = a[RL.sigA]; v.r1L = a[RL.sigL]; v.oR1A = b[RL.sigA]; v.kdR1 = a[RL.kd]; v.okdR1 = b[RL.kd]; v.oTdR1 = b[RL.tdL]; v.oTdaR1 = b[RL.tdA]; v.subR1 = a[RL.sub]; }
    else { v.oTdLate += b[RL.tdL]; v.oTdaLate += b[RL.tdA]; }
    if (i >= 2) { v.lateSec += sec; v.lateA += a[RL.sigA]; v.lateL += a[RL.sigL]; v.oLateA += b[RL.sigA]; v.oLateL += b[RL.sigL]; }
    if (i >= 3) { v.r45Sec += sec; v.r45L += a[RL.sigL]; v.r45OL += b[RL.sigL]; }
    v.kd += a[RL.kd]; v.okd += b[RL.kd]; v.oHead += b[RL.headL]; v.rev += a[RL.rev]; v.oCtrl += b[RL.ctrl];
    const edge = roundEdge(a, b);
    const scored = i < n - 1 || sec >= 60;
    if (scored) {
      v.rounds++;
      if (Math.abs(edge) <= 3) v.close++;
      if (edge > 0) v.won++;
      else if (edge < 0) v.lost++;
    }
    if (b[RL.kd] > 0) {
      v.dropped++;
      // Recovered: he wasn't stopped in the round he was dropped in.
      if (i < n - 1 || !stopped) v.droppedOk++;
    }
  }
  v.finDrop = v.kd > 0 ? (finished ? 1 : 0) : -1;
  v.koLoss = koLoss ? 1 : 0;
  return [date, ...ROW.map((k) => v[k])];
}

/**
 * Fields the engine, the rounds model and auto-scouting read. lib/round-timeline.json stores only these
 * (in this order) to keep the bundle small; rows are expanded to full ROW order on load, other fields = 0.
 */
export const SHIPPED_FIELDS: RowField[] = [
  "sec", "r1Sec", "r1A", "lateSec", "lateA", "lateL", "oLateL", "kd", "okd", "kdR1", "okdR1", "dropped", "droppedOk",
  "oTdR1", "oTdaR1", "oTdLate", "oTdaLate", "oCtrl", "subR1", "koLoss",
];
type Timeline = { asOf: string; source: string; fields?: string[]; fighters: Record<string, RoundRow[]> };
const RAW = timeline as unknown as Timeline;
const expand = (fields: string[], row: RoundRow): RoundRow => {
  const out: RoundRow = [row[0], ...ROW.map(() => 0)];
  fields.forEach((k, j) => { if (k in I) out[I[k as RowField]] = row[j + 1] as number; });
  return out;
};
const TL: Timeline = {
  ...RAW,
  fighters: Object.fromEntries(Object.entries(RAW.fighters).map(([id, rows]) => [id, rows.map((r) => expand(RAW.fields ?? [...ROW], r))])),
};
export const ROUND_TIMELINE_AS_OF = TL.asOf;
/** Compact a full row to SHIPPED_FIELDS order (build script). */
export const compactRow = (r: RoundRow): RoundRow => [r[0], ...SHIPPED_FIELDS.map((k) => r[I[k]] as number)];
export type WithRounds = Fighter & { roundTimeline?: RoundRow[] };
export const roundRowsFor = (f: Fighter): RoundRow[] | null => (f as WithRounds).roundTimeline ?? TL.fighters[f.id] ?? null;

/**
 * League priors (UFC 2021–2024 bouts, all fighters) used to shrink small samples toward average.
 * Every rate below is "fighter numbers + a ghost sample of league-average numbers".
 */
export const ROUND_LEAGUE = {
  fade: 1.0, // late-round attempts per minute ÷ round-1 attempts per minute (UFC median ≈ 1.0)
  oGrow: 1.0, // same, for the opponents he faced
  kdPer15: 0.26,
  headPerMin: 2.6,
  lateAbsPerMin: 3.5,
  roundWin: 0.5,
  close: 0.3,
  tdAtWill: 0.36, // opponent takedown accuracy against him
  ctrlPerTd: 75, // seconds he spends controlled per takedown absorbed
  recover: 0.6, // rounds he was dropped in and survived
  finDrop: 0.55, // finished the opponent after dropping him
  kdPerLanded: 0.012,
};

export type RoundForm = {
  bouts: number;
  rounds: number;
  /** Cardio: late-round output relative to round 1 (1 = holds pace; < 1 fades). Shrunk. */
  fade: number;
  /** How much his opponents' output grew late relative to round 1 (> 1 = they came on as he tired). */
  oppGrow: number;
  /** Late-round net sig strikes per minute (own landed − absorbed, rounds 3+), shrunk. */
  lateNet: number;
  /** Knockdowns suffered per 15 min, shrunk. */
  droppedPer15: number;
  /** Knockdowns scored per 15 min, shrunk. */
  kdPer15: number;
  /** Knockdowns scored per sig strike landed (power per landed strike), shrunk. */
  kdPerLanded: number;
  /** Share of rounds he was dropped in and survived (not stopped in that round), shrunk. */
  recover: number;
  /** Head strikes absorbed per minute, shrunk. */
  headAbsPerMin: number;
  /** Sig strikes absorbed per minute in rounds 3+, shrunk. */
  lateAbsPerMin: number;
  /** Share of scored rounds won on the round-edge proxy, shrunk. */
  roundWin: number;
  /** Share of scored rounds that were close, shrunk. */
  close: number;
  /** Opponents' takedown accuracy against him (all rounds), shrunk: "taken down at will". */
  tdAtWill: number;
  /** Takedowns absorbed per 15 in round 1 vs later rounds (ratio > 1 = gets taken down more as he tires). */
  tdLateRatio: number;
  /** Seconds controlled per takedown absorbed (how fast he gets back up), shrunk. */
  ctrlPerTd: number;
  /** Round-1 knockdowns + sub attempts per round-1 (early finish threat), shrunk. */
  r1Threat: number;
  /** Round-1 knockdowns suffered per round 1 fought, shrunk. */
  r1Leak: number;
  /** Rounds fought in rounds 4–5. */
  r45Rounds: number;
  /** Net sig strikes per minute in rounds 4–5 (0 when none). */
  r45Net: number;
  /** Finished the opponent after dropping him (share of bouts with a knockdown), shrunk. */
  finDrop: number;
  /** Knockdowns suffered in his last 3 UFC bouts (raw count). */
  recentDropped: number;
  /** Unshrunk evidence behind the rates (for auto-scouting thresholds and explanations). */
  raw: { minutes: number; kd: number; okd: number; dropped: number; survived: number; tdAgainst: number; tdaAgainst: number; fadeBouts: number; koLosses: number };
};

/** Shrunk round-level form from bouts strictly before `date`, or null with no round data. */
export function roundFormAsOf(f: Fighter, date: string, decay = 1): RoundForm | null {
  const rows0 = roundRowsFor(f);
  if (!rows0) return null;
  // Newest first; with decay < 1 recent bouts count more (weight decay^i).
  const rows = rows0.filter((r) => r[0] < date).sort((a, b) => b[0].localeCompare(a[0]));
  const t: Record<RowField, number> = Object.fromEntries(ROW.map((k) => [k, 0])) as Record<RowField, number>;
  let bouts = 0, wb = 0, fadeS = 0, fadeW = 0, growS = 0, growW = 0, kdBouts = 0, finAfter = 0;
  let idx = 0;
  for (const r of rows) {
    const w = Math.pow(decay, idx);
    const get = (k: RowField) => (r[I[k]] as number) * w;
    if (!(get("sec") > 0)) continue;
    idx++;
    bouts++;
    wb += w;
    for (const k of ROW) t[k] += get(k);
    // Pace fade per bout that reached round 3 with a meaningful round 1 and at least 2 late minutes.
    const raw = (k: RowField) => r[I[k]] as number;
    if (raw("lateSec") >= 120 && raw("r1Sec") >= 120) {
      const r1 = raw("r1A") / (raw("r1Sec") / 60), late = raw("lateA") / (raw("lateSec") / 60);
      const or1 = raw("oR1A") / (raw("r1Sec") / 60), olate = raw("oLateA") / (raw("lateSec") / 60);
      if (r1 >= 3) { fadeS += w * Math.min(2.5, late / r1); fadeW += w; }
      if (or1 >= 3) { growS += w * Math.min(2.5, olate / or1); growW += w; }
    }
    if (raw("finDrop") >= 0) { kdBouts += w; finAfter += w * raw("finDrop"); }
  }
  if (!bouts) return null;
  const L = ROUND_LEAGUE;
  const min = t.sec / 60, lateMin = t.lateSec / 60, r45Min = t.r45Sec / 60;
  const sh = (num: number, den: number, prior: number, k: number) => (num + prior * k) / (den + k);
  const r1Rounds = wb;
  return {
    bouts,
    rounds: t.rounds,
    fade: sh(fadeS, fadeW, L.fade, 3),
    oppGrow: sh(growS, growW, L.oGrow, 3),
    lateNet: (t.lateL - t.oLateL) / (lateMin + 10),
    droppedPer15: sh(t.okd, min / 15, L.kdPer15, 1),
    kdPer15: sh(t.kd, min / 15, L.kdPer15, 1),
    kdPerLanded: sh(t.kd, t.r1L + t.lateL + 0, L.kdPerLanded, 150),
    recover: sh(t.droppedOk, t.dropped, L.recover, 2),
    headAbsPerMin: sh(t.oHead, min, L.headPerMin, 15),
    lateAbsPerMin: sh(t.oLateL, lateMin, L.lateAbsPerMin, 10),
    roundWin: sh(t.won, t.rounds, L.roundWin, 6),
    close: sh(t.close, t.rounds, L.close, 6),
    tdAtWill: sh(t.oTdR1 + t.oTdLate, t.oTdaR1 + t.oTdaLate, L.tdAtWill, 6),
    tdLateRatio: sh(t.oTdLate, (t.sec - t.r1Sec) / 900, 1.25, 1) / sh(t.oTdR1, t.r1Sec / 900, 1.25, 1),
    ctrlPerTd: sh(t.oCtrl, t.oTdR1 + t.oTdLate, L.ctrlPerTd, 3),
    r1Threat: sh(t.kdR1 + t.subR1 * 0.5, r1Rounds, 0.2, 4),
    r1Leak: sh(t.okdR1, r1Rounds, 0.1, 4),
    r45Rounds: Math.round(r45Min / 5),
    r45Net: r45Min > 0 ? (t.r45L - t.r45OL) / (r45Min + 5) : 0,
    finDrop: sh(finAfter, kdBouts, L.finDrop, 2),
    recentDropped: rows.slice(0, 3).reduce((a, r) => a + (r[I.okd] as number), 0),
    raw: { minutes: Math.round(min * 10) / 10, kd: t.kd, okd: t.okd, dropped: t.dropped, survived: t.droppedOk, tdAgainst: t.oTdR1 + t.oTdLate, tdaAgainst: t.oTdaR1 + t.oTdaLate, fadeBouts: fadeW, koLosses: t.koLoss },
  };
}

/** public/roster/rounds.json shape: {fightId: [slugOfFirstSide, roundsFirst, roundsSecond]}. */
export type RoundsDoc = { asOf: string; source: string; fields: string[]; fights: Record<string, [string, RoundLine[], RoundLine[]]> };
type HistoryLike = { date: string; fightId: string; result: string; method: string; round: number; time: string };

/** Summary rows (newest first) for one roster fighter's UFC history, from the per-round file. Used by build scripts and backtests. */
export function roundRowsFromRoster(slug: string, history: HistoryLike[], doc: RoundsDoc): RoundRow[] {
  const out: RoundRow[] = [];
  for (const h of history) {
    const e = doc.fights[h.fightId];
    if (!e) continue;
    const [first, ra, rb] = e;
    const [me, op] = first === slug ? [ra, rb] : [rb, ra];
    const inside = /^(KO\/TKO|Submission)/.test(h.method);
    out.push(summarizeBout(h.date, me, op, h.round, h.time, inside && h.result === "W", inside && h.result === "L", /^KO\/TKO/.test(h.method) && h.result === "L"));
  }
  return out;
}
