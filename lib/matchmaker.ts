/**
 * Matchmaker: build any UFC fight and run it through the same engine as a real card bout.
 *
 * Fighters come from two places:
 *  - seed profiles (lib/seed.json) — richer: full pro history, verified measurements, scouting notes.
 *    They're merged with any UFC bouts in public/roster/roster.json the seed doesn't have yet, plus
 *    results logged in the ledger (lib/logged-history.ts).
 *  - the UFC roster (public/roster/roster.json, ~1,200 fighters) — converted with lib/roster-profile.ts,
 *    the same conversion the historical backtest validated the engine on (UFC-only histories, opponent
 *    records reconstructed from the roster, per-bout stat rows, round-by-round rows).
 * Everything is "as of today": the synthetic event is dated today (Toronto), and every model only reads
 * bouts strictly before the event date. When the nightly refreshes roster.json the analysis moves with it.
 *
 * This module is only imported by the Matchmaker page, which loads after every seed profile is in memory.
 */
import { useEffect, useState } from "react";
import { SEED_EVENTS, SEED_FIGHTERS } from "./data";
import { DIVISIONS, P4P } from "./rankings";
import { findFighter, rosterSlugFor, seedForSlug } from "./directory";
import { NAME_BY_SLUG, ROSTER_NAMES, normName, slugsForName, useRosterPhoto, type Roster, type RosterFighter } from "./roster";
import { inToCm, mergeRosterRows, rosterPastFight, rosterProfile, rosterStatRows } from "./roster-profile";
import { timelineFor, type WithTimeline } from "./fight-stats";
import { roundRowsFor, roundRowsFromRoster, type RoundsDoc, type WithRounds } from "./round-features";
import { withLoggedResults } from "./logged-history";
import { resultRecord } from "./model";
import type { CombatStats, Event, Fight, Fighter, PastFight } from "./types";
import { divisionByCode, divisionByName, MM_DIVISIONS } from "./breakdown";

// The Breakdown's pure helpers live in lib/breakdown.ts (shared with the Fight center); re-exported here.
export { fmtLongDate, MM_DIVISIONS, divisionByName, divisionByCode, displayStats, RADAR_AXES, radarPercentiles, commonOpponents, recentRows, methodLetter } from "./breakdown";
export type { MMDivision, DisplayStats, RadarAxis, SharedOpponent } from "./breakdown";

// ---------- dates ----------

/** Today's date in Toronto (YYYY-MM-DD), the site's reference time zone. */
export function torontoToday(now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// ---------- divisions ----------

const realDivision = (n?: string | null) => divisionByName(n)?.name;

// ---------- ranks ----------

export type RankChip = { label: string; order: number; kind: "champ" | "interim" | "ranked"; division: string };
export type RankInfo = { chip?: RankChip; p4p?: { list: "men" | "women"; rank: number }; division?: string; champion?: (typeof DIVISIONS)[number]["champion"] };

export function rankInfo(name: string): RankInfo {
  const e = findFighter(name);
  if (!e) return {};
  let chip: RankChip | undefined;
  let champion: RankInfo["champion"];
  for (const r of e.ranks) {
    let c: RankChip | undefined;
    if (r.role === "champion" && !r.division.champion.vacated) {
      c = { label: r.division.champion.interim ? "Interim champ" : "Champion", order: 0, kind: r.division.champion.interim ? "interim" : "champ", division: r.division.name };
      champion = r.division.champion;
    } else if (r.role === "contender" && r.rank) c = { label: `#${r.rank}`, order: r.rank, kind: "ranked", division: r.division.name };
    else if (r.role === "prospect" && r.rank) c = { label: `#${r.rank}`, order: r.rank, kind: "ranked", division: r.division.name };
    if (c && (!chip || c.order < chip.order)) chip = c;
  }
  return { chip, p4p: e.p4p, division: chip?.division ?? e.ranks.find((r) => r.role !== "prospect")?.division.name ?? e.ranks[0]?.division.name, champion };
}

// ---------- candidates (the picker list) ----------

export type Candidate = {
  key: string;
  name: string;
  nickname?: string;
  division: string;
  women: boolean;
  /** UFC record (roster) or the seed's record for fighters the roster doesn't have yet. */
  record: string;
  /** "UFC" when `record` is the UFC record, "Pro" when it's the seed's pro record. */
  recordKind: "UFC" | "Pro";
  lastYear: number;
  slug?: string;
  seedId?: string;
  rank: RankInfo;
  hay: string[];
  full: string;
};

const cache = new Map<string, Candidate[]>();
const ufcCardFighters = () => {
  const out = new Map<string, { division: string; date: string }>();
  for (const e of SEED_EVENTS.filter((x) => x.promotion === "UFC").sort((a, b) => a.date.localeCompare(b.date)))
    for (const f of e.fights) for (const id of [f.a, f.b]) out.set(id, { division: f.division, date: e.date });
  return out;
};
const tokens = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9']+/).map((t) => t.replace(/'/g, "")).filter(Boolean);

