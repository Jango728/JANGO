/**
 * Which pick a bout page shows.
 *
 * - UPCOMING (before the card's lock): the live engine, run as of the event date. It is the newest
 *   information; material changes are logged as revisions by the nightly freeze (lib/ledger.ts).
 * - LOCKED or FINISHED (past ledgerLockAt, or results logged): the FROZEN FINAL pick (withFinal: the last
 *   revision before lock, else the opening pick) — pick, confidence, tier, rounds side/line and method —
 *   exactly what the Track record grades. The live engine only supplies the parts that come from fighter
 *   data (factor edges, evidence, gaps, method split for the frozen winner), all computed with pre-event
 *   data. Reasons come from the frozen record when it saved them for this side; otherwise today's engine
 *   reasons are used only when it agrees with the frozen winner, else a short note says so.
 *
 * Every surface (verdict strip, bout list, card pulse, Prediction tab, Rounds tab, Breakdown, finish film,
 * share text) goes through shownPrediction(), so they can't disagree.
 */
import { tierFor, type EnginePrediction, type Tier } from "./engine";
import { predictFinish, FINISH_LABELS, type FinishMethod, type FinishPrediction } from "./finish";
import type { RoundsPrediction } from "./rounds";
import type { Method, PickCall } from "./ledger-types";
import { pickHistory, resultFor, sidePicked } from "./ledger";
import type { Event, Fight, Fighter } from "./types";

export const METHOD_KEY: Partial<Record<Method, FinishMethod>> = { "KO/TKO": "ko", Submission: "submission", Decision: "decision" };
export const METHOD_NAME: Record<FinishMethod, Method> = { ko: "KO/TKO", submission: "Submission", decision: "Decision" };

export type LockInfo = {
  /** "final" = results are logged; "locked" = past the lock, no results yet. */
  status: "locked" | "final";
  lockAt: string;
  /** Engine version that produced the frozen final call. */
  engine: string;
  /** Today's engine picks the same winner as the frozen pick. */
  agrees: boolean;
  /** The frozen record's own saved reasons are shown. */
  savedReasons: boolean;
  /** Muted note shown where reasons go when they can't be (or aren't only) the frozen ones. */
  note: string | null;
  /** Today's engine lean, for notes. */
  live: { name: string | null; confidence: number | null };
  /** Frozen rounds call equals today's rounds model (side and line). */
  roundsAgree: boolean;
  /** Today's rounds model (the gauge's numbers belong to it). */
  liveRounds: RoundsPrediction | null;
  /** The frozen method equals today's most likely ending for the frozen winner. */
  methodAgree: boolean;
};

export type Shown = { p: EnginePrediction; rounds: RoundsPrediction | null; finish: FinishPrediction | null; lock: LockInfo | null };

const TIERS: Tier[] = ["Coin flip", "Slight lean", "Solid lean", "Strong pick", "Exceptional"];
const asTier = (t: string | null, c: number | null): Tier | null => (t && (TIERS as string[]).includes(t) ? (t as Tier) : c != null ? tierFor(c) : null);
/** "Title: text" → {title, text} (scripts/freeze.ts saves reasons in that form). */
const splitReason = (s: string) => {
  const i = s.indexOf(": ");
  return i > 0 ? { title: s.slice(0, i), text: s.slice(i + 2) } : { title: s, text: "" };
};

/** The live engine's calls in ledger form (for comparing with the latest recorded revision). */
export function liveCall(p: EnginePrediction, rounds: RoundsPrediction | null, finish: FinishPrediction | null, a: Fighter, b: Fighter): PickCall {
  return {
    pick: p.pick === a.id ? a.name : p.pick === b.id ? b.name : null,
    confidence: p.confidence,
    tier: p.tier,
    rounds: rounds ? { side: rounds.side as "Over" | "Under", line: rounds.line } : null,
    method: finish ? METHOD_NAME[finish.method] : null,
  };
}
/** Same winner side, confidence, rounds side/line and method. */
export function sameCall(x: PickCall, y: PickCall, bout: { a: string; b: string }) {
  const side = (c: PickCall) => (c.pick ? sidePicked(c.pick, bout) ?? c.pick : null);
  return side(x) === side(y) && (x.confidence ?? null) === (y.confidence ?? null) && (x.rounds?.side ?? null) === (y.rounds?.side ?? null) && (x.rounds?.line ?? null) === (y.rounds?.line ?? null) && (x.method ?? null) === (y.method ?? null);
}

