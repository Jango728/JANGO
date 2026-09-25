/**
 * Jango Playz prediction engine — v1.0 "consensus".
 *
 * Every signal the user looks at is evaluated in full, then combined into a
 * consensus across four independent sub-models. Internal weights never reach
 * the UI. Odds, other people's picks, flags and photos are never inputs.
 *
 *  Résumé model    – quality of opposition (who they beat AND who beat them),
 *                    proven record at UFC level, recent results.
 *  Matchup model   – striking / grappling rates, finish routes vs the
 *                    opponent's stoppage losses, height & reach, late-round results.
 *  Readiness model – momentum (win/loss streaks), layoff, age curve.
 *  Challenger      – a deliberately simple baseline (smoothed win rate at the
 *                    top level + schedule). When it disagrees, confidence drops.
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

export const ENGINE_VERSION = "1.0";

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
  | "age";

export type Signal = {
  id: SignalId;
  model: SubModel;
  label: string;
  /** Positive favours fighter A, negative fighter B. Range −1…1. */
  score: number | null;
  /** Internal importance. Never displayed. */
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

const WEIGHTS: Record<SignalId, number> = {
  opposition: 0.2,
  h2h: 0.12,
  losses: 0.08,
  level: 0.1,
  form: 0.12,
  style: 0.14,
  finish: 0.08,
  size: 0.07,
  distance: 0.05,
  momentum: 0.07,
  activity: 0.04,
  age: 0.05,
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
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
export const shortName = (name: string) => {
  const parts = name.replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i, "").trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
};

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

type Profile = ReturnType<typeof profile>;
function profile(f: Fighter, event: Event, fight: Fight) {
  const s = historySummary(f, event.date, fight.rules);
  const all = pastBefore(f, event.date, fight.rules).filter((x) => x.result !== "NC");
  const recent = s.recent.filter((x) => x.result !== "NC");
  const wins = recent.filter((x) => x.result === "W");
  const losses = recent.filter((x) => x.result === "L");
  const winQ = wins.map((x) => opponentQuality(x.opponentRecord)).filter((q): q is number => q !== null);
  const lossQ = losses.map((x) => opponentQuality(x.opponentRecord)).filter((q): q is number => q !== null);
  const schedule = strengthOfSchedule(s.recent);
  const stops = wins.filter(isStoppage);
  const stopped = losses.filter(isStoppage);
  const koLosses = losses.filter(isKo);
  const level = levelRecord(all);
  const topLevel = all.filter((x) => TOP_LEVEL.includes(x.promotion)).length;
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
    winStreak: streak(recent, "W"),
    lossStreak: streak(recent, "L"),
    stats: usableStats(f, event.date, fight.rules),
  };
}

function side(score: number, a: Profile, b: Profile) {
  return score >= 0 ? { w: a, l: b } : { w: b, l: a };
}

