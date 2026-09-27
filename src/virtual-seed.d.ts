// Types for the build-time seed split (see vite.config.ts → seedSplit).
declare module "virtual:jango-seed" {
  import type { Event, Fighter } from "@/lib/types";
  export const EVENTS: Event[];
  export const CHECKED_AT: string;
  export const PROMOTIONS: readonly string[];
  export const SITE_URL: string;
  /** Fighter id → key of the chunk that holds the full profile. */
  export const FIGHTER_CHUNK: Record<string, string>;
  export const CHUNKS: Record<string, () => Promise<{ default: Record<string, Fighter> }>>;
}