/**
 * The prediction a bout page shows. `rounds` / `finish` are the live models' outputs (pass them when the
 * surface shows rounds or method; the bout list only needs the winner).
 */
export function shownPrediction(event: Event, fight: Fight, a: Fighter, b: Fighter, live: EnginePrediction, rounds: RoundsPrediction | null = null, finish: FinishPrediction | null = null, now: Date = new Date()): Shown {
  const plain: Shown = { p: live, rounds, finish, lock: null };
  const h = pickHistory(event.id, a.name, b.name);
  if (!h || h.frozen.status) return plain;
  const final = !!resultFor(event.id, a.name, b.name);
  if (!final && now.getTime() < Date.parse(h.lockAt)) return plain;

  const bout = { a: a.name, b: b.name };
  const fc = h.final;
  const side = fc.pick ? sidePicked(fc.pick, bout) : null;
  if (fc.pick && !side) return plain; // can't tell which corner the record means: don't guess
  const pickId = side === "a" ? a.id : side === "b" ? b.id : null;
  const liveSide = live.pick === a.id ? "a" : live.pick === b.id ? "b" : null;
  const agrees = !!side && side === liveSide;
  const openingSide = h.opening.pick ? sidePicked(h.opening.pick, bout) : null;
  // Saved reasons belong to the opening call; they still argue for the final pick only if the side didn't change.
  const saved = side && h.frozen.reasons?.length && openingSide === side ? h.frozen.reasons.map(splitReason) : null;
  const liveName = live.pick === a.id ? a.name : live.pick === b.id ? b.name : null;
  const liveText = liveName ? `${liveName} ${live.confidence}%` : "no pick (not enough verified data)";
  const note = !side
    ? null
    : !saved && !agrees
      ? `Reasons for this locked pick weren't saved; today's model now leans ${liveText}.`
      : saved && !agrees
        ? `Today's model now leans ${liveText}.`
        : null;

  const p: EnginePrediction = {
    ...live,
    version: fc.revision?.engine ?? h.openingEngine,
    pick: pickId,
    confidence: pickId ? fc.confidence : null,
    tier: pickId ? asTier(fc.tier, fc.confidence) : null,
    status: pickId ? "pick" : "pending",
    pendingReason: pickId ? undefined : fc.naReason ?? "No pick was frozen for this bout before the card locked.",
    reasons: saved ?? (agrees ? live.reasons : []),
    counter: agrees ? live.counter : null,
    // Sub-model votes are today's engine; they'd argue with a locked pick they don't share.
    models: agrees ? live.models : [],
  };

  const shownRounds: RoundsPrediction | null = fc.rounds && rounds ? { ...rounds, side: fc.rounds.side, line: fc.rounds.line } : null;
  const roundsAgree = !!fc.rounds && !!rounds && rounds.side === fc.rounds.side && rounds.line === fc.rounds.line;

  const fm = fc.method ? METHOD_KEY[fc.method] : undefined;
  const split = pickId && fm ? (liveSide === side && finish ? finish : predictFinish(fight, a, b, event, pickId)) : null;
  const shownFinish: FinishPrediction | null = split && fm ? { ...split, winnerId: pickId!, method: fm, label: FINISH_LABELS[fm] } : null;

  return {
    p,
    rounds: shownRounds,
    finish: shownFinish,
    lock: {
      status: final ? "final" : "locked",
      lockAt: h.lockAt,
      engine: p.version,
      agrees,
      savedReasons: !!saved,
      note,
      live: { name: liveName, confidence: live.confidence },
      roundsAgree,
      liveRounds: rounds,
      methodAgree: !!split && split.method === fm,
    },
  };
}
