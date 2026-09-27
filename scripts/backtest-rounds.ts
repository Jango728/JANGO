/**
 * Feature study for engine v1.3 — round-level "how fights go" features (lib/round-features.ts).
 *
 *   npx tsx scripts/backtest-rounds.ts
 *
 * For every historical UFC bout (scripts/backtest-data.ts, both fighters ≥3 prior UFC bouts) it takes the
 * v1.2 winner log-odds and rounds log-odds as a fixed offset, then fits ONE extra coefficient per candidate
 * feature on FIT (2021–2024) and reports the out-of-sample change on TEST (2025-01 → 2026-09):
 * log-loss, Brier and accuracy (winner) / Under-pick precision (rounds). A feature only earns a place in
 * the engine if it helps on TEST. Odds are never used here.
 */
import { predict } from "../lib/engine";
import { predictRounds } from "../lib/rounds";
import { roundFormAsOf, type RoundForm } from "../lib/round-features";
import { statsAsOf } from "../lib/fight-stats";
import { ageAt } from "../lib/engine";
import { historicalSet, type Case } from "./backtest-data";

const logit = (p: number) => Math.log(p / (1 - p));
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const pad = (s: string | number, n: number) => String(s).padEnd(n);

type Item = { c: Case; test: boolean; zW: number; yW: number | null; zR: number | null; yR: number | null; A: RoundForm | null; B: RoundForm | null; A1: RoundForm | null; B1: RoundForm | null; Ad: RoundForm | null; Bd: RoundForm | null; five: boolean; sa: ReturnType<typeof statsAsOf>; sb: ReturnType<typeof statsAsOf> };

const DECAY = Number(process.argv.find((a) => a.startsWith("--decay="))?.split("=")[1] ?? 0.75);
const H = historicalSet("2021-01-01");
const items: Item[] = H.map((c) => {
  const p = predict(c.fight, c.a, c.b, c.event);
  const r = predictRounds(c.fight, c.a, c.b, c.event);
  const pa = Math.min(0.97, Math.max(0.03, p.probabilityA));
  return {
    c, test: c.date >= "2025-01-01",
    zW: logit(pa), yW: c.winner ? (c.winner === c.a.id ? 1 : 0) : null,
    zR: r ? logit(r.pOver) : null, yR: c.ou ? (c.ou === "Over" ? 1 : 0) : null,
    A: null, B: null, A1: roundFormAsOf(c.a, c.date), B1: roundFormAsOf(c.b, c.date), Ad: roundFormAsOf(c.a, c.date, DECAY), Bd: roundFormAsOf(c.b, c.date, DECAY), five: c.fight.rounds >= 5,
    sa: statsAsOf(c.a, c.date), sb: statsAsOf(c.b, c.date),
  };
});

/** Fit y ~ offset + Σ β x (Newton, small ridge), returning β. */
function fit(xs: number[][], off: number[], y: number[], ridge = 1): number[] {
  const k = xs[0]?.length ?? 0;
  let b = new Array(k).fill(0);
  for (let it = 0; it < 30; it++) {
    const g = new Array(k).fill(0), Hm = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < xs.length; i++) {
      const p = sig(off[i] + xs[i].reduce((s, v, j) => s + v * b[j], 0));
      for (let j = 0; j < k; j++) {
        g[j] += (y[i] - p) * xs[i][j];
        for (let l = 0; l < k; l++) Hm[j][l] += p * (1 - p) * xs[i][j] * xs[i][l];
      }
    }
    for (let j = 0; j < k; j++) { g[j] -= ridge * b[j]; Hm[j][j] += ridge; }
    const step = solve(Hm, g);
    b = b.map((v, j) => v + step[j]);
    if (step.every((s) => Math.abs(s) < 1e-7)) break;
  }
  return b;
}
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}
const ll = (p: number, y: number) => -Math.log(Math.max(1e-9, y ? p : 1 - p));

type Feat = { name: string; f: (it: Item) => number | null };
const d = (g: (x: RoundForm, it: Item, me: "A" | "B") => number) => (it: Item) => (it.A && it.B ? g(it.A, it, "A") - g(it.B, it, "B") : null);

