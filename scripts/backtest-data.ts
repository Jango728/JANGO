/**
 * Backtest datasets.
 *  - ledgerSet(): every finished bout in data/ledger that maps to a seed fight (production data).
 *  - historicalSet(): every UFC bout in public/roster/roster.json from 2023-01-01 on where both
 *    fighters have ≥3 prior UFC bouts. Fighters are rebuilt from the roster with UFC-only
 *    histories; each opponent record is that opponent's UFC record strictly before the bout.
 *    Nothing dated on/after the bout is visible to the models (pastBefore / statsAsOf use < date).
 */
import { readFileSync } from "node:fs";
import { SEED_EVENTS, SEED_FIGHTERS } from "../lib/data";
import { ledgers, sameBout, sameFighter, scoredBouts } from "../lib/ledger";
import type { LedgerBout, FrozenPick } from "../lib/ledger-types";
import type { Event, Fight, Fighter, PastFight } from "../lib/types";
import type { StatRow, WithTimeline } from "../lib/fight-stats";
import { roundRowsFromRoster, type RoundsDoc, type WithRounds } from "../lib/round-features";

export type Case = {
  set: "ledger" | "historical";
  id: string;
  date: string;
  fight: Fight;
  event: Event;
  a: Fighter;
  b: Fighter;
  /** Winner's fighter id, or null for draw / NC. */
  winner: string | null;
  /** Actual side of the scheduled line: 1.5 for 3 rounds, 2.5 for 5. null for NC. */
  ou: "Over" | "Under" | null;
  method: "KO/TKO" | "Submission" | "Decision" | "DQ" | "Draw" | "No contest" | "Other";
  frozen?: FrozenPick | null;
  bout?: LedgerBout;
  /** American odds for a / b — BENCHMARK ONLY. Kept off the Fight object so no model can read them. */
  odds?: { a: number; b: number } | null;
};

// ---------- Market benchmark (evaluation only) ----------
const normName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
let ODDS: Map<string, { a: string; b: string; oa: number; ob: number }[]> | null = null;
function oddsIndex() {
  if (ODDS) return ODDS;
  ODDS = new Map();
  try {
    const doc = JSON.parse(readFileSync("scripts/backtest-odds.json", "utf8")) as { rows: [string, string, string, number, number][] };
    for (const [d, a, b, oa, ob] of doc.rows) {
      const k = d;
      if (!ODDS.has(k)) ODDS.set(k, []);
      ODDS.get(k)!.push({ a, b, oa, ob });
    }
  } catch { /* no odds file: benchmark columns show — */ }
  return ODDS;
}
/** Look up historical odds for a bout (±1 day, name-tolerant). Never used by any model. */
export function historicalOdds(date: string, a: string, b: string): { a: number; b: number } | null {
  const idx = oddsIndex();
  const t = Date.parse(date);
  for (const off of [0, -1, 1]) {
    const d = new Date(t + off * 86400000).toISOString().slice(0, 10);
    for (const r of idx.get(d) ?? []) {
      const m = (x: string, y: string) => normName(x) === normName(y) || sameFighter(x, y);
      if (m(r.a, a) && m(r.b, b)) return { a: r.oa, b: r.ob };
      if (m(r.a, b) && m(r.b, a)) return { a: r.ob, b: r.oa };
    }
  }
  return null;
}

const secOf = (round: number, time: string) => {
  const [m, s] = time.split(":").map(Number);
  return (round - 1) * 300 + m * 60 + (s || 0);
};
export const ouOf = (round: number, time: string, rounds: number): "Over" | "Under" => (secOf(round, time) > (rounds >= 5 ? 2.5 : 1.5) * 300 ? "Over" : "Under");

export function ledgerSet(): Case[] {
  const out: Case[] = [];
  for (const l of ledgers) {
    const e = SEED_EVENTS.find((x) => x.id === l.eventId);
    if (!e || !l.results) continue;
    for (const s of scoredBouts(l)) {
      const f = e.fights.find((x) => sameBout({ a: SEED_FIGHTERS[x.a].name, b: SEED_FIGHTERS[x.b].name }, s.bout));
      if (!f) continue;
      const a = SEED_FIGHTERS[f.a], b = SEED_FIGHTERS[f.b];
      const bout = s.bout;
      const nc = bout.method === "No contest";
      const winner = bout.winner && bout.method !== "Draw" && !nc ? (sameFighter(a.name, bout.winner) ? a.id : b.id) : null;
      out.push({
        set: "ledger", id: `${l.eventId}:${f.id}`, date: e.date, fight: f, event: e, a, b, winner,
        ou: nc ? null : ouOf(bout.round, bout.time, bout.scheduledRounds),
        method: bout.method, frozen: s.forecast, bout,
        odds: f.odds && Number.isFinite(f.odds.a) && Number.isFinite(f.odds.b) ? { a: f.odds.a, b: f.odds.b } : null,
      });
    }
  }
  return out;
}

type RRow = { date: string; event: string; opponent: string; opponentSlug: string | null; result: "W" | "L" | "D" | "NC"; method: string; round: number; time: string; weightClass: string; title: boolean; fightId: string; s?: Record<string, number> };
type RFighter = { slug: string; name: string; dob: string | null; heightIn: number | null; reachIn: number | null; stance: string | null; weightClass: string; history: RRow[] };