/** Every UFC fighter the Matchmaker can use: the roster, plus seed fighters booked by (or fought in) the UFC who aren't in it yet. */
export function candidates(roster: Roster | null): Candidate[] {
  const ck = roster ? "r" + roster.asOf : "n";
  const hit = cache.get(ck);
  if (hit) return hit;
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const [slug, name, nick, wc, year, ufc] of ROSTER_NAMES) {
    const seed = seedForSlug(slug, roster);
    const rank = rankInfo(name);
    let division = rank.division ?? realDivision(wc);
    if (!division) {
      const r = roster?.bySlug.get(slug);
      division = realDivision(r?.history.find((h) => realDivision(h.weightClass))?.weightClass) ?? realDivision(seed?.history.find((h) => realDivision(h.division))?.division) ?? "Lightweight";
    }
    if (seed) seen.add(seed.id);
    out.push({
      key: slug, name, nickname: nick ?? seed?.nickname ?? undefined, division, women: /^women/i.test(division), record: ufc, recordKind: "UFC", lastYear: year,
      slug, seedId: seed?.id, rank, hay: tokens(name + " " + (nick ?? "")), full: normName(name),
    });
  }
  const booked = ufcCardFighters();
  for (const f of Object.values(SEED_FIGHTERS)) {
    if (seen.has(f.id) || rosterSlugFor(f, roster)) continue;
    const card = booked.get(f.id);
    const ufcRows = f.history.filter((h) => h.promotion === "UFC" && (h.rules ?? "MMA") === "MMA");
    if (!card && !ufcRows.length) continue;
    const rank = rankInfo(f.name);
    const division = rank.division ?? realDivision(card?.division) ?? realDivision(ufcRows[0]?.division) ?? realDivision(f.history.find((h) => realDivision(h.division))?.division) ?? "Lightweight";
    const last = [...f.history.map((h) => h.date), card?.date ?? ""].sort().pop() ?? "";
    out.push({
      key: f.id, name: f.name, nickname: f.nickname, division, women: /^women/i.test(division),
      record: f.record || resultRecord(f.history.filter((h) => (h.rules ?? "MMA") === "MMA")), recordKind: "Pro",
      lastYear: Number(last.slice(0, 4)) || 0, seedId: f.id, rank, hay: tokens(f.name + " " + (f.nickname ?? "")), full: normName(f.name),
    });
  }
  cache.set(ck, out);
  return out;
}

const DIV_ORDER = new Map(MM_DIVISIONS.map((d, i) => [d.name, i]));
/** Default order: champions and ranked fighters first, then the most recently active. */
export function candidateSort(a: Candidate, b: Candidate) {
  const ra = a.rank.chip?.order ?? 99, rb = b.rank.chip?.order ?? 99;
  if (ra !== rb) return ra - rb;
  const pa = a.rank.p4p?.rank ?? 99, pb = b.rank.p4p?.rank ?? 99;
  if (pa !== pb) return pa - pb;
  if (a.lastYear !== b.lastYear) return b.lastYear - a.lastYear;
  return a.name.localeCompare(b.name);
}

