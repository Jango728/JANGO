/**
 * Jango Playz prediction engine — v1.3 "calibrated consensus + round by round".
 *
 * Every signal the user looks at is evaluated in full, then combined into one
 * calibrated win probability. Signal weights were fitted by logistic regression on
 * 1,100+ UFC bouts from 2021–2024 (pre-fight data only) and checked out of sample on
 * every 2025–2026 bout before shipping (scripts/backtest.ts). Internal weights never
 * reach the UI. Odds, other people's picks, flags and photos are never inputs.
 *
 *  Résumé model    – results against the quality of opposition (who they beat AND
 *                    who beat them), quality of losses, proven record at UFC level.
 *  Matchup model   – as-of UFC striking / grappling rates (only fights before the
 *                    card), finish routes vs the opponent's stoppage losses, size, and
 *                    (v1.3) round-by-round tape: late-round output and being taken down at will.
 *  Readiness model – momentum, layoff, age on fight night.
 *  Challenger      – a deliberately simple baseline (smoothed win rate at the
 *                    top level + schedule). Shown for transparency.
 */
import type { Event, Fight, Fighter, PastFight } from "./types";
import {
  clamp,
  historySummary,
  pastBefore,
  resultRecord,
  strengthOfSchedule,
  usableStats,
} from "./model";
import { formatHeightDelta, formatReachDelta } from "./measurements";
import { nonCompetitive } from "./model";
import { scoutNotes, scoutTags, type ScoutTag } from "./scouting";
import { statsAsOf, timelineDob, type AsOfStats } from "./fight-stats";
import { roundFormAsOf } from "./round-features";

export const ENGINE_VERSION = "1.3";

export type SubModel = "resume" | "matchup" | "readiness" | "challenger";
export type SignalId =
  | "opposition"
  | "h2h"
  | "losses"
  | "level"
  | "form"
  | "style"
  | "finish"
  | "size"
  | "distance"
  | "momentum"
  | "activity"
  | "age"
  | "scouting"
  | "tape";

export type Signal = {
  id: SignalId;
  model: SubModel;
  label: string;
  /** Positive favours fighter A, negative fighter B. Range −1…1. */
  score: number | null;
  /** Internal importance (logistic coefficient). Never displayed. */
  weight: number;
  /** Plain-language reason for whichever side the signal favours. */
  reason?: { title: string; text: string };
};

export type Tier =
  | "Coin flip"
  | "Slight lean"
  | "Solid lean"
  | "Strong pick"
  | "Exceptional";

export type EnginePrediction = {
  version: string;
  pick: string | null;
  confidence: number | null;
  tier: Tier | null;
  /** Calibrated probability that fighter A wins, before the evidence / thin-résumé caps (0–1). */
  probabilityA: number;
  /** 0–100: how much of the evidence the model wants is actually loaded. */
  evidence: number;
  evidenceLabel: "Complete" | "Good" | "Limited" | "Pending";
  models: { id: SubModel; label: string; lean: string | null; score: number | null }[];
  agreement: number;
  signals: Signal[];
  reasons: { title: string; text: string }[];
  counter: { title: string; text: string } | null;
  gaps: string[];
  status: "pick" | "pending";
  pendingReason?: string;
};

/**
 * Logistic coefficients per signal (log-odds per unit of signal score).
 * Fitted with non-negative constrained logistic regression on UFC bouts 2021-01 → 2024-12
 * (scripts/backtest.ts reproduces the out-of-sample check on 2025-01 → 2026-09).
 * Signals the fit found redundant keep a small floor so they still show in the edge map
 * but can't drive a pick on their own.
 */
const WEIGHTS: Record<SignalId, number> = {
  opposition: 0.3,
  h2h: 0.3,
  losses: 0.2,
  level: 0.3,
  form: 0.05,
  style: 1.1,
  finish: 0.35,
  size: 0.2,
  distance: 0.05,
  momentum: 0.05,
  activity: 0.45,
  age: 0.55,
  scouting: 0.4,
  // v1.3: fitted on 2021–24 on top of the v1.2 log-odds (scripts/backtest-rounds.ts), checked on 2025–26.
  tape: 0.22,
};

const MODEL_LABEL: Record<SubModel, string> = {
  resume: "Résumé",
  matchup: "Style matchup",
  readiness: "Form & readiness",
  challenger: "Challenger baseline",
};

const TOP_LEVEL = ["UFC", "DWCS"];
const isStoppage = (h: PastFight) =>
  /\b(?:ko|tko)\b|submission/i.test(h.method) &&
  !/injury|doctor|cut|retire|disqual/i.test(h.method);
