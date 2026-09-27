/**
 * Backtest: engines v1.1 and v1.2 (frozen copies in scripts/baseline) vs the current engine in lib/.
 *
 *   npx tsx scripts/backtest.ts            # ledger + historical, summary tables
 *   npx tsx scripts/backtest.ts -v         # also list every ledger bout
 *
 * Sets
 *  - Ledger: every finished bout in data/ledger that maps to a seed fight, re-run with pre-event data only.
 *    The frozen picks (what was actually published) are shown alongside.
 *  - Historical: every UFC bout in the roster where both fighters had ≥3 prior UFC bouts
 *    (UFC-only histories rebuilt from the roster; nothing on/after the bout date is visible).
 *      FIT   2021-01-01 → 2024-12-31  — the only bouts any v1.2 weight was fitted on.
 *      TEST  2025-01-01 → 2026-09-19  — out of sample.
 *      2023+ 2023-01-01 → 2026-09-19  — the headline historical set.
 *
 * Market benchmark: closing-ish moneylines from scripts/backtest-odds.json (historical) and the seed's
 * display odds (ledger). EVALUATION ONLY — odds are never an input to any model.
 */
import { predict as predictNew, ENGINE_VERSION } from "../lib/engine";
import { predictRounds as roundsNew, ROUNDS_MODEL_VERSION } from "../lib/rounds";
import { predictFinish as finishNew } from "../lib/finish";
import { predict as predictOld } from "./baseline/engine-v1_1";
import { predictRounds as roundsOld } from "./baseline/rounds-v1_1";
import { predictFinish as finishOld } from "./baseline/finish-v1_1";
import { predict as predict12 } from "./baseline/engine-v1_2";
import { predictRounds as rounds12 } from "./baseline/rounds-v1_2";
import { predictFinish as finish12 } from "./baseline/finish-v1_2";
import { historicalSet, ledgerSet, type Case } from "./backtest-data";
import { sameFighter } from "../lib/ledger";
import { impliedProbability } from "../lib/benchmark";

type Out = { pick: string | null; conf: number | null; pOver: number | null; ou: "Over" | "Under" | null; method: string | null };
type Model = { name: string; run: (c: Case) => Out };
const METHOD: Record<string, string> = { ko: "KO/TKO", submission: "Submission", decision: "Decision" };

const MODELS: Model[] = [
  {
    name: "v1.1",
    run: (c) => {
      const p = predictOld(c.fight, c.a, c.b, c.event), r = roundsOld(c.fight, c.a, c.b, c.event), f = finishOld(c.fight, c.a, c.b, c.event, p.pick);
      // v1.1 had no P(Over); its displayed certainty on the chosen side is used for the Brier column.
      const pOver = r ? (r.side === "Over" ? r.confidence / 100 : 1 - r.confidence / 100) : null;
      return { pick: p.pick, conf: p.confidence, pOver, ou: (r?.side as Out["ou"]) ?? null, method: f ? METHOD[f.method] : null };
    },
  },
  {
    name: "v1.2",
    run: (c) => {
      const p = predict12(c.fight, c.a, c.b, c.event), r = rounds12(c.fight, c.a, c.b, c.event), f = finish12(c.fight, c.a, c.b, c.event, p.pick);
      return { pick: p.pick, conf: p.confidence, pOver: r?.pOver ?? null, ou: (r?.side as Out["ou"]) ?? null, method: f ? METHOD[f.method] : null };
    },
  },
  {
    name: `v${ENGINE_VERSION}`,
    run: (c) => {
      const p = predictNew(c.fight, c.a, c.b, c.event), r = roundsNew(c.fight, c.a, c.b, c.event), f = finishNew(c.fight, c.a, c.b, c.event, p.pick);
      return { pick: p.pick, conf: p.confidence, pOver: r?.pOver ?? null, ou: (r?.side as Out["ou"]) ?? null, method: f ? METHOD[f.method] : null };
    },
  },
];

type Row = { c: Case; o: Out };
const pct = (h: number, n: number) => (n ? `${((h / n) * 100).toFixed(1)}%` : "—");
const pad = (s: string | number, n: number) => String(s).padEnd(n);
/** Probability the model gave the eventual winner (abstentions = 50%). */
const pWinner = (r: Row) => {
  const pPick = r.o.pick && r.o.conf !== null ? r.o.conf / 100 : 0.5;
  return r.o.pick === r.c.winner || !r.o.pick ? pPick : 1 - pPick;
};
const market = (c: Case) => (c.odds ? impliedProbability(c.odds.a, c.odds.b) : null);

