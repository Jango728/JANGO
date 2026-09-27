/**
 * Browser version of lib/data.ts (vite.config.ts points browser imports of lib/data.ts here).
 * Same exports, but fighter profiles arrive per card: SEED_FIGHTERS starts with the TS-defined
 * fighters and fills in as chunks load. Code that needs every profile at import time
 * (directory, clips) is only imported after `loadAllFighters()` resolves.
 */
import { useEffect, useState } from "react";
import * as V from "virtual:jango-seed";
import type * as Data from "./data";
import { DWCS_WEEK7_EVENT, DWCS_WEEK7_FIGHTERS } from "./dwcs-week7";
import type { Event, Fighter } from "./types";

export const SEED_FIGHTERS: Record<string, Fighter> = { ...DWCS_WEEK7_FIGHTERS };
export const SEED_EVENTS: Event[] = [...V.EVENTS, DWCS_WEEK7_EVENT];
export const CHECKED_AT: string = V.CHECKED_AT;
export const PROMOTIONS = V.PROMOTIONS as typeof Data.PROMOTIONS;
export const SITE_URL: string = V.SITE_URL;

const pending = new Map<string, Promise<void>>();
function loadChunk(key: string) {
  let p = pending.get(key);
  if (!p) {
    p = V.CHUNKS[key]().then((m) => {
      // Same precedence as lib/data.ts: the TS-defined fighters win over the seed.
      for (const [id, f] of Object.entries(m.default)) if (!(id in DWCS_WEEK7_FIGHTERS)) SEED_FIGHTERS[id] = f;
    });
    p.catch(() => pending.delete(key)); // allow a retry after a network blip
    pending.set(key, p);
  }
  return p;
}
const missing = (ev: Event) => ev.fights.flatMap((f) => [f.a, f.b]).filter((id) => !SEED_FIGHTERS[id] && V.FIGHTER_CHUNK[id]);

/** True when every fighter on the card has its full profile loaded. */
export const eventReady = (ev: Event) => missing(ev).length === 0;
export const loadEventFighters = (ev: Event) => Promise.all([...new Set(missing(ev).map((id) => V.FIGHTER_CHUNK[id]))].map(loadChunk)).then(() => undefined);

let all: Promise<void> | null = null;
/** Every profile (search, profiles, clips). Chunks already loaded are reused. */
export function loadAllFighters() {
  all ??= Promise.all(Object.keys(V.CHUNKS).map(loadChunk)).then(() => undefined);
  all.catch(() => (all = null));
  return all;
}

/** Loads the card's fighters. `ready` once they are all in SEED_FIGHTERS; `failed` after a load error (call `retry`). */
export function useEventFighters(ev: Event): { ready: boolean; failed: boolean; retry: () => void } {
  const [, bump] = useState(0);
  const [failed, setFailed] = useState(false);
  const ready = eventReady(ev);
  useEffect(() => {
    if (failed || eventReady(ev)) return;
    let live = true;
    loadEventFighters(ev).then(
      () => live && bump((n) => n + 1),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [ev, failed]);
  return { ready, failed, retry: () => setFailed(false) };
}