const isKo = (h: PastFight) => /\b(?:ko|tko)\b/i.test(h.method) && isStoppage(h);

/** Smoothed pre-fight win rate of an opponent (0–1), null when unknown. */
export function opponentQuality(record?: string): number | null {
  if (!record || !/^\d+-\d+(?:-\d+)?$/.test(record)) return null;
  const [w, l, d = 0] = record.split("-").map(Number);
  return (w + 0.5 * d + 2) / (w + l + d + 4);
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
export const shortName = (name: string) => {
  const parts = name.replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i, "").trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
};

/** Age on the event date: birth date first (profile, then UFCStats), else the listed age. */
export function ageAt(f: Fighter, date: string): number | undefined {
  const dob = f.birthDate ?? timelineDob(f);
  if (dob && Number.isFinite(Date.parse(dob))) return Math.floor((Date.parse(date) - Date.parse(dob)) / (365.25 * 86400000));
  return f.age;
}

export function tierFor(confidence: number): Tier {
  if (confidence >= 82) return "Exceptional";
  if (confidence >= 72) return "Strong pick";
  if (confidence >= 63) return "Solid lean";
  if (confidence >= 55) return "Slight lean";
  return "Coin flip";
}

function streak(rows: PastFight[], result: "W" | "L") {
  let n = 0;
  for (const r of rows) {
    if (r.result === "NC") continue;
    if (r.result !== result) break;
    n++;
  }
  return n;
}

function levelRecord(h: PastFight[]) {
  const ufc = h.filter((x) => x.promotion === "UFC" && x.result !== "NC");
  const w = ufc.filter((x) => x.result === "W").length,
    l = ufc.filter((x) => x.result === "L").length,
    d = ufc.filter((x) => x.result === "D").length;
  return { w, l, d, n: w + l + d, rate: (w + 0.5 * d + 1.5) / (w + l + d + 3) };
}

/**
 * Results against the quality of opposition, last 10 (newest weighted most):
 * a win over a 80% opponent is worth +0.8, a loss to a 30% opponent costs −0.7.
 * This is "who they beat AND who beat them" in one number. The v1.1 schedule-strength
 * measure (how good the opponents were, win or lose) did not predict UFC results.
 */
function resultsVsOpposition(rows: PastFight[]) {
  let s = 0, w = 0, n = 0;
  rows.forEach((x, i) => {
    const q = opponentQuality(x.opponentRecord);
    if (q === null) return;
    const r = x.result === "W" ? 1 : x.result === "L" ? 0 : 0.5;
    const wt = Math.pow(0.85, i);
    s += wt * (r - (1 - q));
    w += wt;
    n++;
  });
  return n ? { score: s / w, n } : null;
}

type Profile = ReturnType<typeof profile>;
function profile(f: Fighter, event: Event, fight: Fight) {
  const s = historySummary(f, event.date, fight.rules);
  // DQ wins/losses and overturned results are skipped: they say nothing about who was better.
  const all = pastBefore(f, event.date, fight.rules).filter((x) => x.result !== "NC" && !nonCompetitive(x));
  const recent = s.recent.filter((x) => x.result !== "NC" && !nonCompetitive(x));
  const wins = recent.filter((x) => x.result === "W");
  const losses = recent.filter((x) => x.result === "L");
  const winQ = wins.map((x) => opponentQuality(x.opponentRecord)).filter((q): q is number => q !== null);
  const lossQ = losses.map((x) => opponentQuality(x.opponentRecord)).filter((q): q is number => q !== null);
  const schedule = strengthOfSchedule(s.recent);
  const stops = wins.filter(isStoppage);
  const stopped = losses.filter(isStoppage);
  const koLosses = losses.filter(isKo);
  const level = levelRecord(all);
  // On a non-UFC card (e.g. the one-off OKTAGON 94), bouts in that promotion count as top level too,
  // so the thin-résumé cap doesn't treat a 49-fight OKTAGON veteran like a debutant.
  const top = event.promotion === "OKTAGON" ? [...TOP_LEVEL, "OKTAGON"] : TOP_LEVEL;
  const topLevel = all.filter((x) => top.includes(x.promotion)).length;
  // As-of UFC rates from per-fight stat lines (only bouts strictly before this card); official
  // career aggregates are the fallback when they were published before the card.
  const asOf = fight.rules === "MMA" ? statsAsOf(f, event.date) : null;
  return {
    f,
    s,
    all,
    recent,
    wins,
    losses,
    winQ,
    lossQ,
    schedule,
    stops,
    stopped,
    koLosses,
    level,
    topLevel,
    vsOpp: resultsVsOpposition(recent),
    eliteWins: wins.filter((x) => x.promotion === "UFC" && (opponentQuality(x.opponentRecord) ?? 0) >= 0.7).length,
    scout: scoutTags(f.id, event.date),
    scoutNotes: scoutNotes(f.id, event.date),
    winStreak: streak(recent, "W"),
    lossStreak: streak(recent, "L"),
    stats: usableStats(f, event.date, fight.rules),
    asOf,
    rounds: fight.rules === "MMA" ? roundFormAsOf(f, event.date) : null,
    age: ageAt(f, event.date),
  };
}

