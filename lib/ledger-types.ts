export type Method = "KO/TKO" | "Submission" | "Decision" | "Draw" | "No contest" | "DQ";
export type LedgerBout = {
  a: string; b: string; winner: string | null; loser: string | null; method: Method; detail?: string;
  round: number; time: string; scheduledRounds: number; line: number; ou: "Over" | "Under";
  notes: string[]; context?: string; section?: string; contract?: boolean | null;
  /** Official judges' totals (a/b = points for fighter a/b) plus optional media scores. Decisions only. */
  scorecards?: { judges?: { judge?: string; a: number; b: number }[]; media?: { outlet: string; a: number; b: number; url?: string }[]; source?: string };
  /** Post-fight bonuses. fighter omitted for Fight of the Night. */
  bonuses?: { type: "FOTN" | "POTN" | "Other"; fighter?: string }[];
  /** Set when an official result was changed later (overturned to NC, DQ, appeal). from = the original result as first logged. */
  change?: { date: string; from: string; reason: string; source: string };
  /** Display-only market snapshot at fight time (American odds for a/b). Benchmark only; never a model input. */
  closingOdds?: { a: number; b: number; asOf: string; source: string };
  /**
   * How the fight actually went, round by round, from post-fight write-ups (Sherdog play-by-play first,
   * then UFC.com, MMA Junkie / MMA Fighting / Cageside Press round-by-round, MMADecisions for media scores).
   * One entry per round fought. edge = who won the round per the write-ups ("a" | "b" | "even"); score = e.g. "10-9 a", "10-8 b".
   * keyMoments flags the things that predict future fights: knockdowns, rocked-and-recovered, cardio fade, takedowns at will, cuts.
   */
  rounds?: { n: number; summary: string; edge?: "a" | "b" | "even"; score?: string; keyMoments?: string[] }[];
  /** Status of the round-by-round write-up. pending = not published yet, keep checking through the review window. */
  recap?: { status: "complete" | "partial" | "pending" | "unavailable"; checkedAt: string; sources: { label: string; url: string }[]; note?: string };
};
/**
 * A compact fingerprint of what the engine saw when it made a call. Stored with every revision (and with
 * opening picks frozen from Sep 27, 2026 on) so the next freeze can say in plain words what changed.
 */
export type PickInputs = {
  scheduledRounds: number;
  division?: string;
  /** Records as shown on the card, a then b. */
  records: [string | null, string | null];
  /** Date of each fighter's latest logged bout (a then b): a new result shows up here. */
  lastFights: [string | null, string | null];
  /** Scouting notes the engine can use (dated before the event), a then b. */
  scouting: [number, number];
  /** Missed weight, per side: pounds over (0 = on weight). Absent until weigh-ins are logged. */
  missedBy?: [number, number];
  catchweight?: boolean;
  /** Days of notice for a late replacement, and which side took the fight. */
  shortNotice?: { fighter: "a" | "b"; days: number };
  divisionChange?: ("a" | "b")[];
};
/** The calls a pick is made of. Shared by the opening pick and each revision. */
export type PickCall = {
  pick: string | null; confidence: number | null; tier: string | null;
  rounds: { line: number; side: "Over" | "Under" } | null; method: Method | null;
  /** Why pick is null, when it is. */
  naReason?: string;
};
/**
 * One material change to a frozen pick, appended by scripts/freeze.ts before the event locks.
 * Material = the winner pick, the rounds side/line or the method changed, or confidence moved by
 * at least REVISION_CONFIDENCE_STEP points (lib/ledger.ts). Revisions are append-only.
 */
export type PickRevision = PickCall & {
  /** ISO time the revision was made. Always before the card's lock (Ledger.lockAt). */
  at: string;
  /** Engine version that produced this call. */
  engine: string;
  /** Short plain-English why, e.g. "Missed weight by 2.5 lb (Jane Doe)", "Engine 1.2 update (…)". */
  reason: string;
  /** Which calls changed vs the previous pick. */
  changed: ("pick" | "confidence" | "rounds" | "method")[];
  inputs?: PickInputs;
};
export type FrozenPick = {
  a: string; b: string; pick: string | null; confidence: number | null; tier: string | null;
  rounds: { line: number; side: "Over" | "Under" } | null; method: Method | null; scheduledRounds: number;
  evidence?: number; reasons?: string[];
  /** Per-bout freeze time for bouts added after the card was first frozen (written by scripts/freeze.ts). */
  frozenAt?: string;
  /** Why pick is null (e.g. "too little verified data"). Lets the check tell a deliberate N/A from a missing pick. */
  naReason?: string;
  /** Engine version of this opening pick, when it differs from (or was frozen after) the card-level forecast.engine. */
  engine?: string;
  /** Inputs fingerprint of the opening pick (picks frozen from Sep 27, 2026 on). */
  inputs?: PickInputs;
  /**
   * The fields above are the OPENING pick and never change. Later material changes before lock are
   * appended here, oldest first. The FINAL pick = the last revision before lock, else the opening pick.
   */
  revisions?: PickRevision[];
  /** Set when the bout fell off the card before lock: "replaced" (a new opponent, see replacedBy) or "cancelled". The pick stays on record, ungraded. */
  status?: "cancelled" | "replaced";
  statusAt?: string;
  statusNote?: string;
  replacedBy?: { a: string; b: string };
  /** On a replacement bout: the bout it replaced. */
  replaces?: { a: string; b: string };
  /** Short plain-English context for the opening pick, e.g. "Replacement opponent (short notice, 9 days)". */
  note?: string;
};
export type MissCause = "data" | "style-read" | "variance" | "model";
export type Review = {
  status: "initial" | "follow-up" | "final";
  reviewedAt: string;
  followUpUntil: string;
  lessons: string[];
  bouts: { a: string; b: string; cause?: MissCause; note: string }[];
  modelChanges?: string[];
  /** Scouting pass for this card: when it was done and which fighters deliberately got no note (with why). Every other fighter on a finished bout should have a note in data/scouting.json dated the event day. */
  scouting?: { checkedAt: string; noNote: { fighter: string; reason: string }[] };
};
export type Ledger = {
  eventId: string; title: string; date: string; promotion: "UFC" | "DWCS" | "PFL" | "ACA" | "OKTAGON";
  /** When picks lock (ISO, UTC): the card's first listed start time in Toronto, or midnight Toronto on the event date if no time is listed. Written by scripts/freeze.ts. No revisions at or after this. */
  lockAt?: string;
  forecast: { engine: string; frozenAt: string; basis: string; bouts: FrozenPick[] } | null;
  results: { checkedAt: string; live?: boolean; updatedAt?: string; sources: { label: string; url: string }[]; bouts: LedgerBout[] } | null;
  review: Review | null;
};
