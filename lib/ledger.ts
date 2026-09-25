import { LEDGERS } from "./ledger-index";
import type { FrozenPick, Ledger, LedgerBout } from "./ledger-types";

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
  if (last(ta) === last(tb) && (ta[0][0] === tb[0][0] || ta.some((w) => tb.includes(w) && w.length > 3))) return true;
  // Nickname forms: "Patricio Pitbull" vs 'Patricio "Pitbull" Freire'.
  const raw = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  const ra = raw(x), rb = raw(y);
  return ra[0] === rb[0] && ra.slice(1).some((w) => w.length > 3 && rb.slice(1).includes(w));
}
export const sameBout = (p: { a: string; b: string }, r: { a: string; b: string }) =>
  (sameFighter(p.a, r.a) && sameFighter(p.b, r.b)) || (sameFighter(p.a, r.b) && sameFighter(p.b, r.a));

export type Scored = {
  ledger: Ledger;
  bout: LedgerBout;
  forecast: FrozenPick | null;
  winner: boolean | null;
  rounds: boolean | null;
  method: boolean | null;
};

export function scoredBouts(l: Ledger): Scored[] {
  return (l.results?.bouts ?? []).map((bout) => {
    const forecast = l.forecast?.bouts.find((f) => sameBout(f, bout)) ?? null;
    const decided = !!bout.winner && !["Draw", "No contest"].includes(bout.method);
    return {
      ledger: l,
      bout,
      forecast,
      winner: forecast?.pick && decided ? sameFighter(forecast.pick, bout.winner!) : null,
      rounds: forecast?.rounds ? forecast.rounds.side === bout.ou : null,
      method: forecast?.method && decided ? forecast.method === bout.method : null,
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
export function performance(rows: Scored[] = allScored) {
  const band = (lo: number, hi: number) => rows.filter((r) => r.forecast?.confidence != null && r.forecast.confidence >= lo && r.forecast.confidence < hi);
  const brierRows = rows.filter((r) => r.winner !== null && r.forecast?.confidence != null);
  const brier = brierRows.length
    ? brierRows.reduce((s, r) => s + (r.winner ? 1 - r.forecast!.confidence! / 100 : r.forecast!.confidence! / 100) ** 2, 0) / brierRows.length
    : null;
  return {
    winner: tally(rows.map((r) => r.winner)),
    rounds: tally(rows.map((r) => r.rounds)),
    method: tally(rows.map((r) => r.method)),
    ufc: tally(rows.filter((r) => r.ledger.promotion === "UFC").map((r) => r.winner)),
    dwcs: tally(rows.filter((r) => r.ledger.promotion === "DWCS").map((r) => r.winner)),
    bands: [
      { label: "Coin flip · 50–54", ...tally(band(50, 55).map((r) => r.winner)) },
      { label: "Slight · 55–62", ...tally(band(55, 63).map((r) => r.winner)) },
      { label: "Solid · 63–71", ...tally(band(63, 72).map((r) => r.winner)) },
      { label: "Strong · 72–81", ...tally(band(72, 82).map((r) => r.winner)) },
      { label: "Exceptional · 82+", ...tally(band(82, 101).map((r) => r.winner)) },
    ],
    brier: brier === null ? null : Math.round(brier * 1000) / 1000,
    alwaysOver: tally(rows.filter((r) => r.rounds !== null).map((r) => r.bout.ou === "Over")),
  };
}
