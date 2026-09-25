/**
 * Re-run the CURRENT engine on every completed card in data/ledger using only
 * pre-event history, and compare with the frozen picks. Use before shipping any
 * model change: `npm run backtest`.
 */
import { SEED_EVENTS, SEED_FIGHTERS } from "../lib/data";
import { predict } from "../lib/engine";
import { predictRounds } from "../lib/rounds";
import { ledgers, sameBout, sameFighter, scoredBouts } from "../lib/ledger";

let n = 0, hit = 0, brier = 0, rn = 0, rhit = 0, fn = 0, fhit = 0;
const bands: Record<string, [number, number]> = {};
const verbose = process.argv.includes("-v");
for (const l of ledgers) {
  const e = SEED_EVENTS.find((x) => x.id === l.eventId);
  if (!e || !l.results) continue;
  for (const s of scoredBouts(l)) {
    const f = e.fights.find((x) => sameBout({ a: SEED_FIGHTERS[x.a].name, b: SEED_FIGHTERS[x.b].name }, s.bout));
    if (!f || !s.bout.winner) continue;
    const a = SEED_FIGHTERS[f.a], b = SEED_FIGHTERS[f.b];
    const p = predict(f, a, b, e);
    if (!p.pick || p.confidence === null) continue;
    const ok = sameFighter(SEED_FIGHTERS[p.pick].name, s.bout.winner);
    n++; if (ok) hit++;
    brier += (ok ? 1 - p.confidence / 100 : p.confidence / 100) ** 2;
    const t = p.tier!; bands[t] = bands[t] || [0, 0]; bands[t][0]++; if (ok) bands[t][1]++;
    const r = predictRounds(f, a, b, e);
    if (r) { rn++; if (r.side === s.bout.ou) rhit++; }
    if (s.winner !== null) { fn++; if (s.winner) fhit++; }
    if (verbose) console.log(`${ok ? "✓" : "✗"} ${l.eventId.padEnd(16)} ${SEED_FIGHTERS[p.pick].name.padEnd(24)} ${p.confidence}% ${t.padEnd(12)} | rounds ${r?.side} (went ${s.bout.ou}) | won: ${s.bout.winner}`);
  }
}
const pct = (h: number, t: number) => (t ? `${Math.round((h / t) * 100)}%` : "—");
console.log(`Engine re-run:  winners ${hit}/${n} (${pct(hit, n)}) · Brier ${(brier / Math.max(n, 1)).toFixed(3)} · rounds ${rhit}/${rn} (${pct(rhit, rn)})`);
console.log(`Frozen picks:   winners ${fhit}/${fn} (${pct(fhit, fn)}) on the same bouts`);
console.log("By tier: " + Object.entries(bands).map(([k, [t, h]]) => `${k} ${h}/${t}`).join(" · "));