/** Search + filter. Every query word must start a word of the name/nickname (or appear in the joined name). */
export function searchCandidates(list: Candidate[], query: string, opts: { division?: string | null; women?: boolean | null; exclude?: string | null }) {
  const q = tokens(query);
  const qFull = normName(query);
  const scored: { c: Candidate; s: number }[] = [];
  for (const c of list) {
    if (opts.division && c.division !== opts.division) continue;
    if (opts.women != null && c.women !== opts.women) continue;
    let s = 0;
    if (q.length) {
      const ok = q.every((t) => c.hay.some((h) => h.startsWith(t))) || (qFull.length >= 3 && c.full.includes(qFull));
      if (!ok) continue;
      s = c.full.startsWith(qFull) ? 3 : c.hay[c.hay.length > 1 ? 1 : 0]?.startsWith(q[0]) ? 2 : 1;
    }
    scored.push({ c, s });
  }
  return scored.sort((x, y) => y.s - x.s || candidateSort(x.c, y.c)).map((x) => x.c);
}

// ---------- resolving keys ----------

export type MMRef = { key: string; name: string; slug?: string; seedId?: string };

/** A deep-link / picker key → who it is. Keys are roster slugs, or seed ids for fighters the roster doesn't have. */
export function resolveKey(key: string | null | undefined, roster: Roster | null): MMRef | null {
  if (!key) return null;
  const row = NAME_BY_SLUG.get(key);
  if (row) {
    const seed = seedForSlug(key, roster);
    return { key, name: row[1], slug: key, seedId: seed?.id };
  }
  const f = SEED_FIGHTERS[key];
  if (f) {
    const slug = rosterSlugFor(f, roster);
    return { key: slug ?? key, name: f.name, slug, seedId: f.id };
  }
  return null;
}

/** A display name (rankings) → Matchmaker key. */
export function keyForName(name: string, roster: Roster | null): string | null {
  const s = slugsForName(name);
  if (s.length === 1) return s[0];
  if (s.length > 1) return [...s].sort((a, b) => (NAME_BY_SLUG.get(b)![4] ?? 0) - (NAME_BY_SLUG.get(a)![4] ?? 0))[0];
  const e = findFighter(name);
  return e?.fighter ? (resolveKey(e.fighter.id, roster)?.key ?? null) : null;
}

// ---------- building a Fighter ----------

export type MMContext = { roster: Roster; rounds: RoundsDoc | null; today: string };
export type BuiltFighter = {
  fighter: Fighter;
  ref: MMRef;
  kind: "seed" | "roster";
  /** Honest notes about what this profile does and doesn't cover. */
  notes: string[];
  /** The fighter's own division (ranked division, then the roster's latest, then the seed's). */
  division: string;
  rank: RankInfo;
  /** Target for the site's profile dialog. */
  profileTarget: string;
  /** True when the history holds UFC bouts only. */
  ufcOnly: boolean;
  /** False when only the UFC record is known (no pro record anywhere). */
  proKnown: boolean;
  lastFight?: string;
};

