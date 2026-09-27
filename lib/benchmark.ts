/**
 * "Vs market" scoreboard — EVALUATION ONLY. Odds never enter any model; here they are the
 * honest benchmark: how often the betting favourite won on the same bouts we picked, and how
 * our final frozen picks (last revision before lock) did when we disagreed with the market.
 *
 * Odds source per bout: the ledger's closingOdds (logged at fight time) first, then the seed
 * card's display odds. Bouts without odds, without a frozen pick, or without a decided winner
 * (draw / no contest) are left out. A pick'em line (no favourite) counts for our record but
 * not for the market's.
 */
import { SEED_EVENTS, SEED_FIGHTERS } from "./data";
import { ledgerLockAt, ledgers, sameBout, sidePicked, withFinal, type LedgerPromotion } from "./ledger";
import type { Ledger, LedgerBout } from "./ledger-types";

/** De-vigged probability that side A wins, from American odds for A and B. null if the line is malformed. */
export function impliedProbability(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) < 100 || Math.abs(b) < 100) return null;
  const imp = (n: number) => (n < 0 ? -n / (-n + 100) : 100 / (n + 100));
  const x = imp(a), y = imp(b);
  return x / (x + y);
}

export type MarketRow = {
  eventId: string;
  title: string;
  date: string;
  promotion: LedgerPromotion;
  a: string;
  b: string;
  winner: string;
  pick: string;
  confidence: number | null;
  /** Market probability for our pick (0–1, de-vigged). */
  marketProbForPick: number;
  /** The market favourite's name, or null for a pick'em. */
  favourite: string | null;
  agreed: boolean | null;
  oursHit: boolean;
  marketHit: boolean | null;
  oddsSource: "closing" | "display";
};

export type Scoreline = { n: number; hit: number; pct: number | null };
export type MarketBenchmark = {
  /** Decided bouts with odds and a frozen pick. */
  bouts: number;
  /** Our frozen picks on those bouts. */
  ours: Scoreline;
  /** The market favourite on the same bouts (pick'em lines excluded). */
  market: Scoreline;
  /** Bouts where we picked the favourite: how often we were right. */
  agreed: Scoreline;
  /** Bouts where we picked the underdog: our record, and how often the favourite won instead. */
  disagreed: Scoreline & { marketHit: number };
  /** Mean Brier score (lower is better) of our stated confidence vs the market's implied probability, same bouts. */
  brier: { ours: number | null; market: number | null };
  rows: MarketRow[];
};

const line = (hit: number, n: number): Scoreline => ({ n, hit, pct: n ? Math.round((hit / n) * 100) : null });

function oddsFor(l: Ledger, bout: LedgerBout): { a: number; b: number; source: MarketRow["oddsSource"] } | null {
  if (bout.closingOdds) return { a: bout.closingOdds.a, b: bout.closingOdds.b, source: "closing" };
  const e = SEED_EVENTS.find((x) => x.id === l.eventId);
  const f = e?.fights.find((x) => x.odds && SEED_FIGHTERS[x.a] && SEED_FIGHTERS[x.b] && sameBout({ a: SEED_FIGHTERS[x.a].name, b: SEED_FIGHTERS[x.b].name }, bout));
  if (!f?.odds) return null;
  // Seed odds are stored in the card's a/b order; re-orient to the ledger bout's a/b.
  const sameOrder = sidePicked(SEED_FIGHTERS[f.a].name, bout) === "a";
  return { a: sameOrder ? f.odds.a : f.odds.b, b: sameOrder ? f.odds.b : f.odds.a, source: "display" };
}

/** Market benchmark over every finished ledger card (or one promotion). */
export function marketBenchmark(promotion?: LedgerPromotion | null): MarketBenchmark {
  const rows: MarketRow[] = [];
  for (const l of ledgers) {
    if (promotion && l.promotion !== promotion) continue;
    if (!l.forecast || !l.results) continue;
    for (const bout of l.results.bouts) {
      if (!bout.winner || bout.method === "Draw" || bout.method === "No contest") continue;
      // Grade the FINAL pick (last revision before lock), same as the headline record.
      const frozen = l.forecast.bouts.filter((x) => sameBout(x, bout)).sort((x, y) => Number(!!x.status) - Number(!!y.status))[0];
      const fc = frozen ? withFinal(frozen, ledgerLockAt(l)) : null;
      if (!fc?.pick) continue;
      const odds = oddsFor(l, bout);
      const pA = odds ? impliedProbability(odds.a, odds.b) : null;
      if (!odds || pA === null) continue;
      const pickSide = sidePicked(fc.pick, bout), winSide = sidePicked(bout.winner, bout);
      if (!pickSide || !winSide) continue;
      const favSide = pA > 0.5 ? "a" : pA < 0.5 ? "b" : null;
      rows.push({
        eventId: l.eventId, title: l.title, date: l.date, promotion: l.promotion, a: bout.a, b: bout.b,
        winner: bout.winner, pick: fc.pick, confidence: fc.confidence,
        marketProbForPick: pickSide === "a" ? pA : 1 - pA,
        favourite: favSide ? bout[favSide] : null,
        agreed: favSide ? favSide === pickSide : null,
        oursHit: pickSide === winSide,
        marketHit: favSide ? favSide === winSide : null,
        oddsSource: odds.source,
      });
    }
  }
  const withFav = rows.filter((r) => r.marketHit !== null);
  const agreed = rows.filter((r) => r.agreed === true), disagreed = rows.filter((r) => r.agreed === false);
  const conf = rows.filter((r) => r.confidence !== null);
  const brierOurs = conf.length ? conf.reduce((s, r) => s + ((r.oursHit ? 1 : 0) - r.confidence! / 100) ** 2, 0) / conf.length : null;
  const brierMkt = conf.length ? conf.reduce((s, r) => s + ((r.oursHit ? 1 : 0) - r.marketProbForPick) ** 2, 0) / conf.length : null;
  return {
    bouts: rows.length,
    ours: line(rows.filter((r) => r.oursHit).length, rows.length),
    market: line(withFav.filter((r) => r.marketHit).length, withFav.length),
    agreed: line(agreed.filter((r) => r.oursHit).length, agreed.length),
    disagreed: { ...line(disagreed.filter((r) => r.oursHit).length, disagreed.length), marketHit: disagreed.filter((r) => r.marketHit).length },
    brier: { ours: brierOurs === null ? null : Math.round(brierOurs * 1000) / 1000, market: brierMkt === null ? null : Math.round(brierMkt * 1000) / 1000 },
    rows,
  };
}
