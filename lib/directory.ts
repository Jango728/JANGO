/**
 * One lookup for every fighter the site knows about: full profiles from the seed,
 * ranking-only names (champions, top 10, pound-for-pound, Threat radar), and the whole
 * UFC roster (lib/roster.ts). Anyone else (e.g. a regional opponent) resolves to an
 * "unknown opponent" built from the fight histories we have.
 */
import { SEED_EVENTS, SEED_FIGHTERS, PROMOTIONS } from "./data";
import { DIVISIONS, P4P, type Division, type Prospect } from "./rankings";
import { NAME_BY_SLUG, nearDate, normName, peekRoster, slugsForName, tokenKey, looseSameName, type Roster, type RosterBout } from "./roster";
import type { Event, Fight, Fighter, PastFight } from "./types";
import { encodeRef, type FighterRef } from "./fighter-ref";
export { encodeRef, type FighterRef };

export { normName, tokenKey };

export type RankInfo = {
  division: Division;
  role: "champion" | "contender" | "prospect";
  rank?: number;
  prospect?: Prospect;
  move?: string | null;
  by?: number;
};

export type DirectoryEntry = {
  key: string;
  name: string;
  fighter?: Fighter;
  ranks: RankInfo[];
  p4p?: { list: "men" | "women"; rank: number };
};

export const EVENTS: Event[] = SEED_EVENTS.filter((e) => (PROMOTIONS as readonly string[]).includes(e.promotion)).sort((a, b) => a.date.localeCompare(b.date));

const byKey = new Map<string, DirectoryEntry>();
const byTok = new Map<string, DirectoryEntry>();
const entry = (name: string): DirectoryEntry => {
  const key = normName(name);
  let e = byKey.get(key) ?? byTok.get(tokenKey(name));
  if (!e) {
    e = { key, name, ranks: [] };
    byKey.set(key, e);
    if (!byTok.has(tokenKey(name))) byTok.set(tokenKey(name), e);
  }
  return e;
};

for (const f of Object.values(SEED_FIGHTERS)) {
  const e = entry(f.name);
  e.fighter = f;
  e.name = f.name;
}
// Some seed names differ slightly from ranking names (e.g. "Ilimbek Akylbek Uulu"): also index by id.
const byId = new Map(Object.values(SEED_FIGHTERS).map((f) => [f.id, entry(f.name)]));

for (const d of DIVISIONS) {
  entry(d.champion.name).ranks.push({ division: d, role: "champion" });
  d.top10.forEach((c, i) => entry(c.name).ranks.push({ division: d, role: "contender", rank: i + 1, move: c.move, by: c.by }));
  d.prospects.forEach((p) => entry(p.name).ranks.push({ division: d, role: "prospect", rank: p.rank, prospect: p }));
}
(["men", "women"] as const).forEach((list) => P4P[list].forEach((c, i) => (entry(c.name).p4p = { list, rank: i + 1 })));

export const DIRECTORY: DirectoryEntry[] = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));

/** Resolve a seed fighter id or display name to a directory entry (seed profiles + ranking names). */
export function findFighter(idOrName: string): DirectoryEntry | undefined {
  return byId.get(idOrName) ?? byKey.get(normName(idOrName)) ?? byTok.get(tokenKey(idOrName));
}

/** Every tracked bout for a fighter, oldest first, with the event. */
export function boutsFor(fighterId: string): { event: Event; fight: Fight; opponent?: Fighter }[] {
  const out: { event: Event; fight: Fight; opponent?: Fighter }[] = [];
  for (const event of EVENTS)
    for (const fight of event.fights)
      if (fight.a === fighterId || fight.b === fighterId) out.push({ event, fight, opponent: SEED_FIGHTERS[fight.a === fighterId ? fight.b : fight.a] });
  return out;
}

// ---------- seed <-> roster links ----------

const onUfcCard = new Set(EVENTS.filter((e) => e.promotion === "UFC").flatMap((e) => e.fights.flatMap((f) => [f.a, f.b])));
const ufcRows = (f: Fighter) => f.history.filter((h) => h.promotion === "UFC" && (h.rules ?? "MMA") === "MMA");

/** Name-only guess (no roster needed): the unique roster namesake of a seed fighter who has fought in, or is booked by, the UFC. */
export function probableRosterSlug(f: Fighter): string | undefined {
  const c = slugsForName(f.name);
  if (c.length !== 1) return undefined;
  return ufcRows(f).length || onUfcCard.has(f.id) ? c[0] : undefined;
}