const WINNER: Feat[] = [
  { name: "fade (cardio: late ÷ R1 output)", f: d((x) => x.fade) },
  { name: "fade × 5-round", f: (it) => (it.A && it.B && it.five ? it.A.fade - it.B.fade : it.A && it.B ? 0 : null) },
  { name: "opp growth late (−)", f: d((x) => -x.oppGrow) },
  { name: "late net strikes/min (R3+)", f: d((x) => x.lateNet) },
  { name: "knocked down per 15 (−)", f: d((x) => -x.droppedPer15) },
  { name: "KD scored per 15", f: d((x) => x.kdPer15) },
  { name: "KD per landed (power)", f: d((x) => x.kdPerLanded * 100) },
  { name: "power × chin matchup", f: (it) => (it.A && it.B ? it.A.kdPer15 * it.B.droppedPer15 - it.B.kdPer15 * it.A.droppedPer15 : null) },
  { name: "recovery after KD", f: d((x) => x.recover) },
  { name: "head absorbed/min (−)", f: d((x) => -x.headAbsPerMin) },
  { name: "late absorbed/min (−)", f: d((x) => -x.lateAbsPerMin) },
  { name: "round-win share", f: d((x) => x.roundWin) },
  { name: "taken down at will (−)", f: d((x) => -x.tdAtWill) },
  { name: "TD vuln × opp TD rate", f: (it) => (it.A && it.B && it.sa && it.sb ? it.sa.tdPer15 * it.B.tdAtWill - it.sb.tdPer15 * it.A.tdAtWill : null) },
  { name: "TD late ratio (−)", f: d((x) => -x.tdLateRatio) },
  { name: "ctrl per TD absorbed (−, get-ups)", f: d((x) => -x.ctrlPerTd / 60) },
  { name: "R1 threat", f: d((x) => x.r1Threat) },
  { name: "R1 leak (−)", f: d((x) => -x.r1Leak) },
  { name: "finish after drop", f: d((x) => x.finDrop) },
  { name: "R4–5 net (5-round only)", f: (it) => (it.A && it.B ? (it.five ? it.A.r45Net - it.B.r45Net : 0) : null) },
  { name: "close-round share (−)", f: d((x) => -x.close) },
  { name: "dropped in last 3 (−)", f: d((x) => -x.recentDropped) },
  { name: "dropped in last 3 × age>32 (−)", f: d((x, it, me) => -x.recentDropped * Math.max(0, (ageAt(me === "A" ? it.c.a : it.c.b, it.c.date) ?? 30) - 32)) },
];

const both = (g: (x: RoundForm) => number) => (it: Item) => (it.A && it.B ? (g(it.A) + g(it.B)) / 2 : null);
const ROUNDS: Feat[] = [
  { name: "knocked down per 15 (avg)", f: both((x) => x.droppedPer15) },
  { name: "KD per 15 (avg)", f: both((x) => x.kdPer15) },
  { name: "power × chin (max side)", f: (it) => (it.A && it.B ? Math.max(it.A.kdPer15 * it.B.droppedPer15, it.B.kdPer15 * it.A.droppedPer15) : null) },
  { name: "power × chin (sum)", f: (it) => (it.A && it.B ? it.A.kdPer15 * it.B.droppedPer15 + it.B.kdPer15 * it.A.droppedPer15 : null) },
  { name: "R1 threat × R1 leak", f: (it) => (it.A && it.B ? it.A.r1Threat * it.B.r1Leak + it.B.r1Threat * it.A.r1Leak : null) },
  { name: "R1 threat (avg)", f: both((x) => x.r1Threat) },
  { name: "R1 leak (avg)", f: both((x) => x.r1Leak) },
  { name: "recovery after KD (avg)", f: both((x) => x.recover) },
  { name: "head absorbed/min (avg)", f: both((x) => x.headAbsPerMin) },
  { name: "KD per landed (avg)", f: both((x) => x.kdPerLanded * 100) },
  { name: "close-round share (avg)", f: both((x) => x.close) },
  { name: "round-win mismatch |A−B|", f: (it) => (it.A && it.B ? Math.abs(it.A.roundWin - it.B.roundWin) : null) },
  { name: "fade (avg)", f: both((x) => x.fade) },
  { name: "finish after drop (avg)", f: both((x) => x.finDrop) },
  { name: "ctrl per TD (avg, min)", f: both((x) => x.ctrlPerTd / 60) },
  { name: "taken down at will (avg)", f: both((x) => x.tdAtWill) },
  { name: "late absorbed/min (avg)", f: both((x) => x.lateAbsPerMin) },
  { name: "grappling danger (sub rate × TD at will, max)", f: (it) => (it.A && it.B && it.sa && it.sb ? Math.max(it.sa.subPer15 * it.B.tdAtWill, it.sb.subPer15 * it.A.tdAtWill) : null) },
  { name: "wrestling danger (TD rate × at will × ctrl/TD)", f: (it) => (it.A && it.B && it.sa && it.sb ? Math.max(it.sa.tdPer15 * it.B.tdAtWill * it.B.ctrlPerTd, it.sb.tdPer15 * it.A.tdAtWill * it.A.ctrlPerTd) / 60 : null) },
  { name: "dropped in last 3 (sum)", f: (it) => (it.A && it.B ? it.A.recentDropped + it.B.recentDropped : null) },
  { name: "stats kdx (power×chin, per-fight totals)", f: (it) => (it.sa && it.sb ? it.sa.kdPer15 * it.sb.kdAgainstPer15 + it.sb.kdPer15 * it.sa.kdAgainstPer15 : null) },
];