function summary(rows: Row[]) {
  const dec = rows.filter((r) => r.c.winner);
  const picked = dec.filter((r) => r.o.pick && r.o.conf !== null);
  const hit = picked.filter((r) => r.o.pick === r.c.winner).length;
  let ll = 0, br = 0;
  for (const r of dec) {
    const p = pWinner(r);
    ll += -Math.log(Math.max(1e-6, p));
    br += (1 - p) ** 2;
  }
  const ouRows = rows.filter((r) => r.c.ou && r.o.ou);
  const ouHit = ouRows.filter((r) => r.o.ou === r.c.ou).length;
  const pickOver = ouRows.filter((r) => r.o.ou === "Over"), pickUnder = ouRows.filter((r) => r.o.ou === "Under");
  const actualOver = ouRows.filter((r) => r.c.ou === "Over").length;
  const pr = ouRows.filter((r) => r.o.pOver !== null);
  const ouBrier = pr.length ? pr.reduce((s, r) => s + ((r.c.ou === "Over" ? 1 : 0) - r.o.pOver!) ** 2, 0) / pr.length : null;
  const meth = rows.filter((r) => r.c.winner && r.o.method && ["KO/TKO", "Submission", "Decision"].includes(r.c.method));
  const methHit = meth.filter((r) => r.o.method === r.c.method).length;
  const methBoth = meth.filter((r) => r.o.method === r.c.method && r.o.pick === r.c.winner).length;
  const methDec = meth.filter((r) => r.c.method === "Decision").length;
  return {
    n: dec.length, picked: picked.length, hit, ll: ll / Math.max(1, dec.length), brier: br / Math.max(1, dec.length),
    ouN: ouRows.length, ouHit, overPicks: pickOver.length, overHit: pickOver.filter((r) => r.c.ou === "Over").length,
    underPicks: pickUnder.length, underHit: pickUnder.filter((r) => r.c.ou === "Under").length, actualOver, ouBrier,
    methN: meth.length, methHit, methBoth, methDec,
  };
}

function table(title: string, byModel: Record<string, Row[]>) {
  console.log(`\n=== ${title} ===`);
  console.log(pad("model", 8) + pad("bouts", 7) + pad("winners", 17) + pad("log-loss", 10) + pad("Brier", 8) + pad("rounds O/U", 18) + pad("O/U Brier", 10) + pad("Over picks hit", 18) + pad("Under picks hit", 18) + pad("method", 17) + "winner+method");
  for (const [name, rows] of Object.entries(byModel)) {
    const s = summary(rows);
    console.log(
      pad(name, 8) + pad(s.n, 7) + pad(`${s.hit}/${s.picked} ${pct(s.hit, s.picked)}`, 17) + pad(s.ll.toFixed(4), 10) + pad(s.brier.toFixed(4), 8) +
        pad(`${s.ouHit}/${s.ouN} ${pct(s.ouHit, s.ouN)}`, 18) + pad(s.ouBrier === null ? "—" : s.ouBrier.toFixed(4), 10) +
        pad(`${s.overHit}/${s.overPicks} ${pct(s.overHit, s.overPicks)}`, 18) + pad(`${s.underHit}/${s.underPicks} ${pct(s.underHit, s.underPicks)}`, 18) +
        pad(`${s.methHit}/${s.methN} ${pct(s.methHit, s.methN)}`, 17) + `${s.methBoth}/${s.methN} ${pct(s.methBoth, s.methN)}`,
    );
  }
  const s = summary(Object.values(byModel)[0]);
  const base = s.actualOver / Math.max(1, s.ouN);
  console.log(`baselines: always-Over ${s.actualOver}/${s.ouN} ${pct(s.actualOver, s.ouN)} (constant-rate O/U Brier ${(base * (1 - base)).toFixed(4)}) · always-Decision ${s.methDec}/${s.methN} ${pct(s.methDec, s.methN)} · coin-flip log-loss 0.6931`);
}