let links: { seedToSlug: Map<string, string>; slugToSeed: Map<string, string> } | null = null;
/** Confirmed links: same name AND a UFC bout date that agrees (±2 days). Needs the roster. */
function confirmedLinks(roster: Roster) {
  if (links) return links;
  const seedToSlug = new Map<string, string>(), slugToSeed = new Map<string, string>();
  for (const f of Object.values(SEED_FIGHTERS)) {
    const cands = slugsForName(f.name);
    if (!cands.length) continue;
    const rows = ufcRows(f);
    let hit = cands.find((c) => {
      const r = roster.bySlug.get(c);
      return r && rows.some((u) => r.history.some((h) => nearDate(h.date, u.date)));
    });
    // No UFC rows in the seed yet (fresh signing): accept a unique namesake only when they're on a UFC card we track.
    if (!hit && !rows.length && cands.length === 1 && onUfcCard.has(f.id)) hit = cands[0];
    if (hit && !slugToSeed.has(hit)) {
      seedToSlug.set(f.id, hit);
      slugToSeed.set(hit, f.id);
    }
  }
  links = { seedToSlug, slugToSeed };
  return links;
}

/** The roster slug for a seed fighter: confirmed when the roster has loaded, otherwise the name-only guess. */
export function rosterSlugFor(f: Fighter, roster: Roster | null = peekRoster()): string | undefined {
  return roster ? confirmedLinks(roster).seedToSlug.get(f.id) : probableRosterSlug(f);
}

/** The seed fighter for a roster slug (see rosterSlugFor). */
export function seedForSlug(slug: string, roster: Roster | null = peekRoster()): Fighter | undefined {
  if (roster) {
    const id = confirmedLinks(roster).slugToSeed.get(slug);
    return id ? SEED_FIGHTERS[id] : undefined;
  }
  const row = NAME_BY_SLUG.get(slug);
  const e = row ? findFighter(row[1]) : undefined;
  return e?.fighter && probableRosterSlug(e.fighter) === slug ? e.fighter : undefined;
}

/** Rankings for a roster fighter (by name; ranked names are all current UFC fighters). */
export function ranksForName(name: string): DirectoryEntry | undefined {
  const e = findFighter(name);
  return e && (e.ranks.length || e.p4p) ? e : undefined;
}

// ---------- resolving a click to a profile ----------


export type Resolved =
  | { kind: "seed"; fighter: Fighter; entry: DirectoryEntry }
  | { kind: "roster"; slug: string; name: string; entry?: DirectoryEntry }
  | { kind: "ranked"; entry: DirectoryEntry }
  | { kind: "unknown"; name: string };

export function decodeRef(target: string): FighterRef {
  if (target.startsWith("@{")) {
    try {
      return JSON.parse(target.slice(1)) as FighterRef;
    } catch {
      /* fall through */
    }
  }
  if (target.startsWith("r:")) return { name: NAME_BY_SLUG.get(target.slice(2))?.[1] ?? target.slice(2), slug: target.slice(2) };
  return { name: target, id: target };
}

const seedEntry = (f: Fighter) => byId.get(f.id)!;

/** The row in `owner`'s roster history for the bout on `date` against `name`. */
function ownerRow(roster: Roster, ownerSlug: string, date: string, name: string): RosterBout | undefined {
  const rows = roster.bySlug.get(ownerSlug)?.history.filter((h) => nearDate(h.date, date)) ?? [];
  return rows.find((h) => looseSameName(h.opponent, name)) ?? (rows.length === 1 ? rows[0] : undefined);
}

function ownerSlugOf(vs: string, roster: Roster | null): string | undefined {
  const seed = SEED_FIGHTERS[vs] ?? findFighter(vs)?.fighter;
  if (seed) return rosterSlugFor(seed, roster);
  if (vs.startsWith("r:")) return vs.slice(2);
  return NAME_BY_SLUG.has(vs) ? vs : undefined;
}

/**
 * Resolve a link to a profile. Returns "need-roster" when the answer depends on data that
 * hasn't loaded yet (a namesake or a history row's opponent link); call again once it has.
 *
 * Priority: seed profile > roster fighter > ranking-only entry > unknown opponent. Two people
 * are never merged on name alone when a slug or dated history row says otherwise.
 */
