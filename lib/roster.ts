/**
 * The UFC roster (every fighter with a UFC bout since 2021 — see docs/ROSTER.md).
 *
 * - names.json (small) is bundled so search and fighter links know all ~1,200 names instantly.
 * - roster.json (4.6 MB) is fetched once, on demand, the first time a profile needs it.
 * - Portraits live in public/roster/photos-<n>.json chunks ({slug: data URI}); a chunk is fetched
 *   only when a photo from it is needed. photos-thumbs.json holds small head crops for search.
 *
 * Everything is loaded with relative URLs (vite base "./"), so it works from any host path and
 * under the artifact CSP (no external hosts).
 */
import { useEffect, useState } from "react";
import NAMES_RAW from "../public/roster/names.json";

// ---------- names ----------

/** Lowercase, accent-free, no "Jr./Sr./II/III", letters and digits only. */
export const normName = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

/** Order-insensitive key: "Zhang Weili" = "Weili Zhang", "Song Yadong" = "Yadong Song". */
export const tokenKey = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, " ")
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .sort()
    .join(" ");

/** Loose "same person's name" test used only for de-duplicating rows that already share a date. */
export function looseSameName(a: string, b: string) {
  if (!a || !b) return false;
  if (normName(a) === normName(b) || tokenKey(a) === tokenKey(b)) return true;
  const ta = tokenKey(a).split(" "), tb = tokenKey(b).split(" ");
  const shared = ta.filter((t) => t.length > 2 && tb.includes(t)).length;
  return shared >= Math.min(2, Math.min(ta.length, tb.length));
}

/** [slug, name, nickname, weightClass, lastFightYear, ufcRecord] */
export type NameRow = [string, string, string | null, string, number, string];
export const ROSTER_NAMES = NAMES_RAW as unknown as NameRow[];
export const NAME_BY_SLUG = new Map(ROSTER_NAMES.map((r) => [r[0], r]));

const byNorm = new Map<string, string[]>();
const byToken = new Map<string, string[]>();
const push = (m: Map<string, string[]>, k: string, slug: string) => {
  if (!k) return;
  const a = m.get(k);
  if (!a) m.set(k, [slug]);
  else if (!a.includes(slug)) a.push(slug);
};
for (const [slug, name] of ROSTER_NAMES) {
  push(byNorm, normName(name), slug);
  push(byToken, tokenKey(name), slug);
}

/** Roster slugs whose name matches (accent/suffix-insensitive, then word-order-insensitive). Several = namesakes. */
export function slugsForName(name: string): string[] {
  return byNorm.get(normName(name)) ?? byToken.get(tokenKey(name)) ?? [];
}

// ---------- full roster ----------

export type RosterStatLine = { sl: number; sa: number; osl: number; osa: number; tdl: number; tda: number; otdl: number; otda: number; sub: number; osub: number; kd: number; okd: number; ctrl: number; octrl: number; sec: number };
export type RosterBout = {
  date: string;
  event: string;
  opponent: string;
  opponentSlug: string | null;
  result: "W" | "L" | "D" | "NC";
  method: string;
  round?: number;
  time?: string;
  weightClass?: string;
  title?: boolean;
  fightId?: string;
  s?: RosterStatLine;
};
export type RosterStats = {
  slpm: number | null;
  sapm: number | null;
  strAcc: number | null;
  strDef: number | null;
  tdPer15: number | null;
  tdAcc: number | null;
  tdDef: number | null;
  subPer15: number | null;
  kdPer15: number | null;
  ctrlPer15: number | null;
  minutes: number;
  fights: number;
};
export type RosterFighter = {
  slug: string;
  name: string;
  nickname: string | null;
  ufcstatsId: string;
  dob: string | null;
  heightIn: number | null;
  reachIn: number | null;
  stance: string | null;
  weightClass: string;
  country: string | null;
  proRecord: string | null;
  ufcRecord: string;
  lastFight: string;
  history: RosterBout[];
  stats: RosterStats;
};
export type Roster = { asOf: string; source: string; bySlug: Map<string, RosterFighter> };

let rosterPromise: Promise<Roster> | null = null;
let rosterValue: Roster | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Fetch roster.json once (or its roster-N.json parts when the build split it). */
export function loadRoster(): Promise<Roster> {
  if (!rosterPromise) {
    rosterPromise = (async () => {
      type Part = { asOf: string; source: string; fighters: RosterFighter[] };
      let doc: Part;
      try {
        doc = await getJson<Part>("roster/roster.json");
      } catch (e) {
        const idx = await getJson<{ asOf: string; source: string; parts: { file: string }[] }>("roster/roster-index.json").catch(() => {
          throw e;
        });
        const parts = await Promise.all(idx.parts.map((p) => getJson<Part>(`roster/${p.file}`)));
        doc = { asOf: idx.asOf, source: idx.source, fighters: parts.flatMap((p) => p.fighters) };
      }
      rosterValue = { asOf: doc.asOf, source: doc.source, bySlug: new Map(doc.fighters.map((f) => [f.slug, f])) };
      return rosterValue;
    })();
    rosterPromise.catch(() => {
      rosterPromise = null; // allow a retry on the next open
    });
  }
  return rosterPromise;
}

/** The roster if it has already loaded (no fetch). */
export const peekRoster = () => rosterValue;

export async function getRosterFighter(slug: string): Promise<RosterFighter | undefined> {
  return (await loadRoster()).bySlug.get(slug);
}

export type RosterState = { status: "loading" | "ready" | "error"; roster: Roster | null };

