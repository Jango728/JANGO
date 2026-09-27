import { LEDGERS } from "./ledger-index";
import type { FrozenPick, Ledger, LedgerBout, PickCall, PickRevision } from "./ledger-types";

/** Name matching tolerant of nicknames, spacing and accents ("Doo Ho Choi" = "Dooho Choi"). */
const clean = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/"[^"]*"|\([^)]*\)/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const squash = (s: string) => clean(s).replace(/ /g, "");
export function sameFighter(x: string, y: string) {
  if (!x || !y) return false;
  const a = clean(x), b = clean(y);
  if (squash(x) === squash(y) || a.includes(b) || b.includes(a)) return true;
  const ta = a.split(" "), tb = b.split(" ");
  const last = (t: string[]) => t.filter((w) => !["jr", "sr", "ii", "iii"].includes(w)).slice(-1)[0];
  if (last(ta) === last(tb) && (ta[0][0] === tb[0][0] || ta.some((w) => w !== last(ta) && tb.includes(w) && w.length > 3))) return true;
  // Nickname forms: "Patricio Pitbull" vs 'Patricio "Pitbull" Freire'.
  const raw = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  const ra = raw(x), rb = raw(y);
  return ra[0] === rb[0] && ra.slice(1).some((w) => w.length > 3 && rb.slice(1).includes(w));
}
export const sameBout = (p: { a: string; b: string }, r: { a: string; b: string }) =>
  (sameFighter(p.a, r.a) && sameFighter(p.b, r.b)) || (sameFighter(p.a, r.b) && sameFighter(p.b, r.a));

/**
 * Which corner of a bout a name refers to. An exact (accent/space-insensitive) match wins; the
 * tolerant sameFighter match is used only when it points at exactly one corner, so two fighters
 * who share a surname and initial ("Jean Silva" vs "Jose Silva") can't both match.
 */
export function sidePicked(name: string, bout: { a: string; b: string }): "a" | "b" | null {
  if (!name) return null;
  const k = squash(name);
  if (k === squash(bout.a)) return "a";
  if (k === squash(bout.b)) return "b";
  const ma = sameFighter(name, bout.a), mb = sameFighter(name, bout.b);
  return ma && !mb ? "a" : mb && !ma ? "b" : null;
}

/* ---------- pick revisions: lock rule, materiality, final pick ---------- */

/** Picks lock in Toronto time. */
export const LOCK_TZ = "America/Toronto";
/** A confidence move of at least this many points (same side) is a material change worth a revision. */
export const REVISION_CONFIDENCE_STEP = 5;

/** Toronto calendar date (YYYY-MM-DD) of an instant. */
export const torontoDate = (d: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: LOCK_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Toronto's UTC offset in minutes at an instant (−240 in summer, −300 in winter). */
function torontoOffset(utcMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: LOCK_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - utcMs) / 60000;
}

/** A Toronto wall-clock time (date + minutes after midnight) as an ISO UTC instant. DST-safe. */
export function torontoToIso(date: string, minutes = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let t = wall - torontoOffset(wall) * 60000;
  t = wall - torontoOffset(t) * 60000; // second pass settles DST edges
  return new Date(t).toISOString();
}

/**
 * Earliest Eastern start time in a card's free-text time ("Prelims 5pm ET · main card 8pm ET",
 * "Main card · 5:00 PM ET"), as minutes after midnight. Times in other zones are ignored. null if none.
 */
export function earliestStartMinutes(time?: string | null): number | null {
  if (!time) return null;
  let best: number | null = null;
  for (const m of time.matchAll(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*(?:ET|EDT|EST)\b/gi)) {
    const h = Number(m[1]) % 12 + (m[3].toLowerCase() === "p" ? 12 : 0);
    const mins = h * 60 + Number(m[2] ?? 0);
    if (best === null || mins < best) best = mins;
  }
  return best;
}

/**
 * THE LOCK RULE: picks lock when the card starts — the event date plus its earliest listed start
 * time, in Toronto time. With no usable time, the lock is midnight Toronto at the start of the event
 * date (conservative: nothing changes on fight day). No revisions at or after the lock.
 */