/** "Tucson, USA" → "United States": the champion bios in lib/rankings.ts carry a hometown when the roster has no country. */
function countryFrom(from?: string): string | undefined {
  const c = from?.split(",").pop()?.trim();
  if (!c) return undefined;
  return c === "USA" ? "United States" : c === "UK" ? "United Kingdom" : c;
}
const ufcStatsUrl = (r: RosterFighter) => `http://ufcstats.com/fighter-details/${r.ufcstatsId}`;
function combatStats(r: RosterFighter, asOf: string): CombatStats | undefined {
  const s = r.stats;
  if (!s || s.minutes < 5) return undefined; // tiny samples: leave it to the shrunk as-of rates (and show N/A)
  const v = (x: number | null) => (x === null ? undefined : x);
  return {
    asOf, source: ufcStatsUrl(r), scope: `UFCStats career UFC aggregate · ${s.fights} UFC fights · ${Math.round(s.minutes)} min`,
    slpm: v(s.slpm), sapm: v(s.sapm), strikeAccuracy: v(s.strAcc), strikeDefense: v(s.strDef), tdPer15: v(s.tdPer15), tdAccuracy: v(s.tdAcc),
    tdDefense: v(s.tdDef), subPer15: v(s.subPer15), kdPer15: v(s.kdPer15), controlPer15: s.ctrlPer15 === null ? undefined : Math.round((s.ctrlPer15 / 60) * 100) / 100,
  };
}
const bumpRecord = (record: string | undefined, extra: PastFight[]) => {
  const m = record?.match(/^(\d+)-(\d+)(?:-(\d+))?(.*)$/);
  if (!m || !extra.length) return record;
  const n = (r: string) => extra.filter((x) => x.result === r).length;
  return `${+m[1] + n("W")}-${+m[2] + n("L")}-${+(m[3] ?? 0) + n("D")}${m[4] ?? ""}`;
};

export function buildFighter(ref: MMRef, ctx: MMContext): BuiltFighter | null {
  const { roster, rounds, today } = ctx;
  const bySlug = roster.bySlug;
  const r = ref.slug ? bySlug.get(ref.slug) : undefined;
  const rank = rankInfo(ref.name);
  const notes: string[] = [];
  if (ref.seedId && SEED_FIGHTERS[ref.seedId]) {
    const raw = SEED_FIGHTERS[ref.seedId];
    let f: Fighter = withLoggedResults(raw);
    if (r) {
      const merged = mergeRosterRows(f.history, r.history, (b) => rosterPastFight(b, bySlug));
      const added = merged.filter((x) => x.source === "roster");
      f = {
        ...f,
        history: merged,
        record: f.historyComplete ? f.record : bumpRecord(f.record, added),
        height: f.height ?? inToCm(r.heightIn),
        reach: f.reach ?? inToCm(r.reachIn),
        stance: f.stance ?? r.stance ?? undefined,
        birthDate: f.birthDate ?? r.dob ?? undefined,
        nickname: f.nickname ?? r.nickname ?? undefined,
        country: f.country ?? r.country ?? countryFrom(rank.champion?.from),
        stats: f.stats ?? combatStats(r, roster.asOf),
      };
      if (added.length) notes.push(`${added.length} UFC bout${added.length > 1 ? "s" : ""} from UFCStats added to the verified profile.`);
      // Seed fighters normally use the bundled as-of timelines (same numbers as Fight center); fill them in only when missing.
      const g = f as WithTimeline & WithRounds;
      if (!timelineFor(f)) g.ufcTimeline = rosterStatRows(r.history);
      if (!roundRowsFor(f) && rounds) g.roundTimeline = roundRowsFromRoster(r.slug, r.history as Parameters<typeof roundRowsFromRoster>[1], rounds);
    }
    const ufcBouts = f.history.filter((h) => h.promotion === "UFC" && h.date < today).length;
    if (!ufcBouts) notes.push(`${f.name} hasn't fought in the UFC yet: no UFC striking or wrestling numbers exist, so those parts of the model show N/A.`);
    const division = rank.division ?? realDivision(r?.weightClass) ?? candidates(roster).find((c) => c.key === ref.key)?.division ?? "Lightweight";
    return {
      fighter: f, ref, kind: "seed", notes, division, rank, profileTarget: f.id, ufcOnly: false, proKnown: true,
      lastFight: f.history.filter((h) => h.date < today).sort((a, b) => b.date.localeCompare(a.date))[0]?.date,
    };
  }
  if (!r) return null;
  const base = rosterProfile(r, bySlug, rounds, today);
  const champRecord = rank.champion?.record;
  const e = findFighter(r.name);
  const prospectRecord = e?.ranks.find((x) => x.role === "prospect")?.prospect?.record;
  const pro = r.proRecord ?? champRecord ?? prospectRecord ?? null;
  let f: Fighter = {
    ...base,
    name: r.name,
    nickname: r.nickname ?? undefined,
    country: r.country ?? countryFrom(rank.champion?.from),
    record: pro ?? r.ufcRecord.replace(/\s*\(.*\)$/, ""),
    recordScope: "UFC bouts only · UFCStats",
    recordNote: pro ? "Pro record from UFC.com; fight history is UFC bouts only." : "UFC record only: the pre-UFC record isn't in the roster data.",
    historySource: ufcStatsUrl(r),
    stats: combatStats(r, roster.asOf),
  };
  f = withLoggedResults(f);
  notes.push(pro ? `Pro record ${pro} (UFC.com); the engine reads UFC bouts only for ${r.name}.` : `Only the UFC record (${r.ufcRecord}) is known for ${r.name}; pre-UFC fights aren't in the data, so the résumé reads UFC bouts only.`);
  if (!rounds) notes.push("Round-by-round data didn't load: the round-level factor shows N/A.");
  const division = rank.division ?? realDivision(r.weightClass) ?? realDivision(r.history.find((h) => realDivision(h.weightClass))?.weightClass) ?? "Lightweight";
  return {
    fighter: f, ref, kind: "roster", notes, division, rank, profileTarget: "r:" + r.slug, ufcOnly: true, proKnown: !!pro,
    lastFight: f.history.filter((h) => h.date < today).sort((a, b) => b.date.localeCompare(a.date))[0]?.date,
  };
}

