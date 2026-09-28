/**
 * The full UFC roster (public/roster/roster.json, ~4.6 MB) and what's computed from it, without the
 * bundled names list: pages that only need the roster's numbers (the Breakdown tab's division
 * averages and skill percentiles) import this small module instead of lib/roster.ts, which re-exports
 * everything here. The file is fetched once, on demand, and cached for the session.
 */
import { useEffect, useState } from "react";

/** Lowercase, accent-free, no "Jr./Sr./II/III", letters and digits only. */
export const normName = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

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