function signals(fight: Fight, event: Event, A: Profile, B: Profile): Signal[] {
  const out: Signal[] = [];
  const push = (id: SignalId, model: SubModel, label: string, score: number | null, reason?: (w: Profile, l: Profile) => { title: string; text: string }) => {
    const s = score === null || !Number.isFinite(score) ? null : clamp(score);
    const r = s !== null && Math.abs(s) >= 0.03 && reason ? reason(side(s, A, B).w, side(s, A, B).l) : undefined;
    out.push({ id, model, label, score: s, weight: WEIGHTS[id], reason: r });
  };

  // 1. Quality of opposition — who they beat, and the whole schedule.
  {
    const sa = A.schedule, sb = B.schedule;
    const wa = mean(A.winQ), wb = mean(B.winQ);
    let score: number | null = null;
    if (sa && sb) score = (sa.score - sb.score) * 3;
    if (wa !== null && wb !== null && A.winQ.length >= 2 && B.winQ.length >= 2) {
      const beat = (wa - wb) * 2.5;
      score = score === null ? beat : score * 0.6 + beat * 0.4;
    }
    push("opposition", "resume", "Quality of opposition", score, (w, l) => {
      const ww = mean(w.winQ), lw = mean(l.winQ);
      return {
        title: "Beat the better opposition",
        text:
          ww !== null && lw !== null
            ? `Opponents ${w.f.name} beat (last 10) had a ${pct(ww)} win rate going in; ${l.f.name}'s had ${pct(lw)}.`
            : `${w.f.name}'s last-10 schedule is tougher by opponents' pre-fight records.`,
      };
    });
  }

  // 1b. Head-to-head — if they've met, the latest meeting matters most.
  {
    const na = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
    const meetings = A.all.filter((x) => na(x.opponent) === na(B.f.name) && (x.result === "W" || x.result === "L"));
    const score = meetings.length
      ? meetings.reduce((s, x, i) => s + (x.result === "W" ? 1 : -1) * Math.pow(0.5, i), 0) / meetings.reduce((s, _, i) => s + Math.pow(0.5, i), 0) * 0.9
      : null;
    if (score !== null)
      push("h2h", "resume", "Head-to-head", score, (w, l) => {
        const wins = meetings.filter((x) => (w === A ? x.result === "W" : x.result === "L")).length;
        const last = meetings[0];
        return {
          title: "Won the last meeting",
          text: `They've met ${meetings.length === 1 ? "once" : `${meetings.length} times`} (${w.f.name} ${wins}-${meetings.length - wins}). Latest: ${last.date.slice(0, 4)}, ${(last.result === "W") === (w === A) ? w.f.name : l.f.name} by ${last.method.split(/\s*[-(]/)[0].trim()}.`,
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
    push("losses", "resume", "Who beat them", enough ? (bad(B) - bad(A)) * 3 : null, (w, l) => {
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

  // 5. Striking & grappling rates (official aggregates).
  {
    const a = A.stats, b = B.stats;
    let score: number | null = null;
    let text = "";
    if (a && b) {
      const parts: { s: number; w: number }[] = [];
      if (a.slpm !== undefined && a.sapm !== undefined && b.slpm !== undefined && b.sapm !== undefined)
        parts.push({ s: ((a.slpm - a.sapm) - (b.slpm - b.sapm)) / 4, w: 0.5 });
      if (a.tdPer15 !== undefined && b.tdPer15 !== undefined && a.tdDefense !== undefined && b.tdDefense !== undefined)
        parts.push({ s: (a.tdPer15 * (1 - b.tdDefense / 100) - b.tdPer15 * (1 - a.tdDefense / 100)) / 2.5, w: 0.3 });
      if (a.kdPer15 !== undefined && b.kdPer15 !== undefined) parts.push({ s: (a.kdPer15 - b.kdPer15) / 1.5, w: 0.1 });
      if (a.subPer15 !== undefined && b.subPer15 !== undefined) parts.push({ s: (a.subPer15 - b.subPer15) / 2.5, w: 0.1 });
      if (parts.length >= 2) {
        const sample = Math.min(1, Math.min(A.topLevel, B.topLevel) / 6);
        score = (parts.reduce((s, p) => s + clamp(p.s) * p.w, 0) / parts.reduce((s, p) => s + p.w, 0)) * (0.4 + 0.6 * sample);
      }
    }
    push("style", "matchup", "Striking & grappling", score, (w, l) => {
      const ws = w.stats, ls = l.stats;
      if (ws?.tdPer15 !== undefined && ls?.tdDefense !== undefined && ws.tdPer15 >= 1.5 && (ls.tdPer15 ?? 0) < ws.tdPer15)
        text = `${w.f.name} lands ${ws.tdPer15} takedowns per 15 min; ${l.f.name} stops ${ls.tdDefense}% of attempts.`;
      else if (ws?.slpm !== undefined && ws.sapm !== undefined && ls?.slpm !== undefined && ls.sapm !== undefined)
        text = `Strikes landed minus absorbed per minute: ${w.f.name} ${(ws.slpm - ws.sapm).toFixed(1)}, ${l.f.name} ${(ls.slpm - ls.sapm).toFixed(1)}.`;
      else text = `${w.f.name} has the better official striking/grappling rates.`;
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
    push("finish", "matchup", "Finish threat vs durability", score, (w, l) => ({
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
    push("distance", "matchup", "Late-round results", ok ? (rate(A.s.long) - rate(B.s.long)) * (fight.rounds > 3 ? 1.2 : 0.9) : null, (w, l) => ({
      title: fight.rounds > 3 ? "Better over 5 rounds" : "Better when it goes long",
      text: `In fights reaching round 3: ${w.f.name} ${w.s.longRecord}, ${l.f.name} ${l.s.longRecord}.`,
    }));
  }

  // 9. Momentum — sustained losing streaks are a real decline signal.
  {
    const m = (p: Profile) => Math.min(p.winStreak, 5) * 0.06 - (p.lossStreak >= 2 ? 0.12 + (p.lossStreak - 2) * 0.12 : 0);
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

  // 11. Age curve (gentle after 32, steeper after 36).
  {
    const curve = (age?: number) => (age === undefined ? null : -(Math.max(0, age - 32) * 0.05 + Math.max(0, age - 36) * 0.07));
    const ca = curve(A.f.age), cb = curve(B.f.age);
    push("age", "readiness", "Age curve", ca !== null && cb !== null ? (ca - cb) * 2 : null, (w, l) => ({
      title: "Age curve",
      text: `${l.f.name} is ${l.f.age}; ${w.f.name} is ${w.f.age}.`,
    }));
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

  const z = covered ? known.reduce((s, x) => s + x.score! * x.weight, 0) / covered : 0;
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
  for (const [p, other] of [[A, B], [B, A]] as const) {
    void other;
    if (!p.f.reach) gaps.push(`${p.f.name}: reach not verified`);
    if (!p.f.height) gaps.push(`${p.f.name}: height not verified`);
    if (p.recent.length < 3) gaps.push(`${p.f.name}: fewer than 3 loaded pro fights`);
    if (!p.stats) gaps.push(`${p.f.name}: no official striking/grappling rates`);
    if (!p.schedule) gaps.push(`${p.f.name}: opponent records incomplete`);
  }

  const pendingReason =
    A.recent.length < 2 || B.recent.length < 2
      ? "At least one fighter has fewer than two verified pro fights loaded."
      : evidence < 35
        ? "Too little verified data to make an honest pick yet."
        : undefined;

  let confidence: number | null = null;
  if (pick && !pendingReason) {
    const raw = Math.tanh(2.8 * Math.abs(z)); // 0…1
    const quality = 0.45 + 0.55 * (evidence / 100);
    const consensus = 0.7 + 0.3 * agreement;
    confidence = Math.round(Math.min(90, Math.max(50, 50 + 50 * raw * quality * consensus)));
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