export const lockAtFor = (date: string, time?: string | null) => torontoToIso(date, earliestStartMinutes(time) ?? 0);
/** A ledger's lock instant: the stored lockAt, else midnight Toronto on the event date. */
export const ledgerLockAt = (l: Pick<Ledger, "date" | "lockAt">) => l.lockAt ?? lockAtFor(l.date);
export const isLocked = (l: Pick<Ledger, "date" | "lockAt">, now: Date = new Date()) => now.getTime() >= Date.parse(ledgerLockAt(l));

const callOf = (x: PickCall): PickCall => ({ pick: x.pick, confidence: x.confidence, tier: x.tier, rounds: x.rounds, method: x.method, ...(x.naReason ? { naReason: x.naReason } : {}) });

/**
 * Which calls differ materially between two picks: winner side (incl. pick ↔ N/A), rounds side or
 * line, method, or a confidence move of ≥ REVISION_CONFIDENCE_STEP on the same side. Empty = not material.
 */
export function materialChanges(prev: PickCall, next: PickCall, bout: { a: string; b: string }): PickRevision["changed"] {
  const side = (p: string | null) => (p ? sidePicked(p, bout) ?? p : null);
  const out: PickRevision["changed"] = [];
  const pickChanged = side(prev.pick) !== side(next.pick);
  if (pickChanged) out.push("pick");
  else if (prev.confidence != null && next.confidence != null && Math.abs(next.confidence - prev.confidence) >= REVISION_CONFIDENCE_STEP) out.push("confidence");
  if ((prev.rounds?.side ?? null) !== (next.rounds?.side ?? null) || (prev.rounds?.line ?? null) !== (next.rounds?.line ?? null)) out.push("rounds");
  if ((prev.method ?? null) !== (next.method ?? null)) out.push("method");
  return out;
}

/** Revisions that count: made before the lock, in time order. */
export const revisionsBeforeLock = (fp: FrozenPick, lockAt: string) =>
  (fp.revisions ?? []).filter((r) => Date.parse(r.at) < Date.parse(lockAt)).sort((x, y) => x.at.localeCompare(y.at));

/** The OPENING call (first freeze). Never changes. */
export const openingCall = (fp: FrozenPick): PickCall => callOf(fp);

/** The FINAL call: the last revision before lock, else the opening pick. This is what the headline record grades. */
export function finalCall(fp: FrozenPick, lockAt: string): PickCall & { revision: PickRevision | null } {
  const revs = revisionsBeforeLock(fp, lockAt);
  const last = revs[revs.length - 1] ?? null;
  return { ...callOf(last ?? fp), revision: last };
}

/** The frozen record with its FINAL call in place of the opening one (opening stays available as the raw record). */
export function withFinal(fp: FrozenPick, lockAt: string): FrozenPick {
  const { revision, ...call } = finalCall(fp, lockAt);
  if (!revision) return fp;
  const out: FrozenPick = { ...fp, ...call };
  if (!call.naReason) delete out.naReason;
  return out;
}

/** Current bouts on a frozen card (cancelled / replaced ones stay in the file but are not live picks). */
export const activeBouts = (l: Ledger) => (l.forecast?.bouts ?? []).filter((b) => !b.status);

/** Everything the bout page needs to show a pick's history. null when the bout has no frozen pick. */
export function pickHistory(eventId: string, a: string, b: string) {
  const l = ledgerFor(eventId);
  const fp = l?.forecast?.bouts.filter((x) => sameBout(x, { a, b })).sort((x, y) => Number(!!x.status) - Number(!!y.status))[0];
  if (!l || !fp) return null;
  const lockAt = ledgerLockAt(l);
  const revisions = revisionsBeforeLock(fp, lockAt);
  return {
    ledger: l,
    frozen: fp,
    lockAt,
    locked: isLocked(l),
    openedAt: fp.frozenAt ?? l.forecast!.frozenAt,
    openingEngine: fp.engine ?? l.forecast!.engine,
    opening: openingCall(fp),
    final: finalCall(fp, lockAt),
    revisions,
  };
}

type Grade = { winner: boolean | null; rounds: boolean | null; method: boolean | null };
function grade(fc: FrozenPick | null, bout: LedgerBout): Grade {
  const decided = !!bout.winner && !["Draw", "No contest"].includes(bout.method);
  const pickSide = fc?.pick ? sidePicked(fc.pick, bout) : null;
  const winSide = decided ? sidePicked(bout.winner!, bout) : null;
  return {
    // Draws and no contests are N/A for the winner and method. A DQ is graded like any result.
    winner: pickSide && winSide ? pickSide === winSide : null,
    // No contest: the O/U is void (N/A), as a sportsbook would settle it. Draws went the distance and grade normally.
    rounds: fc?.rounds && bout.method !== "No contest" ? fc.rounds.side === bout.ou : null,
    method: fc?.method && decided ? fc.method === bout.method : null,
  };
}