/** The synthetic card + bout the engine runs on. */
export function matchmakerBout(a: Fighter, b: Fighter, division: string, rounds: number, today: string, title: boolean, own?: { a?: string | null; b?: string | null }): { event: Event; fight: Fight } {
  const bout = divisionByName(division)?.limit;
  const up = (d?: string | null) => { const l = divisionByName(d)?.limit; return bout && l ? Math.max(0, bout - l) : 0; };
  const gap = { a: up(own?.a), b: up(own?.b) };
  const fight: Fight = {
    ...(gap.a || gap.b ? { weightGap: gap } : {}),
    id: `mm-${a.id}-${b.id}-${rounds}-${division.toLowerCase().replace(/[^a-z]+/g, "")}`,
    a: a.id, b: b.id, division, rules: "MMA", rounds, section: title ? "Main event · title fight" : "Main event",
    assessments: {}, notes: [], unknowns: [],
  };
  const event: Event = {
    id: "matchmaker", title: "Jango Playz Matchmaker", promotion: "UFC", date: today, location: "Hypothetical", coverage: "Custom matchup",
    source: { label: "Jango Playz Matchmaker", url: "", checked: today }, fights: [fight],
  };
  return { event, fight };
}

// ---------- portraits ----------

const CHAMP_IMG = new Map(DIVISIONS.map((d) => [normName(d.champion.name), d.champion.img]));
/** Portrait for a fighter: seed cut-out, then the champion photo, then the roster's (lazily loaded) photo. */
export function usePortrait(ref: MMRef | null): { src: string | null | undefined; headshot: boolean } {
  const seed = ref?.seedId ? SEED_FIGHTERS[ref.seedId] : undefined;
  const own = seed?.image ?? (ref ? CHAMP_IMG.get(normName(ref.name)) : undefined);
  const photo = useRosterPhoto(own ? null : ref?.slug);
  if (!ref) return { src: null, headshot: false };
  if (own) return { src: own, headshot: false };
  return { src: photo === undefined ? undefined : (photo?.src ?? null), headshot: photo?.kind === "headshot" };
}
/** Small square photo for list rows (bundled seed/champion image or the roster thumb). */
export function thumbFor(c: Candidate, thumbs: Record<string, string> | null): string | null {
  const seed = c.seedId ? SEED_FIGHTERS[c.seedId] : undefined;
  return (c.slug && thumbs?.[c.slug]) || seed?.image || CHAMP_IMG.get(normName(c.name)) || null;
}
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

