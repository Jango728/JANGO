import seed from "./seed.json";
import type { Fighter, Event } from "./types";
import { DWCS_WEEK7_EVENT, DWCS_WEEK7_FIGHTERS } from "./dwcs-week7";

export const SEED_FIGHTERS: Record<string, Fighter> = {
  ...(seed.fighters as unknown as Record<string, Fighter>),
  ...DWCS_WEEK7_FIGHTERS,
};
export const SEED_EVENTS: Event[] = [...(seed.events as Event[]), DWCS_WEEK7_EVENT];
/** Date of the last data refresh. The nightly job updates this. */
export const CHECKED_AT = "2026-09-24";
export const PROMOTIONS = ["UFC", "DWCS", "PFL", "ACA"] as const;
/** Public link to the hosted site (set after publishing). */
export const SITE_URL = "https://claude.ai/artifact/CB3f7jVHeYrvitrxxTkT1A";