export type Scored = {
  ledger: Ledger;
  bout: LedgerBout;
  /** The FINAL pick (last revision before lock, else the opening pick). Headline grades use this. */
  forecast: FrozenPick | null;
  /** The raw frozen record: its top-level fields are the OPENING pick. */
  opening: FrozenPick | null;
  winner: boolean | null;
  rounds: boolean | null;
  method: boolean | null;
  /** The same grades for the opening pick (transparency). Equal to the final grades when nothing was revised. */
  openingGrade: Grade;
  /** Revisions that counted (before lock). */
  revisions: number;
  /** The final winner pick is a different fighter (or N/A ↔ pick) from the opening one. */
  pickChanged: boolean;
};

export function scoredBouts(l: Ledger): Scored[] {
  const lockAt = ledgerLockAt(l);
  return (l.results?.bouts ?? []).map((bout) => {
    // Prefer a live bout over a cancelled / replaced one with the same pair.
    const opening = l.forecast?.bouts.filter((f) => sameBout(f, bout)).sort((x, y) => Number(!!x.status) - Number(!!y.status))[0] ?? null;
    const forecast = opening ? withFinal(opening, lockAt) : null;
    const revs = opening ? revisionsBeforeLock(opening, lockAt).length : 0;
    const side = (fc: FrozenPick | null) => (fc?.pick ? sidePicked(fc.pick, bout) ?? fc.pick : null);
    return {
      ledger: l,
      bout,
      forecast,
      opening,
      ...grade(forecast, bout),
      openingGrade: grade(opening, bout),
      revisions: revs,
      pickChanged: !!opening && side(opening) !== side(forecast),
    };
  });
}

export const ledgers = [...LEDGERS].sort((a, b) => b.date.localeCompare(a.date));
export const allScored = ledgers.flatMap(scoredBouts);
export const ledgerFor = (eventId: string) => ledgers.find((l) => l.eventId === eventId) ?? null;
export function resultFor(eventId: string, a: string, b: string) {
  const l = ledgerFor(eventId);
  if (!l?.results) return null;
  const bout = l.results.bouts.find((r) => sameBout({ a, b }, r));
  return bout ? scoredBouts(l).find((s) => s.bout === bout)! : null;
}

export type Tally = { n: number; hit: number; pct: number | null };
const tally = (xs: (boolean | null)[]): Tally => {
  const k = xs.filter((x): x is boolean => x !== null);
  const hit = k.filter(Boolean).length;
  return { n: k.length, hit, pct: k.length ? Math.round((hit / k.length) * 100) : null };
};
/**
 * Accuracy summary. basis "final" (default, the headline) grades the final pick; "opening" grades
 * the first freeze on the same bouts, for the "opening vs final" transparency line.
 */
export function performance(rows: Scored[] = allScored, basis: "final" | "opening" = "final") {
  const view = rows.map((r) => ({ r, fc: basis === "final" ? r.forecast : r.opening, g: basis === "final" ? { winner: r.winner, rounds: r.rounds, method: r.method } : r.openingGrade }));
  type V = (typeof view)[number];
  const band = (lo: number, hi: number) => view.filter((v) => v.fc?.confidence != null && v.fc.confidence >= lo && v.fc.confidence < hi);
  const brierRows = view.filter((v) => v.g.winner !== null && v.fc?.confidence != null);
  const brier = brierRows.length
    ? brierRows.reduce((s, v) => s + (v.g.winner ? 1 - v.fc!.confidence! / 100 : v.fc!.confidence! / 100) ** 2, 0) / brierRows.length
    : null;
  // Log-loss of the stated confidence (0.693 = coin flip; lower is better). Confidence is capped 50–90, so no infinities.
  const logLoss = brierRows.length
    ? brierRows.reduce((s, v) => s - Math.log(v.g.winner ? v.fc!.confidence! / 100 : 1 - v.fc!.confidence! / 100), 0) / brierRows.length
    : null;
  const w = (xs: V[]) => tally(xs.map((v) => v.g.winner));
  return {
    winner: w(view),
    rounds: tally(view.map((v) => v.g.rounds)),
    method: tally(view.map((v) => v.g.method)),
    ufc: w(view.filter((v) => v.r.ledger.promotion === "UFC")),
    dwcs: w(view.filter((v) => v.r.ledger.promotion === "DWCS")),
    bands: [
      { label: "Coin flip · 50–54", ...w(band(50, 55)) },
      { label: "Slight · 55–62", ...w(band(55, 63)) },
      { label: "Solid · 63–71", ...w(band(63, 72)) },
      { label: "Strong · 72–81", ...w(band(72, 82)) },
      { label: "Exceptional · 82+", ...w(band(82, 101)) },
    ],
    brier: brier === null ? null : Math.round(brier * 1000) / 1000,
    logLoss: logLoss === null ? null : Math.round(logLoss * 1000) / 1000,
    alwaysOver: tally(view.filter((v) => v.g.rounds !== null).map((v) => v.r.bout.ou === "Over")),
    /** Baseline for the method column: how often "Decision" would have been right on the same graded bouts. */
    alwaysDecision: tally(view.filter((v) => v.g.method !== null).map((v) => v.r.bout.method === "Decision")),
  };
}