function side(score: number, a: Profile, b: Profile) {
  return score >= 0 ? { w: a, l: b } : { w: b, l: a };
}

/** Style numbers for one fighter: as-of UFC rates first, official aggregates as a fallback. */
function styleNumbers(p: Profile): (Pick<AsOfStats, "slpm" | "sapm" | "tdPer15" | "tdDef"> & { ctrlEdge: number | null; strAcc: number | null; strDef: number | null; minutes: number | null; src: "asof" | "official" }) | null {
  if (p.asOf && p.asOf.minutes >= 5)
    return { slpm: p.asOf.slpm, sapm: p.asOf.sapm, tdPer15: p.asOf.tdPer15, tdDef: p.asOf.tdDef, ctrlEdge: p.asOf.ctrlEdge, strAcc: p.asOf.strAcc, strDef: p.asOf.strDef, minutes: p.asOf.minutes, src: "asof" };
  const s = p.stats;
  if (s && s.slpm !== undefined && s.sapm !== undefined && s.tdPer15 !== undefined && s.tdDefense !== undefined)
    return {
      slpm: s.slpm, sapm: s.sapm, tdPer15: s.tdPer15, tdDef: s.tdDefense / 100, ctrlEdge: null,
      strAcc: s.strikeAccuracy !== undefined ? s.strikeAccuracy / 100 : null, strDef: s.strikeDefense !== undefined ? s.strikeDefense / 100 : null, minutes: null, src: "official",
    };
  return null;
}

