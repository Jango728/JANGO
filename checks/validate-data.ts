/**
 * Publication gate: fails (exit 1) if any card has data that would mislead.
 * Run before every publish: `npm run validate`.
 */
import { existsSync } from "node:fs";
import { SEED_EVENTS, SEED_FIGHTERS, PROMOTIONS } from "../lib/data";
import { predict } from "../lib/engine";
import { predictRounds } from "../lib/rounds";
import { ledgers } from "../lib/ledger";

const errors: string[] = [], warnings: string[] = [];
const today = new Date().toISOString().slice(0, 10);
for (const e of SEED_EVENTS) {
  if (!(PROMOTIONS as readonly string[]).includes(e.promotion)) errors.push(`${e.id}: promotion ${e.promotion} is not allowed`);
  const seen = new Set<string>();
  e.fights.forEach((f, i) => {
    const a = SEED_FIGHTERS[f.a], b = SEED_FIGHTERS[f.b];
    const tag = `${e.id} #${i + 1}`;
    if (!a || !b) return errors.push(`${tag}: missing fighter profile (${f.a} / ${f.b})`);
    if (f.a === f.b) errors.push(`${tag}: fighter booked against himself`);
    for (const x of [f.a, f.b]) {
      if (seen.has(x)) errors.push(`${tag}: ${SEED_FIGHTERS[x].name} appears twice on the card`);
      seen.add(x);
    }
    if (![3, 5].includes(f.rounds)) errors.push(`${tag}: ${a.name} vs ${b.name} scheduled for ${f.rounds} rounds (must be 3 or 5)`);
    if (i === 0 && e.promotion === "UFC" && f.rounds !== 5) warnings.push(`${tag}: UFC main event is ${f.rounds} rounds`);
    if (i > 0 && f.rounds === 5 && !/title/i.test([...f.notes, f.division].join(" ")) && e.promotion !== "UFC") warnings.push(`${tag}: 5 rounds but not the main event`);
    for (const x of [a, b]) {
      if (!x.record || !/^\d+-\d+-\d+/.test(x.record)) warnings.push(`${tag}: ${x.name} record missing`);
      if (!x.height) warnings.push(`${tag}: ${x.name} height missing`);
      if (!x.reach) warnings.push(`${tag}: ${x.name} reach missing`);
      if (x.image && !existsSync("public/" + x.image.replace(/^\//, ""))) errors.push(`${tag}: ${x.name} portrait file missing (${x.image})`);
      if (x.image?.startsWith("/")) errors.push(`${tag}: ${x.name} portrait path must be relative`);
    }
    if (e.date >= today) {
      const p = predict(f, a, b, e);
      const r = predictRounds(f, a, b, e);
      if (!r) errors.push(`${tag}: no rounds pick`);
      if (p.status === "pending") warnings.push(`${tag}: ${a.name} vs ${b.name} pick pending — ${p.pendingReason}`);
      if (p.confidence !== null && (p.confidence < 50 || p.confidence > 90)) errors.push(`${tag}: confidence ${p.confidence} out of range`);
    }
  });
}
for (const l of ledgers) {
  if (l.results) for (const b of l.results.bouts) if (![1.5, 2.5].includes(b.line)) errors.push(`ledger ${l.eventId}: bad O/U line ${b.line}`);
  if (l.forecast && l.forecast.frozenAt.slice(0, 10) > l.date) errors.push(`ledger ${l.eventId}: forecast frozen after the event`);
}
console.log(`${errors.length} errors · ${warnings.length} warnings`);
warnings.slice(0, 80).forEach((w) => console.log("  warn  " + w));
errors.forEach((x) => console.log("  ERROR " + x));
if (errors.length) process.exit(1);