/** React hook: starts loading the roster when `enabled` and re-renders when it arrives. */
export function useRoster(enabled = true): RosterState {
  const [state, setState] = useState<RosterState>(() => (rosterValue ? { status: "ready", roster: rosterValue } : { status: "loading", roster: null }));
  useEffect(() => {
    if (!enabled || rosterValue) {
      if (rosterValue && state.status !== "ready") setState({ status: "ready", roster: rosterValue });
      return;
    }
    let live = true;
    loadRoster().then(
      (r) => live && setState({ status: "ready", roster: r }),
      () => live && setState({ status: "error", roster: null }),
    );
    return () => {
      live = false;
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

// ---------- division averages (for the Stats tab) ----------

export type StatKey = "slpm" | "sapm" | "strAcc" | "strDef" | "tdPer15" | "tdAcc" | "tdDef" | "subPer15" | "kdPer15" | "ctrlPer15";
export const STAT_KEYS: StatKey[] = ["slpm", "sapm", "strAcc", "strDef", "kdPer15", "tdPer15", "tdAcc", "tdDef", "subPer15", "ctrlPer15"];
const avgCache = new Map<string, { n: number; avg: Partial<Record<StatKey, number>> }>();

/** Mean of each career stat across fighters in a division with at least 25 UFC minutes. */
export function divisionAverages(roster: Roster, weightClass: string) {
  const hit = avgCache.get(weightClass);
  if (hit) return hit;
  const pool = [...roster.bySlug.values()].filter((f) => f.weightClass === weightClass && f.stats.minutes >= 25);
  const avg: Partial<Record<StatKey, number>> = {};
  for (const k of STAT_KEYS) {
    const vals = pool.map((f) => f.stats[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length >= 5) avg[k] = vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  const out = { n: pool.length, avg };
  avgCache.set(weightClass, out);
  return out;
}

// ---------- photos ----------

type PhotoIndex = { chunks: number; fighters: Record<string, [number, "f" | "h"]> };
export type RosterPhoto = { src: string; kind: "full-body" | "headshot" };

let indexPromise: Promise<PhotoIndex> | null = null;
const chunkPromises = new Map<number, Promise<Record<string, string>>>();
let thumbsPromise: Promise<Record<string, string>> | null = null;
const photoCache = new Map<string, RosterPhoto | null>();
let thumbsValue: Record<string, string> | null = null;

export function loadPhotoIndex(): Promise<PhotoIndex> {
  if (!indexPromise) {
    indexPromise = getJson<PhotoIndex>("roster/photos-index.json");
    indexPromise.catch(() => (indexPromise = null));
  }
  return indexPromise;
}

/** A roster fighter's transparent portrait, or null when we have none. Loads one chunk file. */
export async function rosterPhoto(slug: string): Promise<RosterPhoto | null> {
  if (photoCache.has(slug)) return photoCache.get(slug)!;
  const idx = await loadPhotoIndex();
  const hit = idx.fighters[slug];
  if (!hit) {
    photoCache.set(slug, null);
    return null;
  }
  const [chunk, kind] = hit;
  let p = chunkPromises.get(chunk);
  if (!p) {
    p = getJson<Record<string, string>>(`roster/photos-${chunk}.json`);
    chunkPromises.set(chunk, p);
    p.catch(() => chunkPromises.delete(chunk));
  }
  const src = (await p)[slug];
  const out: RosterPhoto | null = src ? { src, kind: kind === "h" ? "headshot" : "full-body" } : null;
  photoCache.set(slug, out);
  return out;
}

export const peekRosterPhoto = (slug: string) => photoCache.get(slug);

/** Hook: the portrait for a slug. `undefined` while loading, `null` when there is none. */
export function useRosterPhoto(slug: string | null | undefined): RosterPhoto | null | undefined {
  const [photo, setPhoto] = useState<RosterPhoto | null | undefined>(() => (slug ? photoCache.get(slug) : null));
  useEffect(() => {
    if (!slug) {
      setPhoto(null);
      return;
    }
    if (photoCache.has(slug)) {
      setPhoto(photoCache.get(slug));
      return;
    }
    let live = true;
    setPhoto(undefined);
    rosterPhoto(slug).then(
      (p) => live && setPhoto(p),
      () => live && setPhoto(null),
    );
    return () => {
      live = false;
    };
  }, [slug]);
  return photo;
}

/** Hook: small square head crops for every roster fighter (one ~850 KB file), loaded when `enabled`. */
export function useRosterThumbs(enabled: boolean): Record<string, string> | null {
  const [thumbs, setThumbs] = useState<Record<string, string> | null>(thumbsValue);
  useEffect(() => {
    if (!enabled || thumbsValue) return;
    let live = true;
    if (!thumbsPromise) {
      thumbsPromise = getJson<Record<string, string>>("roster/photos-thumbs.json");
      thumbsPromise.catch(() => (thumbsPromise = null));
    }
    thumbsPromise.then(
      (t) => {
        thumbsValue = t;
        if (live) setThumbs(t);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return thumbs;
}

// ---------- small helpers ----------

export const DAY_MS = 86400000;
export const nearDate = (a: string, b: string, days = 2) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * DAY_MS;

export function ageFrom(dob: string | null | undefined, today = new Date()) {
  if (!dob) return undefined;
  const d = new Date(dob + "T00:00:00Z");
  if (Number.isNaN(+d)) return undefined;
  let a = today.getUTCFullYear() - d.getUTCFullYear();
  const m = today.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < d.getUTCDate())) a--;
  return a;
}

/** Fight length in minutes from UFCStats seconds, or from round + clock. */
export function boutMinutes(b: Pick<RosterBout, "round" | "time" | "s">) {
  if (b.s?.sec) return b.s.sec / 60;
  const [mm, ss] = (b.time ?? "").split(":").map(Number);
  return b.round && Number.isFinite(mm) ? (b.round - 1) * 5 + mm + (ss || 0) / 60 : undefined;
}