function signals(fight: Fight, event: Event, A: Profile, B: Profile): Signal[] {
  const out: Signal[] = [];
  const push = (id: SignalId, model: SubModel, label: string, score: number | null, reason?: (w: Profile, l: Profile) => { title: string; text: string }) => {
    const s = score === null || !Number.isFinite(score) ? null : clamp(score);
    const r = s !== null && Math.abs(s) >= 0.03 && reason ? reason(side(s, A, B).w, side(s, A, B).l) : undefined;
    out.push({ id, model, label, score: s, weight: WEIGHTS[id], reason: r });
  };

  // 1. Results against the quality of opposition — who they beat AND who beat them.
  {
    const va = A.vsOpp, vb = B.vsOpp;
    const ok = va && vb && va.n >= 3 && vb.n >= 3;
    push("opposition", "resume", "Results vs quality of opposition", ok ? (va!.score - vb!.score) * 2 : null, (w, l) => {
      const ww = mean(w.winQ), lw = mean(l.winQ);
      if (w.eliteWins >= 2 && w.eliteWins > l.eliteWins)
        return {
          title: "Beaten the better names",
          text: `${w.f.name} has ${w.eliteWins} wins in the last 10 over UFC opponents with 70%+ records going in; ${l.f.name} has ${l.eliteWins}.`,
        };
      return {
        title: "Better results against real opposition",
        text:
          ww !== null && lw !== null
            ? `Opponents ${w.f.name} beat (last 10) had a ${pct(ww)} win rate going in; ${l.f.name}'s had ${pct(lw)}. Losses to weaker opponents count against.`
            : `${w.f.name} has done better against opponents' pre-fight records, wins and losses both counted.`,
      };
    });
  }

  // 1b. Head-to-head — if they've met recently, the latest meeting matters most. Meetings older
  //     than 5 years are ignored (UFC FN 289 lesson: a 2018 win shouldn't decide a 2026 fight).
  {
    const na = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
    const yrs = (d: string) => (Date.parse(event.date) - Date.parse(d)) / (365.25 * 86400000);
    const meetings = A.all.filter((x) => na(x.opponent) === na(B.f.name) && (x.result === "W" || x.result === "L") && yrs(x.date) <= 5);
    const age = meetings.length ? yrs(meetings[0].date) : 0;
    const fade = Math.pow(0.5, Math.max(0, age) / 3);
    const score = meetings.length
      ? (meetings.reduce((s, x, i) => s + (x.result === "W" ? 1 : -1) * Math.pow(0.5, i), 0) / meetings.reduce((s, _, i) => s + Math.pow(0.5, i), 0)) * 0.9 * fade
      : null;
    if (score !== null)
      push("h2h", "resume", "Previous meeting", score, (w, l) => {
        const wins = meetings.filter((x) => (w === A ? x.result === "W" : x.result === "L")).length;
        const last = meetings[0];
        return {
          title: "Won the last meeting",
          text: `They've met ${meetings.length === 1 ? "once" : `${meetings.length} times`} in the last 5 years (${w.f.name} ${wins}-${meetings.length - wins}). Latest: ${last.date.slice(0, 4)}, ${(last.result === "W") === (w === A) ? w.f.name : l.f.name} by ${last.method.split(/\s*[-(]/)[0].trim()}.`,
        };
      });
  }

  // 2. Who beat them — losses to weak opponents are red flags; losses to elite ones aren't.
  {
    const bad = (p: Profile) =>
      p.losses.reduce((s, x) => {
        const q = opponentQuality(x.opponentRecord);
        return s + (q === null ? 0.5 : 1 - q);
      }, 0) / Math.max(4, p.recent.length);
    const enough = A.recent.length >= 3 && B.recent.length >= 3;
    push("losses", "resume", "Quality of their losses", enough ? (bad(B) - bad(A)) * 3 : null, (w, l) => {
      const q = mean(l.lossQ);
      return {
        title: "Cleaner losses",
        text: l.losses.length
          ? `${l.f.name} has ${l.losses.length} loss${l.losses.length > 1 ? "es" : ""} in the last 10${q !== null ? `, to opponents averaging a ${pct(q)} win rate` : ""}; ${w.f.name} has ${w.losses.length}.`
          : `${w.f.name}'s losses came against stronger opposition.`,
      };
    });
  }

  // 3. Proven at UFC level.
  {
    const la = A.level, lb = B.level;
    const both = la.n + lb.n > 0;
    const exp = (n: number) => Math.min(n, 10) / 10;
    const score = both ? (la.rate - lb.rate) * 1.6 + (exp(la.n) - exp(lb.n)) * 0.35 : null;
    push("level", "resume", "Proven at UFC level", score, (w, l) => ({
      title: "Proven at this level",
      text: `UFC record: ${w.f.name} ${w.level.w}-${w.level.l}${w.level.d ? `-${w.level.d}` : ""}, ${l.f.name} ${l.level.w}-${l.level.l}${l.level.d ? `-${l.level.d}` : ""}.`,
    }));
  }

  // 4. Recent results (last 10, newest weighted most).
  {
    const ok = A.s.form !== null && B.s.form !== null && A.recent.length >= 3 && B.recent.length >= 3;
    push("form", "readiness", "Recent results", ok ? (A.s.form! - B.s.form!) * 1.8 : null, (w, l) => ({
      title: "Better recent results",
      text: `Last ${w.s.recent.length}: ${w.f.name} ${resultRecord(w.s.recent)}. Last ${l.s.recent.length}: ${l.f.name} ${resultRecord(l.s.recent)}.`,
    }));
  }

  // 5. Striking & grappling numbers — as-of UFC rates (only fights before this card).
  //    Parts and their internal weights come from the 2021–24 fit: net strikes per minute,
  //    takedowns landed against the opponent's defence, strike accuracy and defence, control time.
  {
    const a = styleNumbers(A), b = styleNumbers(B);
    let score: number | null = null;
    if (a && b) {
      const parts: { s: number; w: number }[] = [];
      parts.push({ s: ((a.slpm - a.sapm) - (b.slpm - b.sapm)) / 4, w: 0.4 });
      parts.push({ s: (a.tdPer15 * (1 - b.tdDef) - b.tdPer15 * (1 - a.tdDef)) / 2.5, w: 0.35 });
      if (a.strAcc !== null && b.strAcc !== null) parts.push({ s: (a.strAcc - b.strAcc) * 10, w: 0.2 });
      if (a.strDef !== null && b.strDef !== null) parts.push({ s: (a.strDef - b.strDef) * 10, w: 0.2 });
      if (a.ctrlEdge !== null && b.ctrlEdge !== null) parts.push({ s: (a.ctrlEdge - b.ctrlEdge) * 3, w: 0.15 });
      // Small UFC samples are mostly league average already (shrinkage in fight-stats); a thin
      // official-aggregate sample is damped here.
      const sample = a.src === "asof" && b.src === "asof" ? 1 : Math.min(1, Math.min(A.topLevel, B.topLevel) / 6) * 0.6 + 0.4;
      score = (parts.reduce((s, p) => s + clamp(p.s) * p.w, 0) / parts.reduce((s, p) => s + p.w, 0)) * sample;
    }
    push("style", "matchup", "Striking & wrestling numbers", score, (w, l) => {
      const ws = styleNumbers(w)!, ls = styleNumbers(l)!;
      const tdEdge = ws.tdPer15 * (1 - ls.tdDef) - ls.tdPer15 * (1 - ws.tdDef);
      const strEdge = (ws.slpm - ws.sapm) - (ls.slpm - ls.sapm);
      const text =
        tdEdge >= 0.5 && ws.tdPer15 >= 1.5
          ? `${w.f.name} lands ${ws.tdPer15.toFixed(1)} takedowns per 15 min in the UFC; ${l.f.name} stops ${Math.round(ls.tdDef * 100)}% of attempts.`
          : strEdge > 0
            ? `Significant strikes landed minus absorbed per minute (UFC, before this card): ${w.f.name} ${(ws.slpm - ws.sapm).toFixed(1)}, ${l.f.name} ${(ls.slpm - ls.sapm).toFixed(1)}.`
            : ws.strDef !== null && ls.strDef !== null
              ? `Striking accuracy ${Math.round((ws.strAcc ?? 0) * 100)}% vs ${Math.round((ls.strAcc ?? 0) * 100)}%, defence ${Math.round(ws.strDef * 100)}% vs ${Math.round(ls.strDef * 100)}% (${w.f.name} first).`
              : `${w.f.name} has the better UFC striking/grappling rates.`;
      return { title: "Wins the exchanges", text };
    });
  }

  // 6. Finish routes vs the opponent's stoppage losses (regional finishes discounted).
  {
    const threat = (p: Profile) =>
      p.stops.reduce((s, x) => s + (opponentQuality(x.opponentRecord) ?? 0.45), 0) / Math.max(5, p.recent.length);
    const leak = (p: Profile) => p.stopped.length / Math.max(5, p.recent.length);
    const ok = A.recent.length >= 3 && B.recent.length >= 3;
    const score = ok ? (threat(A) + leak(B) - threat(B) - leak(A)) * 1.6 : null;
    push("finish", "matchup", "Finishing power vs toughness", score, (w, l) => ({
      title: w.stops.length >= l.stopped.length ? "Real finishing threat" : "More durable",
      text: `${w.f.name} finished ${w.stops.length} of ${w.wins.length} recent wins; ${l.f.name} has been stopped ${l.stopped.length} time${l.stopped.length === 1 ? "" : "s"} in the last ${l.recent.length}.`,
    }));
  }

  // 7. Height & reach (capped — size alone never decides a fight).
  {
    const a = A.f, b = B.f;
    const reach = a.reach && b.reach ? clamp((a.reach - b.reach) / 12.7, -0.6, 0.6) : null;
    const height = a.height && b.height ? clamp((a.height - b.height) / 15, -0.4, 0.4) : null;
    const score = reach === null && height === null ? null : (reach ?? 0) * 0.7 + (height ?? 0) * 0.3;
    push("size", "matchup", "Height & reach", score, (w, l) => {
      const r = w.f.reach && l.f.reach ? w.f.reach - l.f.reach : 0;
      const h = w.f.height && l.f.height ? w.f.height - l.f.height : 0;
      return {
        title: "Size and range",
        text: [r > 1 ? `${formatReachDelta(r)} longer reach` : "", h > 1 ? `${formatHeightDelta(h)} taller` : ""].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase()) + ` for ${w.f.name}.`,
      };
    });
  }

  // 8. Results in fights that reach round 3.
  {
    const ok = A.s.long.length >= 2 && B.s.long.length >= 2;
    const rate = (xs: PastFight[]) => (xs.filter((x) => x.result === "W").length + 0.5 * xs.filter((x) => x.result === "D").length + 1) / (xs.length + 2);
    push("distance", "matchup", "Record in long fights", ok ? (rate(A.s.long) - rate(B.s.long)) * (fight.rounds > 3 ? 1.2 : 0.9) : null, (w, l) => ({
      title: fight.rounds > 3 ? "Better over 5 rounds" : "Better when it goes long",
      text: `In fights reaching round 3: ${w.f.name} ${w.s.longRecord}, ${l.f.name} ${l.s.longRecord}.`,
    }));
  }

  // 9. Momentum — a skid only counts as decline when it came against beatable opposition
  //    (UFC 331 Vera, FN 289 Vieira/Brener/Jackson: skids against good fighters aren't slides).
  {
    const skidOpp = (p: Profile) => mean(p.losses.slice(0, p.lossStreak).map((x) => opponentQuality(x.opponentRecord)).filter((q): q is number => q !== null));
    const slide = (p: Profile) => {
      if (p.lossStreak < 2) return 0;
      const base = 0.12 + (p.lossStreak - 2) * 0.12;
      const q = skidOpp(p);
      return q !== null && q >= 0.65 ? base * 0.35 : base;
    };
    const m = (p: Profile) => Math.min(p.winStreak, 5) * 0.06 - slide(p);
    const ok = A.recent.length >= 2 && B.recent.length >= 2;
    push("momentum", "readiness", "Momentum", ok ? (m(A) - m(B)) * 2 : null, (w, l) => ({
      title: l.lossStreak >= 2 ? "Opponent is sliding" : "On a run",
      text:
        l.lossStreak >= 2
          ? `${l.f.name} has lost ${l.lossStreak} straight${w.winStreak >= 2 ? `; ${w.f.name} has won ${w.winStreak} straight` : ""}.`
          : `${w.f.name} has won ${w.winStreak} straight${l.winStreak ? ` (${l.f.name}: ${l.winStreak})` : ""}.`,
    }));
  }

  // 10. Activity — long layoffs and very short turnarounds only.
  {
    const la = A.s.layoff, lb = B.s.layoff;
    const risk = (d: number) => (d > 400 ? -Math.min(0.6, (d - 400) / 700) : d < 42 ? -Math.min(0.3, (42 - d) / 120) : 0);
    const score = la !== null && lb !== null ? (risk(la) - risk(lb)) * 1.5 : null;
    push("activity", "readiness", "Activity", score, (w, l) => ({
      title: "Ring rust on the other side",
      text: `${l.f.name} last fought ${l.s.layoff} days before this card; ${w.f.name} ${w.s.layoff} days.`,
    }));
  }

  // 11. Age on fight night (decline from 28, steeper after 35 — fitted on 2021–24 UFC results).
  {
    const curve = (age?: number) => (age === undefined ? null : -(Math.max(0, age - 28) * 0.05 + Math.max(0, age - 35) * 0.07));
    const ca = curve(A.age), cb = curve(B.age);
    push("age", "readiness", "Age & prime", ca !== null && cb !== null ? (ca - cb) * 2 : null, (w, l) => ({
      title: "Age & prime",
      text: `${l.f.name} will be ${l.age} on fight night; ${w.f.name} ${w.age}.`,
    }));
  }

  // 12. Round-by-round tape (v1.3) — UFCStats round lines, bouts before this card only:
  //     who out-lands opponents once fights reach round 3, and who gets taken down whenever the
  //     other man shoots (opponents' takedown accuracy against him). Raw log-odds per unit, fitted on
  //     2021–24 on top of the v1.2 signals: 0.036 per net late strike/min, 0.39 per unit of TD accuracy allowed.
  {
    const a = A.rounds, b = B.rounds;
    // Fitted on fighters with 3+ UFC bouts each (thinner samples: no score, so no push either way).
    const ok = a && b && a.bouts >= 3 && b.bouts >= 3;
    const z = ok ? 0.036 * (a!.lateNet - b!.lateNet) + 0.39 * (b!.tdAtWill - a!.tdAtWill) : null;
    push("tape", "matchup", "Round-by-round tape", z === null ? null : z / WEIGHTS.tape / 1.1, (w, l) => {
      const wr = w.rounds!, lr = l.rounds!;
      const td = lr.tdAtWill - wr.tdAtWill, late = wr.lateNet - lr.lateNet;
      return 0.39 * td >= 0.036 * late
        ? { title: "Harder to hold down", text: `Opponents complete ${Math.round(lr.tdAtWill * 100)}% of their takedown attempts on ${l.f.name} in the UFC; ${Math.round(wr.tdAtWill * 100)}% on ${w.f.name}.` }
        : { title: "Wins the late rounds", text: `Significant strikes landed minus absorbed per minute from round 3 on (UFC): ${w.f.name} ${signed(wr.lateNet)}, ${l.f.name} ${signed(lr.lateNet)}.` };
    });
  }

  // 13. Scouting notes — permanent lessons from past round-by-round reviews (only notes dated before this card).
  {
    const grappler = (p: Profile) =>
      p.scout.has("td-offense") || p.scout.has("sub-threat") || (styleNumbers(p)?.tdPer15 ?? 0) >= 1.5 || /wrestl|jiu|bjj|grappl|sambo/i.test(p.f.style ?? "");
    const hitter = (p: Profile) => p.scout.has("power") || p.koLosses.length === 0 && p.stops.filter(isKo).length >= 3;
    const five = fight.rounds > 3;
    const effects: Record<ScoutTag, (me: Profile, opp: Profile) => number> = {
      "cardio-fade": (_m, o) => -(five ? 0.45 : 0.3) - (o.scout.has("five-round-proven") ? 0.1 : 0),
      "five-round-proven": () => (five ? 0.25 : 0.1),
      "td-vulnerable": (_m, o) => (grappler(o) ? -0.45 : -0.1),
      "td-offense": (_m, o) => (o.scout.has("td-vulnerable") || (styleNumbers(o)?.tdDef ?? 1) < 0.6 ? 0.35 : 0.12),
      "sub-threat": (_m, o) => (o.scout.has("td-vulnerable") ? 0.2 : 0.1),
      "chin-concern": (_m, o) => (hitter(o) ? -0.35 : -0.12),
      durable: () => 0.08,
      power: (_m, o) => (o.scout.has("chin-concern") ? 0.3 : 0.12),
      "discipline-risk": () => -0.05,
      "slow-starter": () => (five ? 0 : -0.06),
      "dq-loss": () => 0,
      "dq-win": () => 0,
    };
    const total = (me: Profile, opp: Profile) => [...me.scout].reduce((s, t) => s + (effects[t]?.(me, opp) ?? 0), 0);
    const any = A.scout.size + B.scout.size > 0;
    const score = any ? clamp((total(A, B) - total(B, A)) * 1.2) : null;
    push("scouting", "matchup", "Film-study notes", score !== null && Math.abs(score) < 0.02 ? null : score, (w, l) => {
      const weak = l.scoutNotes.find((n) => n.kind === "weakness");
      const strong = w.scoutNotes.find((n) => n.kind === "strength");
      const pickNote = weak ? `${l.f.name}: ${weak.note}` : strong ? `${w.f.name}: ${strong.note}` : "";
      return { title: weak ? "Known weakness on tape" : "Proven strength on tape", text: pickNote || `Past fight notes favour ${w.f.name}.` };
    });
  }

  return out;
}

