export type Method = "KO/TKO" | "Submission" | "Decision" | "Draw" | "No contest";
export type LedgerBout = {
  a: string; b: string; winner: string | null; loser: string | null; method: Method; detail?: string;
  round: number; time: string; scheduledRounds: number; line: number; ou: "Over" | "Under";
  notes: string[]; context?: string; section?: string; contract?: boolean | null;
};
export type FrozenPick = {
  a: string; b: string; pick: string | null; confidence: number | null; tier: string | null;
  rounds: { line: number; side: "Over" | "Under" } | null; method: Method | null; scheduledRounds: number;
  evidence?: number; reasons?: string[];
};
export type MissCause = "data" | "style-read" | "variance" | "model";
export type Review = {
  status: "initial" | "follow-up" | "final";
  reviewedAt: string;
  followUpUntil: string;
  lessons: string[];
  bouts: { a: string; b: string; cause?: MissCause; note: string }[];
  modelChanges?: string[];
};
export type Ledger = {
  eventId: string; title: string; date: string; promotion: "UFC" | "DWCS" | "PFL" | "ACA";
  forecast: { engine: string; frozenAt: string; basis: string; bouts: FrozenPick[] } | null;
  results: { checkedAt: string; sources: { label: string; url: string }[]; bouts: LedgerBout[] } | null;
  review: Review | null;
};