type Set = { name: string; feats: Feat[] };
function study(title: string, sets: Set[], z: (it: Item) => number | null, y: (it: Item) => number | null, rounds: boolean) {
  const pool = items.filter((it) => z(it) !== null && y(it) !== null);
  const tr = pool.filter((it) => !it.test), te = pool.filter((it) => it.test);
  // In-FIT validation: fit on 2021–22, score on 2023–24 (feature selection never looks at TEST).
  const tr1 = tr.filter((it) => it.c.date < "2023-01-01"), va = tr.filter((it) => it.c.date >= "2023-01-01");
  // Rolling origin inside FIT: 2021–22 → 2023, 2021–23 → 2024.
  const folds = [["2023-01-01", "2024-01-01"], ["2024-01-01", "2025-01-01"]].map(([a, b]) => ({ fitOn: tr.filter((it) => it.c.date < a), on: tr.filter((it) => it.c.date >= a && it.c.date < b) }));
  const score = (xs: Item[], zz: (it: Item) => number) => {
    let L = 0, B = 0, hit = 0, uN = 0, uH = 0;
    for (const it of xs) { const p = sig(zz(it)); L += ll(p, y(it)!); B += (y(it)! - p) ** 2; hit += (p >= 0.5 ? 1 : 0) === y(it)! ? 1 : 0; if (p < 0.5) { uN++; uH += y(it)! === 0 ? 1 : 0; } }
    return { L: L / xs.length, B: B / xs.length, acc: hit / xs.length, uN, uH };
  };
  const b0 = score(te, (it) => z(it)!), bva = score(va, (it) => z(it)!);
  console.log(`\n=== ${title}: FIT ${tr.length} · TEST ${te.length} · v1.2 TEST log-loss ${b0.L.toFixed(4)} Brier ${b0.B.toFixed(4)} acc ${(b0.acc * 100).toFixed(1)}%${rounds ? ` · Under picks ${b0.uH}/${b0.uN}` : ""} ===`);
  console.log(pad("feature", 44) + pad("β/sd", 16) + pad("VAL Δll", 10) + pad("'23,'24 Δll", 16) + pad("TEST Δll ± se", 16) + pad("TEST ΔBrier", 12) + pad("TEST acc", 10) + (rounds ? "Under picks (TEST)" : ""));
  for (const st of sets) {
    const norm = st.feats.map((ft) => {
      const vals = tr.map((it) => ft.f(it)).filter((v): v is number => v !== null);
      const mu = vals.reduce((a, v) => a + v, 0) / Math.max(1, vals.length);
      const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mu) ** 2, 0) / Math.max(1, vals.length)) || 1;
      // Winner features are antisymmetric (A−B): not centred, so swapping corners flips the sign.
      return (it: Item) => { const v = ft.f(it); return v === null ? 0 : rounds ? (v - mu) / sd : v / sd; };
    });
    const X = (it: Item) => norm.map((g) => g(it));
    const fitOn = (xs: Item[]) => fit(xs.map(X), xs.map((it) => z(it)!), xs.map((it) => y(it)!));
    const bv = fitOn(tr1), beta = fitOn(tr);
    const zz = (b: number[]) => (it: Item) => z(it)! + X(it).reduce((a, v, j) => a + v * b[j], 0);
    const fva = score(va, zz(bv)), fte = score(te, zz(beta));
    const roll = folds.map((fo) => score(fo.on, zz(fitOn(fo.fitOn))).L - score(fo.on, (it) => z(it)!).L);
    const diffs = te.map((it) => ll(sig(zz(beta)(it)), y(it)!) - ll(sig(z(it)!), y(it)!));
    const md = diffs.reduce((a, v) => a + v, 0) / diffs.length;
    const se = Math.sqrt(diffs.reduce((a, v) => a + (v - md) ** 2, 0) / diffs.length / diffs.length);
    console.log(
      pad(st.name, 44) + pad(beta.map((b) => b.toFixed(2)).join(","), 16) + pad((fva.L - bva.L).toFixed(4), 10) + pad(roll.map((r) => r.toFixed(4)).join(","), 16) + pad(`${(fte.L - b0.L).toFixed(4)}±${se.toFixed(4)}`, 16) +
        pad((fte.B - b0.B).toFixed(4), 12) + pad(`${(fte.acc * 100).toFixed(1)}%`, 10) + (rounds ? `${fte.uH}/${fte.uN}` : ""),
    );
  }
}
const singles = (fs: Feat[]): Set[] => fs.map((f) => ({ name: f.name, feats: [f] }));
const pickF = (fs: Feat[], ...names: string[]) => names.map((n) => fs.find((f) => f.name.startsWith(n))!);