function challenger(A: Profile, B: Profile): number | null {
  if (A.recent.length < 2 || B.recent.length < 2) return null;
  const rate = (p: Profile) => {
    const top = p.all.filter((x) => TOP_LEVEL.includes(x.promotion));
    const rows = top.length >= 3 ? top : p.all.slice(0, 10);
    const w = rows.filter((x) => x.result === "W").length, n = rows.length;
    return (w + 2) / (n + 4);
  };
  const sch = (p: Profile) => p.schedule?.score ?? 0.55;
  return clamp((rate(A) - rate(B)) * 2 + (sch(A) - sch(B)) * 2);
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * How far the same edge carries in different fight types (temperature on the log-odds),
 * fitted on 2021–24 and confirmed on 2025–26: light heavyweight and five-round fights are
 * noisier than the edge suggests (FN 289 Bellato lesson); heavyweight and 3-round men's
 * fights up to 185 lb reward the better fighter more reliably. Women's fights: no change.
 */
export function divisionTemperature(fight: Fight): number {
  const d = fight.division.toLowerCase();
  if (fight.rounds >= 5) return 0.8;
  if (/light heavyweight/.test(d)) return 0.55;
  if (/women/.test(d)) return 1;
  if (/heavyweight/.test(d)) return 1.3;
  return 1.2;
}

export function predict(fight: Fight, a: Fighter, b: Fighter, event: Event): EnginePrediction {
  const A = profile(a, event, fight), B = profile(b, event, fight);
  const sig = signals(fight, event, A, B);
  const total = sig.reduce((s, x) => s + x.weight, 0);
  const known = sig.filter((x) => x.score !== null);
  const covered = known.reduce((s, x) => s + x.weight, 0);
  const coverage = covered / total;

  const byModel = (m: SubModel) => {
    const xs = known.filter((x) => x.model === m);
    const w = xs.reduce((s, x) => s + x.weight, 0);
    return w ? xs.reduce((s, x) => s + x.score! * x.weight, 0) / w : null;
  };
  const models: EnginePrediction["models"] = (["resume", "matchup", "readiness"] as SubModel[]).map((id) => {
    const score = byModel(id);
    return { id, label: MODEL_LABEL[id], score, lean: score === null || Math.abs(score) < 0.02 ? null : score > 0 ? a.id : b.id };
  });
  const ch = challenger(A, B);
  models.push({ id: "challenger", label: MODEL_LABEL.challenger, score: ch, lean: ch === null || Math.abs(ch) < 0.02 ? null : ch > 0 ? a.id : b.id });

  // Calibrated log-odds: every known signal adds weight × score; a missing signal adds nothing,
  // so gaps pull the probability toward 50% instead of being papered over.
  let z = known.reduce((s, x) => s + x.score! * x.weight, 0) * divisionTemperature(fight);
  // Matchmaker cross-division bouts only (real bouts never carry weightGap). A one-division move
  // is free (movers-up held their own in the backtest); each pound beyond the first ~15 lb of
  // extra size shifts the odds toward the naturally bigger fighter. Rule of thumb, not backtested:
  // real cross-division fights are too rare to fit it.
  if (fight.weightGap) {
    const g = fight.weightGap.a - fight.weightGap.b;
    const excess = Math.sign(g) * Math.max(0, Math.abs(g) - 15);
    z -= 0.018 * excess;
  }
  const probabilityA = sigmoid(z);
  // Every bout gets a pick when the data exists; a near-zero edge is shown as a coin flip.
  const pick = z === 0 ? null : z > 0 ? a.id : b.id;
  const voting = models.filter((m) => m.lean);
  const agreement = voting.length ? voting.filter((m) => m.lean === pick).length / voting.length : 0.5;

  // Evidence quality: how much of the full picture is loaded, and at what level.
  const depth = Math.min(1, Math.min(A.recent.length, B.recent.length) / 6);
  const top = Math.min(A.topLevel, B.topLevel);
  const evidence = Math.round(100 * (0.55 * coverage + 0.3 * depth + 0.15 * Math.min(1, top / 3)));
  const evidenceLabel: EnginePrediction["evidenceLabel"] = evidence >= 85 ? "Complete" : evidence >= 65 ? "Good" : evidence >= 45 ? "Limited" : "Pending";

  const gaps: string[] = [];
  for (const p of [A, B]) {
    if (!p.f.reach) gaps.push(`${p.f.name}: reach not verified`);
    if (!p.f.height) gaps.push(`${p.f.name}: height not verified`);
    if (p.recent.length < 3) gaps.push(`${p.f.name}: fewer than 3 loaded pro fights`);
    if (!styleNumbers(p)) gaps.push(`${p.f.name}: no UFC striking/grappling numbers`);
    if (!p.vsOpp || p.vsOpp.n < 3) gaps.push(`${p.f.name}: opponent records incomplete`);
  }

  const pendingReason =
    A.recent.length < 2 || B.recent.length < 2
      ? "At least one fighter has fewer than two verified pro fights loaded."
      : evidence < 35
        ? "Too little verified data to make an honest pick yet."
        : undefined;

  let confidence: number | null = null;
  if (pick && !pendingReason) {
    // Missing signals already pull z toward 0. On top of that, the probability was calibrated on
    // fighters with 3+ UFC bouts; with less top-level experience it's shrunk toward 50% (up to 20%).
    const quality = 0.8 + 0.2 * Math.min(1, top / 3);
    const p = Math.max(probabilityA, 1 - probabilityA);
    confidence = Math.round(Math.min(90, Math.max(50, 100 * (0.5 + (p - 0.5) * quality))));
    // Thin-résumé cap: a fighter with under 6 pro fights (or no top-level fights) can't carry a "Strong" pick.
    const thin = [A, B].some((p) => p.all.length < 6 || p.topLevel === 0);
    if (thin) confidence = Math.min(confidence, 68);
  }

  const reasons = known
    .filter((x) => x.reason && Math.sign(x.score!) === (pick === a.id ? 1 : -1))
    .sort((x, y) => Math.abs(y.score! * y.weight) - Math.abs(x.score! * x.weight))
    .slice(0, 5)
    .map((x) => x.reason!);
  const counterSignal = known
    .filter((x) => x.reason && Math.sign(x.score!) === (pick === a.id ? -1 : 1))
    .sort((x, y) => Math.abs(y.score! * y.weight) - Math.abs(x.score! * x.weight))[0];

  return {
    version: ENGINE_VERSION,
    pick: pendingReason ? null : pick,
    confidence,
    tier: confidence === null ? null : tierFor(confidence),
    probabilityA,
    evidence,
    evidenceLabel,
    models,
    agreement,
    signals: sig,
    reasons,
    counter: counterSignal?.reason ?? null,
    gaps,
    status: confidence === null ? "pending" : "pick",
    pendingReason: pendingReason ?? (pick ? undefined : "The evidence is split evenly — no honest lean either way."),
  };
}