/** Market favourite vs each model on the bouts that have odds (evaluation only). */
function benchmark(title: string, byModel: Record<string, Row[]>) {
  const first = Object.values(byModel)[0].filter((r) => r.c.winner && market(r.c) !== null);
  if (!first.length) return;
  let mHit = 0, mLL = 0, mBr = 0, mN = 0;
  for (const r of first) {
    const pa = market(r.c)!;
    const pw = r.c.winner === r.c.a.id ? pa : 1 - pa;
    if (pa !== 0.5) { mN++; if (pw > 0.5) mHit++; }
    mLL += -Math.log(Math.max(1e-6, pw));
    mBr += (1 - pw) ** 2;
  }
  console.log(`\n--- vs market: ${title} (${first.length} decided bouts with odds) ---`);
  console.log(`market favourite  ${pad(`${mHit}/${mN} ${pct(mHit, mN)}`, 17)} log-loss ${(mLL / first.length).toFixed(4)}  Brier ${(mBr / first.length).toFixed(4)}`);
  for (const [name, all] of Object.entries(byModel)) {
    const rows = all.filter((r) => r.c.winner && market(r.c) !== null);
    const s = summary(rows);
    const favSide = (r: Row) => (market(r.c)! > 0.5 ? r.c.a.id : market(r.c)! < 0.5 ? r.c.b.id : null);
    const dis = rows.filter((r) => r.o.pick && r.o.conf !== null && favSide(r) && r.o.pick !== favSide(r));
    const disHit = dis.filter((r) => r.o.pick === r.c.winner).length;
    const agree = rows.filter((r) => r.o.pick && r.o.conf !== null && favSide(r) && r.o.pick === favSide(r));
    console.log(
      `${pad(name, 18)}${pad(`${s.hit}/${s.picked} ${pct(s.hit, s.picked)}`, 17)} log-loss ${s.ll.toFixed(4)}  Brier ${s.brier.toFixed(4)}  · agrees with market on ${agree.length} (${pct(agree.filter((r) => r.o.pick === r.c.winner).length, agree.length)} right) · picked the underdog ${dis.length}× → ${disHit}/${dis.length} ${pct(disHit, dis.length)}`,
    );
  }
}

function calibration(title: string, byModel: Record<string, Row[]>) {
  console.log(`\n--- calibration: ${title} (picked winner's confidence vs actual hit rate) ---`);
  const bands: [string, number, number][] = [["50–54", 50, 55], ["55–62", 55, 63], ["63–71", 63, 72], ["72–81", 72, 82], ["82+", 82, 101]];
  console.log(pad("model", 8) + bands.map(([l]) => pad(l, 24)).join(""));
  for (const [name, rows] of Object.entries(byModel)) {
    const cells = bands.map(([, lo, hi]) => {
      const xs = rows.filter((r) => r.c.winner && r.o.pick && r.o.conf !== null && r.o.conf >= lo && r.o.conf < hi);
      const h = xs.filter((r) => r.o.pick === r.c.winner).length;
      const avg = xs.length ? xs.reduce((s, r) => s + r.o.conf!, 0) / xs.length : 0;
      return pad(xs.length ? `${h}/${xs.length} ${pct(h, xs.length)} (avg ${avg.toFixed(0)})` : "—", 24);
    });
    console.log(pad(name, 8) + cells.join(""));
  }
}

function roundsCalibration(title: string, rows: Row[]) {
  const xs = rows.filter((r) => r.c.ou && r.o.pOver !== null);
  if (!xs.length) return;
  console.log(`\n--- rounds calibration: ${title} (P(Over) bucket → actual Over rate) ---`);
  const edges = [0, 0.35, 0.45, 0.5, 0.55, 0.62, 0.7, 0.78, 1.01];
  const cells: string[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const b = xs.filter((r) => r.o.pOver! >= edges[i] && r.o.pOver! < edges[i + 1]);
    if (!b.length) continue;
    const over = b.filter((r) => r.c.ou === "Over").length;
    cells.push(`${edges[i].toFixed(2)}–${Math.min(1, edges[i + 1]).toFixed(2)}: ${over}/${b.length} ${pct(over, b.length)} (avg ${(b.reduce((s, r) => s + r.o.pOver!, 0) / b.length).toFixed(2)})`);
  }
  console.log(cells.join("\n"));
}

function breakdown(title: string, byModel: Record<string, Row[]>, key: (c: Case) => string) {
  console.log(`\n--- ${title} ---`);
  const keys = [...new Set(Object.values(byModel)[0].map((r) => key(r.c)))].sort();
  for (const k of keys) {
    const parts = Object.entries(byModel).map(([name, rows]) => {
      const s = summary(rows.filter((r) => key(r.c) === k));
      return `${name} W ${s.hit}/${s.picked} ${pct(s.hit, s.picked)} ll ${s.ll.toFixed(3)} · O/U ${s.ouHit}/${s.ouN} ${pct(s.ouHit, s.ouN)}`;
    });
    const s0 = summary(Object.values(byModel)[0].filter((r) => key(r.c) === k));
    console.log(`${pad(k, 24)} ${parts.join("  |  ")}  · actual Over ${pct(s0.actualOver, s0.ouN)}`);
  }
}