export function resolveRef(ref: FighterRef, roster: Roster | null = peekRoster()): Resolved | "need-roster" {
  if (ref.id && SEED_FIGHTERS[ref.id]) return { kind: "seed", fighter: SEED_FIGHTERS[ref.id], entry: seedEntry(SEED_FIGHTERS[ref.id]) };

  let slug = ref.slug;
  // A history row (owner + date) knows exactly who the opponent was.
  if (slug === undefined && ref.vs && ref.date) {
    const owner = ownerSlugOf(ref.vs, roster);
    if (owner) {
      if (!roster) return "need-roster";
      const row = ownerRow(roster, owner, ref.date, ref.name);
      if (row) slug = row.opponentSlug;
    }
  }

  const named = findFighter(ref.name);
  if (typeof slug === "string") {
    const seed = seedForSlug(slug, roster);
    if (seed) return { kind: "seed", fighter: seed, entry: seedEntry(seed) };
    const row = NAME_BY_SLUG.get(slug);
    if (row) return { kind: "roster", slug, name: row[1], entry: ranksForName(row[1]) };
  }
  if (slug === null) {
    // Known not to be a roster fighter: a seed namesake only counts if that seed fighter isn't a roster fighter either.
    if (named?.fighter && !rosterSlugFor(named.fighter, roster)) return { kind: "seed", fighter: named.fighter, entry: named };
    return { kind: "unknown", name: ref.name };
  }

  if (named?.fighter) return { kind: "seed", fighter: named.fighter, entry: named };

  const cands = slugsForName(ref.name);
  if (cands.length === 1) {
    const seed = seedForSlug(cands[0], roster);
    if (seed) return { kind: "seed", fighter: seed, entry: seedEntry(seed) };
    return { kind: "roster", slug: cands[0], name: NAME_BY_SLUG.get(cands[0])![1], entry: named ?? ranksForName(ref.name) };
  }
  if (cands.length > 1) {
    // Namesakes (e.g. two Bruno Silvas): pick the one who fought on that date, else the most recently active.
    if (ref.date) {
      if (!roster) return "need-roster";
      const on = cands.find((c) => roster.bySlug.get(c)?.history.some((h) => nearDate(h.date, ref.date!)));
      if (on) return { kind: "roster", slug: on, name: NAME_BY_SLUG.get(on)![1], entry: named };
    }
    const best = [...cands].sort((a, b) => (NAME_BY_SLUG.get(b)![4] ?? 0) - (NAME_BY_SLUG.get(a)![4] ?? 0))[0];
    return { kind: "roster", slug: best, name: NAME_BY_SLUG.get(best)![1], entry: named };
  }
  if (named) return { kind: "ranked", entry: named };
  return { kind: "unknown", name: ref.name };
}

// ---------- unknown opponents ----------

export type Appearance = {
  date: string;
  event: string;
  promotion: string;
  /** The tracked fighter they faced. */
  vs: { name: string; id?: string; slug?: string };
  /** Result from the unknown opponent's side. */
  result: PastFight["result"];
  method: string;
  round?: number;
  time?: string;
  /** Their record going into the bout, when the history row carries it. */
  record?: string;
};

const flip = (r: PastFight["result"]): PastFight["result"] => (r === "W" ? "L" : r === "L" ? "W" : r);

/** Every bout we know of for someone outside the roster, from all seed and roster histories. Newest first. */
export function appearancesOf(name: string, roster: Roster | null = peekRoster()): Appearance[] {
  const out: (Appearance & { owner: string })[] = [];
  const same = (n: string) => normName(n) === normName(name) || tokenKey(n) === tokenKey(name);
  for (const f of Object.values(SEED_FIGHTERS)) {
    const owner = rosterSlugFor(f, roster) ?? "seed:" + f.id;
    for (const h of f.history)
      if (same(h.opponent))
        out.push({ owner, date: h.date, event: h.eventName || h.promotion, promotion: h.promotion, vs: { name: f.name, id: f.id }, result: flip(h.result), method: h.method, round: h.round, time: h.time, record: h.opponentRecord });
  }
  if (roster)
    for (const r of roster.bySlug.values())
      for (const h of r.history)
        if (!h.opponentSlug && same(h.opponent) && !out.some((o) => o.owner === r.slug && nearDate(o.date, h.date)))
          out.push({ owner: r.slug, date: h.date, event: h.event, promotion: "UFC", vs: { name: r.name, slug: r.slug }, result: flip(h.result), method: h.method, round: h.round, time: h.time });
  return out.sort((a, b) => b.date.localeCompare(a.date)).map(({ owner: _o, ...a }) => a);
}
