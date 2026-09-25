/**
 * Freeze current engine picks for every upcoming card into data/ledger/<event>.json.
 * NEVER overwrites an existing forecast — once frozen, a pick is permanent.
 * Bouts added after the freeze are appended with their own timestamp.
 * Usage: npx tsx scripts/freeze.ts [--force-event <id>]   (force only for cards with no results yet)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SEED_EVENTS, SEED_FIGHTERS } from "../lib/data";
import { predict, ENGINE_VERSION } from "../lib/engine";
import { predictRounds } from "../lib/rounds";
import { predictFinish } from "../lib/finish";
import type { FrozenPick, Ledger, Method } from "../lib/ledger-types";
import { sameBout } from "../lib/ledger";

const now = new Date();
const today = now.toISOString().slice(0, 10);
const methodName = (m?: string): Method | null => (m === "ko" ? "KO/TKO" : m === "submission" ? "Submission" : m === "decision" ? "Decision" : null);
let wrote = 0;
for (const e of SEED_EVENTS) {
  if (e.date < today || !e.fights.length) continue;
  const file = `data/ledger/${e.id}.json`;
  const ledger: Ledger = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { eventId: e.id, title: e.title, date: e.date, promotion: e.promotion, forecast: null, results: null, review: null };
  if (ledger.results) continue;
  ledger.title = e.title;
  ledger.date = e.date;
  const bouts: FrozenPick[] = ledger.forecast?.bouts ?? [];
  let added = 0;
  for (const f of e.fights) {
    const a = SEED_FIGHTERS[f.a], b = SEED_FIGHTERS[f.b];
    if (bouts.some((x) => sameBout(x, { a: a.name, b: b.name }))) continue;
    const p = predict(f, a, b, e);
    const r = predictRounds(f, a, b, e);
    const fin = predictFinish(f, a, b, e, p.pick);
    bouts.push({
      a: a.name, b: b.name,
      pick: p.pick ? SEED_FIGHTERS[p.pick].name : null,
      confidence: p.confidence, tier: p.tier,
      rounds: r ? { line: r.line, side: r.side as "Over" | "Under" } : null,
      method: methodName(fin?.method),
      scheduledRounds: f.rounds,
      evidence: p.evidence,
      reasons: p.reasons.map((x) => `${x.title}: ${x.text}`),
      ...(ledger.forecast ? { frozenAt: now.toISOString() } : {}),
    } as FrozenPick);
    added++;
  }
  if (!added) continue;
  ledger.forecast = ledger.forecast ?? { engine: ENGINE_VERSION, frozenAt: now.toISOString(), basis: "Engine output frozen before the event. Never edited after results.", bouts: [] };
  ledger.forecast.bouts = bouts;
  writeFileSync(file, JSON.stringify(ledger, null, 1) + "\n");
  wrote++;
  console.log(`froze ${added} picks → ${file}`);
}
console.log(wrote ? `${wrote} ledger files updated` : "nothing new to freeze");