function run(cases: Case[]) {
  const by: Record<string, Row[]> = {};
  for (const m of MODELS) by[m.name] = cases.map((c) => ({ c, o: m.run(c) }));
  return by;
}
const slice = (by: Record<string, Row[]>, f: (c: Case) => boolean) => Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.filter((r) => f(r.c))]));

const verbose = process.argv.includes("-v");
console.log(`Backtest · baseline engines v1.1, v1.2 vs current engine v${ENGINE_VERSION} (rounds ${ROUNDS_MODEL_VERSION}). Odds are never a model input; they appear only in the benchmark rows.`);

// ---------- Ledger ----------
const L = ledgerSet();
const byL = run(L);
table(`Ledger: finished bouts in data/ledger (${L.length})`, byL);
{
  const fr = L.filter((c) => c.frozen);
  const w = fr.filter((c) => c.winner && c.frozen!.pick), wh = w.filter((c) => sameFighter(c.frozen!.pick!, c.winner === c.a.id ? c.a.name : c.b.name)).length;
  const o = fr.filter((c) => c.ou && c.frozen!.rounds), oh = o.filter((c) => c.frozen!.rounds!.side === c.ou).length;
  const overP = o.filter((c) => c.frozen!.rounds!.side === "Over"), underP = o.filter((c) => c.frozen!.rounds!.side === "Under");
  console.log(`frozen (published) picks on these bouts: winners ${wh}/${w.length} ${pct(wh, w.length)} · rounds ${oh}/${o.length} ${pct(oh, o.length)} · Over picks ${overP.filter((c) => c.ou === "Over").length}/${overP.length} · Under picks ${underP.filter((c) => c.ou === "Under").length}/${underP.length}`);
}
calibration("ledger", byL);
benchmark("ledger (seed display odds)", byL);
if (verbose) {
  for (let i = 0; i < L.length; i++) {
    const c = L[i];
    const cells = MODELS.map((m) => {
      const o = byL[m.name][i].o, nm = o.pick ? (o.pick === c.a.id ? c.a.name : c.b.name) : "—";
      return `${m.name}: ${o.pick ? (o.pick === c.winner ? "✓" : c.winner ? "✗" : "·") : " "} ${pad(nm, 22)} ${pad(o.conf ?? "", 3)} ${o.ou ?? "-"}${o.ou && c.ou ? (o.ou === c.ou ? "✓" : "✗") : ""} ${o.method ?? ""}`;
    });
    console.log(`${pad(c.id.split(":")[0], 16)} ${pad(`${c.a.name} v ${c.b.name}`, 46)} ${cells.join(" | ")} || went ${c.ou} ${c.method}`);
  }
}

// ---------- Historical ----------
const H = historicalSet("2021-01-01");
const byH = run(H);
const fit = (c: Case) => c.date < "2025-01-01", test = (c: Case) => c.date >= "2025-01-01", since23 = (c: Case) => c.date >= "2023-01-01";
table(`Historical UFC 2023-01-01 → 2026-09-19, both ≥3 prior UFC bouts (${H.filter(since23).length})`, slice(byH, since23));
table(`Historical · FIT 2021-01 → 2024-12 (${H.filter(fit).length}) — v1.2 weights were fitted here`, slice(byH, fit));
table(`Historical · TEST 2025-01 → 2026-09, out of sample (${H.filter(test).length})`, slice(byH, test));
benchmark("historical 2023+", slice(byH, since23));
benchmark("historical TEST (out of sample)", slice(byH, test));
calibration("historical TEST", slice(byH, test));
calibration("historical 2023+", slice(byH, since23));
roundsCalibration("historical TEST · v1.2", slice(byH, test)["v1.2"]);
roundsCalibration(`historical TEST · v${ENGINE_VERSION}`, slice(byH, test)[`v${ENGINE_VERSION}`]);
breakdown("historical TEST by division", slice(byH, test), (c) => c.fight.division);
breakdown("historical TEST by scheduled rounds", slice(byH, test), (c) => `${c.fight.rounds} rounds`);
