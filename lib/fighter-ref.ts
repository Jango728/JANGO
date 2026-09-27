/** What a fighter link carries. `slug: null` means "known NOT to be in the roster" (e.g. a pre-2021 opponent). */
export type FighterRef = { name: string; id?: string; slug?: string | null; vs?: string; date?: string };

/** Encode a reference as the profile-dialog target string (plain id/name when there's no extra context). */
export function encodeRef(r: FighterRef): string {
  if (r.slug === undefined && !r.vs && !r.date) return r.id ?? r.name;
  return "@" + JSON.stringify(r);
}
