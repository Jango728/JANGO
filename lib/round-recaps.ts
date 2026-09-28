/**
 * Round-by-round recaps: how each logged bout actually went, round by round, from the post-fight
 * write-ups (LedgerBout.rounds / LedgerBout.recap, see docs/SCHEMA.md). The nightly fills them during
 * each card's 3-day review window; the Track record, the Fight center and fighter profiles show them.
 *
 * No leakage: every "before" helper keeps only bouts from cards dated strictly before the given date,
 * so a pre-fight view never sees the fight it is about. The engine does NOT read these directly — the
 * lessons reach it through the scouting notes derived from them (lib/scouting.ts, also dated), and any
 * direct engine signal would first need a backtest.
 */
import { ledgers, sameFighter, sidePicked } from "./ledger";
import type { Ledger, LedgerBout } from "./ledger-types";

export type RoundRow = NonNullable<LedgerBout["rounds"]>[number];
export type Recap = NonNullable<LedgerBout["recap"]>;

/** One logged bout with a round-by-round recap, seen from one fighter's side. */
export type FighterRecap = {
  ledger: Ledger;
  bout: LedgerBout;
  date: string;
  /** The fighter's corner in the bout. */
  side: "a" | "b";
  opponent: string;
  rounds: RoundRow[];
  recap: Recap | null;
};

const DAY = 86400000;

/** Every logged bout the fighter was in (by exact corner match; namesakes sharing an initial don't cross over). */
function boutsOf(name: string): FighterRecap[] {
  const out: FighterRecap[] = [];
  for (const l of ledgers)
    for (const b of l.results?.bouts ?? []) {
      const side = sidePicked(name, b);
      if (!side) continue;
      out.push({ ledger: l, bout: b, date: l.date, side, opponent: side === "a" ? b.b : b.a, rounds: b.rounds ?? [], recap: b.recap ?? null });
    }
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

/**
 * A fighter's previous round-by-round recaps, newest first: bouts on cards dated strictly before
 * `before` (YYYY-MM-DD) that have at least one recorded round.
 */
export function recapsBefore(name: string, before: string): FighterRecap[] {
  return boutsOf(name).filter((x) => x.date < before && x.rounds.length > 0);
}

/**
 * The ledger bout behind one fight-history row (same opponent, card within 2 days of the row's date),
 * or null. Returned whether or not it has rounds yet, so callers can show a pending recap too.
 */
export function recapForHistoryRow(name: string, date: string, opponent: string): FighterRecap | null {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return null;
  return boutsOf(name).find((x) => Math.abs(Date.parse(x.date) - t) <= 2 * DAY && sameFighter(x.opponent, opponent)) ?? null;
}

/** Last day of a card's review window: the review's followUpUntil, else the event date + 3 days. */
export const followUpFor = (l: Pick<Ledger, "date" | "review">) =>
  l.review?.followUpUntil ?? new Date(Date.parse(l.date + "T12:00:00Z") + 3 * DAY).toISOString().slice(0, 10);

/** True when the bout ended inside the distance (the last recorded round carries the finish). */
export const endedByFinish = (b: Pick<LedgerBout, "method" | "round" | "scheduledRounds" | "time">) =>
  b.method === "KO/TKO" || b.method === "Submission" || b.method === "DQ" || (b.method === "No contest" && !(b.round === b.scheduledRounds && b.time === "5:00"));

/** "Rosas" from "Raul Rosas Jr." — the surname used on round-winner chips. */
export const surname = (name: string) => {
  const parts = name.replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i, "").trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
};

/** Rounds won per corner per the write-ups (edge only; even rounds counted separately). */
export function roundTally(rounds: RoundRow[]) {
  return {
    a: rounds.filter((r) => r.edge === "a").length,
    b: rounds.filter((r) => r.edge === "b").length,
    even: rounds.filter((r) => r.edge === "even").length,
  };
}