console.log("Round-feature study · offsets are engine/rounds v-current log-odds · β per 1 SD of the feature (FIT-standardised)");
console.log("VAL = fit 2021–22, scored on 2023–24 (selection); TEST = fit 2021–24, scored on 2025-01 → 2026-09 (confirmation).");
for (const mode of ["career", `recency ${DECAY}`]) {
  for (const it of items) { it.A = mode === "career" ? it.A1 : it.Ad; it.B = mode === "career" ? it.B1 : it.Bd; }
  study(`WINNER (y = fighter A wins) · ${mode}`, [
    ...singles(WINNER),
    { name: "SET cardio+wrestling (fade, TD at will)", feats: pickF(WINNER, "fade (cardio", "taken down at will") },
    { name: "SET durability (dropped, head abs, recovery)", feats: pickF(WINNER, "knocked down per 15", "head absorbed", "recovery") },
    { name: "SET late net + TD at will", feats: pickF(WINNER, "late net", "taken down at will") },
    { name: "SET late net + TD at will + fade", feats: pickF(WINNER, "late net", "taken down at will", "fade (cardio") },
    { name: "SET late net + TD at will + round-win", feats: pickF(WINNER, "late net", "taken down at will", "round-win share") },
  ], (it) => it.zW, (it) => it.yW, false);
  study(`ROUNDS (y = Over) · ${mode}`, [
    ...singles(ROUNDS),
    { name: "SET R1 threat×leak + TD at will", feats: pickF(ROUNDS, "R1 threat × R1 leak", "taken down at will") },
    { name: "SET R1 threat×leak + R1 threat + R1 leak", feats: pickF(ROUNDS, "R1 threat × R1 leak", "R1 threat (avg)", "R1 leak (avg)") },
    { name: "SET R1 + TD at will + ctrl/TD", feats: pickF(ROUNDS, "R1 threat × R1 leak", "taken down at will", "ctrl per TD") },
    { name: "SET R1 threat×leak + R1 leak", feats: pickF(ROUNDS, "R1 threat × R1 leak", "R1 leak (avg)") },
    { name: "SET R1 threat×leak + ctrl/TD", feats: pickF(ROUNDS, "R1 threat × R1 leak", "ctrl per TD") },
    { name: "SET R1 threat×leak + grappling danger", feats: pickF(ROUNDS, "R1 threat × R1 leak", "grappling danger") },
  ], (it) => it.zR, (it) => it.yR, true);
}

// ---------- Raw-unit coefficients for the shipped sets (fit on FIT 2021–24) ----------
{
  const show = (title: string, feats: Feat[], z: (it: Item) => number | null, y: (it: Item) => number | null, center: boolean) => {
    const tr = items.filter((it) => !it.test && z(it) !== null && y(it) !== null);
    const X = (it: Item) => feats.map((f) => f.f(it) ?? 0);
    const mus = feats.map((_, j) => (center ? tr.reduce((a, it) => a + X(it)[j], 0) / tr.length : 0));
    const b = fit(tr.map((it) => X(it).map((v, j) => v - mus[j])), tr.map((it) => z(it)!), tr.map((it) => y(it)!), 0.02);
    const sds = feats.map((_, j) => Math.sqrt(tr.reduce((a, it) => a + (X(it)[j] - mus[j]) ** 2, 0) / tr.length));
    console.log(`\n${title}: ` + feats.map((f, j) => `${f.name} β_raw=${b[j].toFixed(4)} mean=${mus[j].toFixed(4)} sd=${sds[j].toFixed(4)}`).join(" | "));
  };
  for (const it of items) { it.A = it.A1; it.B = it.B1; }
  show("WINNER career set", pickF(WINNER, "late net", "taken down at will"), (it) => it.zW, (it) => it.yW, false);
  for (const it of items) { it.A = it.Ad; it.B = it.Bd; }
  show(`ROUNDS recency ${DECAY} set`, pickF(ROUNDS, "R1 threat × R1 leak", "ctrl per TD"), (it) => it.zR, (it) => it.yR, true);
}