// ---------- round-by-round file ----------

let roundsP: Promise<RoundsDoc> | null = null;
let roundsV: RoundsDoc | null = null;
export function loadRoundsDoc(): Promise<RoundsDoc> {
  if (!roundsP) {
    roundsP = fetch("roster/rounds.json").then((r) => {
      if (!r.ok) throw new Error("rounds.json: HTTP " + r.status);
      return r.json() as Promise<RoundsDoc>;
    });
    roundsP.then((d) => (roundsV = d)).catch(() => (roundsP = null));
  }
  return roundsP;
}
/** Loads public/roster/rounds.json (round-by-round lines) when enabled. `error` = it failed (the analysis still runs without it). */
export function useRoundsDoc(enabled: boolean): { status: "loading" | "ready" | "error"; doc: RoundsDoc | null } {
  const [s, set] = useState<{ status: "loading" | "ready" | "error"; doc: RoundsDoc | null }>(() => (roundsV ? { status: "ready", doc: roundsV } : { status: "loading", doc: null }));
  useEffect(() => {
    if (!enabled || roundsV) return;
    let live = true;
    loadRoundsDoc().then(
      (d) => live && set({ status: "ready", doc: d }),
      () => live && set({ status: "error", doc: null }),
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return s;
}

// ---------- quick-start suggestions ----------

export type Suggestion = { a: string; b: string; title: string; tag: string; group: "title" | "super" | "contender"; division: string; rounds: 3 | 5; titleFight: boolean };

export function suggestions(roster: Roster | null): Suggestion[] {
  const out: Suggestion[] = [];
  const k = (n: string) => keyForName(n, roster);
  const surname = (n: string) => n.replace(/\s+(Jr\.?|Sr\.?)$/i, "").split(" ").slice(-1)[0];
  const push = (an: string, bn: string, s: Omit<Suggestion, "a" | "b" | "title"> & { title?: string }) => {
    const a = k(an), b = k(bn);
    if (!a || !b || a === b || out.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) return;
    out.push({ a, b, title: s.title ?? `${surname(an)} vs ${surname(bn)}`, ...s });
  };
  for (const d of DIVISIONS) {
    const div = divisionByName(d.name);
    if (!div) continue;
    const champ = d.champion.vacated ? null : d.champion.name;
    const next = d.nextInLine?.name;
    const tag = d.nextInLine?.status === "booked" ? "Booked" : d.nextInLine?.status === "expected" ? "Expected next" : "Next by ranking";
    if (champ && next) push(champ, next, { tag: `${div.short} · ${tag}`, group: "title", division: d.name, rounds: 5, titleFight: true });
    else if (!champ && next && d.top10[0]) push(d.top10[0].name === next ? d.top10[1]?.name ?? next : d.top10[0].name, next, { tag: `${div.short} · Vacant title`, group: "title", division: d.name, rounds: 5, titleFight: true });
    if (champ && d.top10[0] && d.top10[0].name !== next) push(champ, d.top10[0].name, { tag: `${div.short} · Champ vs #1`, group: "title", division: d.name, rounds: 5, titleFight: true });
    if (d.top10[0] && d.top10[1]) push(d.top10[0].name, d.top10[1].name, { tag: `${div.short} · #1 vs #2`, group: "contender", division: d.name, rounds: 3, titleFight: false });
  }
  // Champion vs champion one division apart, heavier division by default.
  const chain = (women: boolean) => DIVISIONS.filter((d) => !!d.women === women && !d.champion.vacated && divisionByName(d.name)).sort((a, b) => a.limit - b.limit);
  for (const women of [false, true]) {
    const c = chain(women);
    for (let i = 0; i + 1 < c.length; i++) {
      const lo = c[i], hi = c[i + 1];
      push(hi.champion.name, lo.champion.name, { tag: `Champ vs champ · ${divisionByName(lo.name)!.short}↔${divisionByName(hi.name)!.short}`, group: "super", division: hi.name, rounds: 5, titleFight: false });
    }
  }
  const [p1, p2] = P4P.men;
  if (p1 && p2) {
    const d1 = rankInfo(p1.name).division, d2 = rankInfo(p2.name).division;
    const heavier = [d1, d2].map((d) => divisionByName(d)).filter(Boolean).sort((x, y) => y!.limit - x!.limit)[0];
    if (heavier) push(p1.name, p2.name, { tag: "P4P #1 vs #2", group: "super", division: heavier.name, rounds: 5, titleFight: false });
  }
  return out;
}

/** A random but sensible matchup: two of a division's champion + top 10, or (sometimes) a champion superfight. */
export function randomMatchup(roster: Roster | null, rng: () => number = Math.random): Suggestion | null {
  const supers = suggestions(roster).filter((s) => s.group === "super");
  if (supers.length && rng() < 0.2) return supers[Math.floor(rng() * supers.length)];
  for (let tries = 0; tries < 12; tries++) {
    const d = DIVISIONS[Math.floor(rng() * DIVISIONS.length)];
    const pool = [...(d.champion.vacated ? [] : [d.champion.name]), ...d.top10.map((c) => c.name)].map((n) => ({ n, k: keyForName(n, roster) })).filter((x) => x.k);
    if (pool.length < 2) continue;
    const i = Math.floor(rng() * pool.length);
    let j = Math.floor(rng() * (pool.length - 1));
    if (j >= i) j++;
    const champ = !d.champion.vacated && (pool[i].n === d.champion.name || pool[j].n === d.champion.name);
    return { a: pool[i].k!, b: pool[j].k!, title: "Random", tag: divisionByName(d.name)?.short ?? d.short, group: "contender", division: d.name, rounds: champ ? 5 : 3, titleFight: champ };
  }
  return null;
}

// ---------- deep links ----------

/** Plain anchor (letters, digits, . _ ~ -) — the only part of a link the published artifact keeps. */
export type MMLink = { a: string; b: string; rounds: 3 | 5; div?: string; title?: boolean };
const SAFE = /^[A-Za-z0-9._-]+$/;
export function encodeLink(l: MMLink): string {
  const d = divisionByName(l.div)?.code;
  return `#mm~${l.a}~${l.b}~${l.rounds}${d ? "~" + d : ""}${l.title ? "~t" : ""}`;
}
export function decodeLink(hash: string): Partial<MMLink> | null {
  if (!hash.startsWith("#mm~")) return null;
  const parts = hash.slice(4).split("~").filter((p) => SAFE.test(p));
  if (!parts.length) return {};
  const out: Partial<MMLink> = {};
  const [a, b, ...rest] = parts;
  if (a && a !== "-") out.a = a;
  if (b && b !== "-") out.b = b;
  for (const p of rest) {
    if (p === "3" || p === "5") out.rounds = +p as 3 | 5;
    else if (p === "t") out.title = true;
    else if (divisionByCode(p)) out.div = divisionByCode(p)!.name;
  }
  return out;
}

// ---------- recent matchups (this browser only) ----------

export type Recent = MMLink & { names: [string, string]; at: number };
const RECENT_KEY = "jp-matchmaker-recent-v1";
export function loadRecents(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.a === "string" && typeof x.b === "string" && Array.isArray(x.names)).slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function saveRecent(r: Recent): Recent[] {
  const list = [r, ...loadRecents().filter((x) => !((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)))].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* private mode / blocked storage: recents just aren't kept */
  }
  return list;
}
export function clearRecents() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
}
