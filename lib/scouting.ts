/**
 * Scouting notes: permanent lessons from post-fight reviews (round-by-round reports,
 * scorecards, recaps, and Suleman's own fight notes). A note only counts for fights
 * AFTER its date, so backtests never see the future.
 */
import raw from "@/data/scouting.json";

export type ScoutTag =
  | "cardio-fade"
  | "five-round-proven"
  | "td-vulnerable"
  | "td-offense"
  | "sub-threat"
  | "chin-concern"
  | "durable"
  | "power"
  | "discipline-risk"
  | "slow-starter"
  | "dq-loss"
  | "dq-win";

export type ScoutNote = {
  fighter: string;
  date: string;
  event: string;
  tags: ScoutTag[];
  kind: "strength" | "weakness" | "context";
  note: string;
  source: string;
};

export const SCOUT_TAG_LABEL: Record<ScoutTag, string> = {
  "cardio-fade": "Gas-tank concern",
  "five-round-proven": "Proven over 5 rounds",
  "td-vulnerable": "Gets taken down",
  "td-offense": "Dominant wrestling",
  "sub-threat": "Submission threat",
  "chin-concern": "Chin concern",
  durable: "Durable",
  power: "Finishing power",
  "discipline-risk": "Foul / discipline risk",
  "slow-starter": "Slow starter",
  "dq-loss": "DQ loss — not a real loss",
  "dq-win": "DQ win — not a real win",
};

const NOTES: ScoutNote[] = ((raw as { notes: ScoutNote[] }).notes ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));

/** Notes for a fighter, newest first. Pass a date to keep only notes learned before it. */
export function scoutNotes(fighterId: string, before?: string): ScoutNote[] {
  return NOTES.filter((n) => n.fighter === fighterId && (!before || n.date < before));
}

export function scoutTags(fighterId: string, before?: string): Set<ScoutTag> {
  return new Set(scoutNotes(fighterId, before).flatMap((n) => n.tags));
}