/** "Opening picks: x/y; final picks: x/y" on the same graded bouts, plus how many picks were revised or flipped. */
export function openingVsFinal(rows: Scored[] = allScored) {
  return {
    opening: { winner: tally(rows.map((r) => r.openingGrade.winner)), rounds: tally(rows.map((r) => r.openingGrade.rounds)) },
    final: { winner: tally(rows.map((r) => r.winner)), rounds: tally(rows.map((r) => r.rounds)) },
    revised: rows.filter((r) => r.revisions > 0).length,
    changedPicks: rows.filter((r) => r.pickChanged).length,
  };
}

/** Promotions in the order the Track record tabs show them. */
export type LedgerPromotion = Ledger["promotion"];
export const PROMOTION_ORDER: LedgerPromotion[] = ["UFC", "DWCS", "PFL", "ACA", "OKTAGON"];
export const PROMOTION_LABEL: Record<LedgerPromotion, string> = {
  UFC: "UFC",
  DWCS: "Contender Series",
  PFL: "PFL",
  ACA: "ACA",
  OKTAGON: "OKTAGON",
};
export const isLedgerPromotion = (p: unknown): p is LedgerPromotion => typeof p === "string" && (PROMOTION_ORDER as string[]).includes(p);

/** Which promotion a scored row belongs to. */
export const promotionOf = (r: Scored): LedgerPromotion => r.ledger.promotion;

/** Ledgers for one promotion (newest first), or every ledger when none is given. */
export const ledgersFor = (promotion?: LedgerPromotion | null) => (promotion ? ledgers.filter((l) => l.promotion === promotion) : ledgers);

/** Scored rows for one promotion, or all of them when none is given. */
export const scoredFor = (promotion?: LedgerPromotion | null) => (promotion ? allScored.filter((r) => promotionOf(r) === promotion) : allScored);

/** Same shape as performance(), limited to one promotion. No promotion = overall. */
export const performanceFor = (promotion?: LedgerPromotion | null, basis: "final" | "opening" = "final") => performance(scoredFor(promotion), basis);

/** Card counts for a promotion: scored cards, upcoming cards with locked picks, and how many picks are locked. */
export function cardCountsFor(promotion?: LedgerPromotion | null) {
  const ls = ledgersFor(promotion);
  const upcoming = ls.filter((l) => l.forecast && !l.results);
  return {
    scoredCards: ls.filter((l) => l.forecast && l.results).length,
    resultsOnly: ls.filter((l) => !l.forecast && l.results).length,
    upcomingCards: upcoming.length,
    lockedPicks: upcoming.reduce((s, l) => s + activeBouts(l).filter((b) => withFinal(b, ledgerLockAt(l)).pick).length, 0),
  };
}

/** Tabs for the Track record page: only promotions that actually have ledgers. `scored` = fights with a graded winner pick. */
export function promotionTabs() {
  const graded = (rows: Scored[]) => rows.filter((r) => r.winner !== null).length;
  return [
    { id: "All" as const, label: "All", scored: graded(allScored) },
    ...PROMOTION_ORDER.filter((p) => ledgers.some((l) => l.promotion === p)).map((p) => ({ id: p, label: PROMOTION_LABEL[p], scored: graded(scoredFor(p)) })),
  ];
}
