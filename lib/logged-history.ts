/**
 * Results we've logged in the ledger (data/ledger/*.json) that a fighter's scraped history
 * doesn't have yet — e.g. Van def. Pantoja at UFC 331. Used for display (profiles) so a
 * fighter's page is current the morning after a card, before the nightly re-scrapes history.
 */
import { ledgers, sameFighter } from "./ledger";
import type { Fighter, PastFight } from "./types";

const DAY = 86400000;
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 2 * DAY;

function methodText(method: string, detail?: string) {
  const d = (detail ?? "").trim();
  if (/^(t?ko|submission|decision)\b/i.test(d)) return d;
  if (method === "DQ") return `Disqualification${d ? ` (${d})` : ""}`;
  if (method === "Decision") return `Decision${d ? ` (${d.replace(/\s*\(.*$/, "")})` : ""}`;
  return d ? `${method} (${d})` : method;
}

export function loggedRows(f: Fighter): PastFight[] {
  const out: PastFight[] = [];
  for (const l of ledgers) {
    for (const b of l.results?.bouts ?? []) {
      const isA = sameFighter(f.name, b.a), isB = !isA && sameFighter(f.name, b.b);
      if (!isA && !isB) continue;
      const opponent = isA ? b.b : b.a;
      if (f.history.some((h) => near(h.date, l.date) && sameFighter(h.opponent, opponent))) continue;
      const nc = b.method === "No contest";
      const draw = b.method === "Draw" || (!nc && !b.winner);
      const result: PastFight["result"] = nc ? "NC" : draw ? "D" : sameFighter(f.name, b.winner ?? "") ? "W" : "L";
      const [mm, ss] = (b.time ?? "").split(":").map(Number);
      const minutes = b.round && Number.isFinite(mm) ? (b.round - 1) * 5 + mm + (ss || 0) / 60 : undefined;
      out.push({
        opponent,
        date: l.date,
        result,
        promotion: l.promotion,
        method: methodText(b.method, b.detail),
        round: b.round,
        time: b.time,
        minutes,
        rules: "MMA",
        eventName: l.title,
        source: l.results?.sources?.[0]?.url ?? "Jango Playz ledger",
      });
    }
  }
  return out;
}

/** The fighter with ledger-logged results merged in, newest first. */
export function withLoggedResults(f: Fighter): Fighter {
  const extra = loggedRows(f);
  if (!extra.length) return f;
  let record = f.record;
  const m = !f.historyComplete && f.record?.match(/^(\d+)-(\d+)(?:-(\d+))?(.*)$/);
  if (m) {
    const n = (r: string) => extra.filter((x) => x.result === r).length;
    record = `${+m[1] + n("W")}-${+m[2] + n("L")}-${(+(m[3] ?? 0)) + n("D")}${m[4] ?? ""}`;
  }
  return { ...f, record, history: [...extra, ...f.history].sort((a, b) => b.date.localeCompare(a.date)) };
}