const DIVS = ["Heavyweight", "Light Heavyweight", "Middleweight", "Welterweight", "Lightweight", "Featherweight", "Bantamweight", "Flyweight", "Women's Featherweight", "Women's Bantamweight", "Women's Flyweight", "Women's Strawweight"];
const ageAt = (dob: string | null, date: string) => (dob ? Math.floor((Date.parse(date) - Date.parse(dob)) / (365.25 * 86400000)) : undefined);

export function historicalSet(from = "2023-01-01", to = "2026-09-20", minPrior = 3): Case[] {
  const roster = JSON.parse(readFileSync("public/roster/roster.json", "utf8")) as { asOf: string; fighters: RFighter[] };
  let rounds: RoundsDoc | null = null;
  try { rounds = JSON.parse(readFileSync("public/roster/rounds.json", "utf8")) as RoundsDoc; } catch { /* no per-round file: round features stay null */ }
  const bySlug = new Map(roster.fighters.map((f) => [f.slug, f]));
  const ufcRecordBefore = (slug: string | null, date: string) => {
    const r = slug ? bySlug.get(slug) : undefined;
    if (!r) return { rec: undefined as string | undefined, n: undefined as number | undefined };
    const rows = r.history.filter((h) => h.date < date && h.result !== "NC");
    const n = (x: string) => rows.filter((h) => h.result === x).length;
    return { rec: `${n("W")}-${n("L")}-${n("D")}`, n: rows.length };
  };
  const fighters = new Map<string, WithTimeline & WithRounds>();
  for (const r of roster.fighters) {
    const history: PastFight[] = r.history.map((h) => {
      const [m, s] = h.time.split(":").map(Number);
      const o = ufcRecordBefore(h.opponentSlug, h.date);
      return {
        opponent: h.opponent, date: h.date, result: h.result, promotion: "UFC", method: h.method, round: h.round, time: h.time,
        minutes: (h.round - 1) * 5 + m + (s || 0) / 60, rules: "MMA", division: h.weightClass, eventName: h.event,
        opponentRecord: o.rec, opponentRecordBasis: "reconstructed", opponentPromotionBouts: o.n, source: "roster",
      };
    });
    const rows: StatRow[] = r.history.filter((h) => h.s && h.s.sec > 0).map((h) => { const s = h.s!; return [h.date, s.sec, s.sl, s.osl, s.tdl, s.tda, s.otdl, s.otda, s.kd, s.okd, s.ctrl, s.octrl, s.sub, s.sa, s.osa]; });
    fighters.set(r.slug, {
      id: r.slug, name: r.name, history, sources: [], historyComplete: false, ufcHistoryComplete: true,
      height: r.heightIn ? Math.round(r.heightIn * 2.54 * 10) / 10 : undefined,
      reach: r.reachIn ? Math.round(r.reachIn * 2.54 * 10) / 10 : undefined,
      stance: r.stance ?? undefined, birthDate: r.dob ?? undefined,
      // Production semantics: `age` is the age on the data date, not at the bout (engine v1.1 used it as-is).
      age: ageAt(r.dob, roster.asOf), ufcTimeline: rows,
      roundTimeline: rounds ? roundRowsFromRoster(r.slug, r.history, rounds) : undefined,
    });
  }
  const seen = new Set<string>();
  const out: Case[] = [];
  for (const r of roster.fighters) {
    for (const h of r.history) {
      if (h.date < from || h.date >= to || seen.has(h.fightId) || !h.opponentSlug) continue;
      seen.add(h.fightId);
      const a = fighters.get(r.slug)!, b = fighters.get(h.opponentSlug);
      if (!b) continue;
      const prior = (f: Fighter) => f.history.filter((x) => x.date < h.date).length;
      if (prior(a) < minPrior || prior(b) < minPrior) continue;
      const sec = h.s?.sec ?? secOf(h.round, h.time);
      // Scheduled rounds aren't in UFCStats: title fights, bouts reaching R4, 25-minute decisions and
      // main events (both surnames in the event name) are 5 rounds; everything else is 3.
      const surname = (n: string) => n.split(" ").slice(-1)[0].toLowerCase();
      const main = h.event.toLowerCase().includes(surname(r.name)) && h.event.toLowerCase().includes(surname(h.opponent));
      const rounds = h.title || h.round >= 4 || sec > 900 || main ? 5 : 3;
      const division = DIVS.includes(h.weightClass) ? h.weightClass : r.weightClass;
      const fight: Fight = { id: h.fightId, a: a.id, b: b.id, division, rules: "MMA", rounds, section: "", assessments: {}, notes: [], unknowns: [] };
      const event: Event = { id: h.event, title: h.event, promotion: "UFC", date: h.date, location: "", coverage: "", source: { label: "", url: "", checked: "" }, fights: [fight] };
      const m = h.method;
      const method: Case["method"] = h.result === "NC" || /overturned/i.test(m) ? "No contest" : h.result === "D" ? "Draw" : /^DQ/.test(m) ? "DQ" : /^KO\/TKO/.test(m) ? "KO/TKO" : /^Submission/.test(m) ? "Submission" : /^Decision/.test(m) ? "Decision" : "Other";
      out.push({
        set: "historical", id: h.fightId, date: h.date, fight, event, a, b,
        winner: h.result === "W" ? a.id : h.result === "L" ? b.id : null,
        ou: method === "No contest" ? null : ouOf(h.round, h.time, rounds), method,
        odds: historicalOdds(h.date, r.name, h.opponent),
      });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}
