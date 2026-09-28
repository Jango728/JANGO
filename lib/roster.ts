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
import { normName } from "./roster-load";
import type { RosterBout } from "./roster-load";

export { normName };

// ---------- names ----------

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

// ---------- full roster (lib/roster-load.ts: fetched on demand, no names bundle) ----------

export { loadRoster, peekRoster, getRosterFighter, useRoster, divisionAverages, STAT_KEYS } from "./roster-load";
export type { RosterStatLine, RosterBout, RosterStats, RosterFighter, Roster, RosterState, StatKey } from "./roster-load";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
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
