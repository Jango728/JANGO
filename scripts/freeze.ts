/**
 * Freeze and revise engine picks for every upcoming card in data/ledger/<event>.json.
 *
 * OPENING pick: the first freeze of a bout. Its fields are permanent — never edited, never deleted.
 * REVISIONS: when the engine's call for a bout changes MATERIALLY before the card locks, a revision
 *   is appended to that bout's `revisions` list (append-only; earlier revisions are never touched).
 *   Material = winner side changes (incl. pick ↔ N/A), rounds side or line changes, method changes,
 *   or confidence moves ≥ REVISION_CONFIDENCE_STEP (5) points. Smaller wobbles are ignored.
 * LOCK: picks lock at the card's earliest listed start time (Toronto); with no time, at midnight
 *   Toronto on the event date. No revisions — and no new freezes — at or after the lock, and never
 *   on a card that has results.
 * REPLACEMENTS: a bout whose opponent changes is a NEW bout with its own opening pick. The old bout
 *   stays in the file, marked status "replaced" (or "cancelled" if nobody stepped in); it is never deleted.
 * FINAL pick = last revision before lock, else the opening pick (lib/ledger.ts: finalCall). The track
 *   record grades the final pick and also shows the opening-pick record.
 *
 * Usage: npx tsx scripts/freeze.ts [--dry-run] [--event <id>] [--reason "<text>"]
 *   --dry-run  print what would change, write nothing
 *   --event    only this card
 *   --reason   extra plain-English reason appended to every revision made in this run (use with --event)
 * Env: JANGO_NOW=<ISO time> pretends it is that moment (for testing the lock rule).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SEED_EVENTS, SEED_FIGHTERS } from "../lib/data";
import { predict, ENGINE_VERSION } from "../lib/engine";
import { predictRounds } from "../lib/rounds";
import { predictFinish } from "../lib/finish";
import { scoutNotes } from "../lib/scouting";
import type { FrozenPick, Ledger, Method, PickCall, PickInputs, PickRevision } from "../lib/ledger-types";
import type { Event, Fight, Fighter } from "../lib/types";
import { lockAtFor, materialChanges, sameBout, sameFighter, sidePicked, torontoDate } from "../lib/ledger";

/** One-line summary of what each engine version changed, used in revision reasons. */
const ENGINE_NOTES: Record<string, string> = {
  "1.1": "scouting notes",
  "1.2": "calibrated confidence, as-of-date stats",
  "1.3": "round-by-round tape: late-round output, takedown defence, early finish threat",
};

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes("--dry-run");
const ONLY = flag("--event");
const EXTRA = flag("--reason");

// JANGO_NOW=<ISO> pretends it's that moment (testing the lock rule); normal runs use the clock.
const now = process.env.JANGO_NOW ? new Date(process.env.JANGO_NOW) : new Date();
const nowIso = now.toISOString();
const today = torontoDate(now);
const methodName = (m?: string): Method | null => (m === "ko" ? "KO/TKO" : m === "submission" ? "Submission" : m === "decision" ? "Decision" : null);
const round1 = (x: number) => Math.round(x * 10) / 10;

function callFor(f: Fight, a: Fighter, b: Fighter, e: Event) {
  const p = predict(f, a, b, e);
  const r = predictRounds(f, a, b, e);
  const fin = predictFinish(f, a, b, e, p.pick);
  const call: PickCall = {
    pick: p.pick ? SEED_FIGHTERS[p.pick].name : null,
    confidence: p.confidence, tier: p.tier,
    rounds: r ? { line: r.line, side: r.side as "Over" | "Under" } : null,
    method: methodName(fin?.method),
    // A null pick must say why (validate-data flags an unexplained N/A).
    ...(p.pick ? {} : { naReason: p.pendingReason ?? "Too little verified data to make an honest pick." }),
  };
  return { call, p };
}

/** What the engine saw, in the ledger bout's a/b order (flip = the seed lists the corners the other way round). */
function inputsFor(f: Fight, a: Fighter, b: Fighter, e: Event, flip: boolean): PickInputs {
  const fw = f.fightWeek;
  const miss = (s: "a" | "b") => {
    const w = fw?.weighIn?.[s];
    if (!w) return 0;
    if (w.missedBy != null) return round1(w.missedBy);
    return w.missed && w.lbs != null && fw?.weighIn?.limit != null ? round1(Math.max(0, w.lbs - fw.weighIn.limit - 1)) : w.missed ? 0.1 : 0;
  };
  const last = (x: Fighter) => x.history.reduce<string | null>((m, h) => (h.date > (m ?? "") ? h.date : m), null);
  const pair = <T,>(x: T, y: T): [T, T] => (flip ? [y, x] : [x, y]);
  const side = (s: "a" | "b"): "a" | "b" => (flip ? (s === "a" ? "b" : "a") : s);
  const out: PickInputs = {
    scheduledRounds: f.rounds,
    division: f.division,
    records: pair(a.record ?? null, b.record ?? null),
    lastFights: pair(last(a), last(b)),
    scouting: pair(scoutNotes(a.id, e.date).length, scoutNotes(b.id, e.date).length),
  };
  if (fw?.weighIn) out.missedBy = pair(miss("a"), miss("b"));
  if (fw?.weighIn?.catchweight) out.catchweight = true;
  if (fw?.shortNotice) out.shortNotice = { fighter: side(fw.shortNotice.fighter), days: fw.shortNotice.daysNotice };
  if (fw?.divisionChange?.length) out.divisionChange = fw.divisionChange.map((d) => side(d.fighter));
  return out;
}

/** Plain-English why, derived from what changed between the previous pick and now. */
function reasonFor(prevEngine: string | undefined, prev: PickInputs | undefined, cur: PickInputs, names: [string, string]): string {
  const parts: string[] = [];
  if (prevEngine !== ENGINE_VERSION) parts.push(`Engine ${ENGINE_VERSION} update${ENGINE_NOTES[ENGINE_VERSION] ? ` (${ENGINE_NOTES[ENGINE_VERSION]})` : ""}`);
  const sides = [0, 1] as const;
  if (cur.missedBy) for (const i of sides) if (cur.missedBy[i] > 0 && cur.missedBy[i] !== prev?.missedBy?.[i]) parts.push(`Missed weight by ${cur.missedBy[i]} lb (${names[i]})`);
  if (cur.catchweight && !prev?.catchweight) parts.push("Moved to a catchweight");
  if (cur.shortNotice && !prev?.shortNotice) parts.push(`Short-notice booking (${names[cur.shortNotice.fighter === "a" ? 0 : 1]}, ${cur.shortNotice.days} days)`);
  for (const s of cur.divisionChange ?? []) if (!prev?.divisionChange?.includes(s)) parts.push(`Division change (${names[s === "a" ? 0 : 1]})`);
  if (prev) {
    if (cur.scheduledRounds !== prev.scheduledRounds) parts.push(`Now ${cur.scheduledRounds} rounds (was ${prev.scheduledRounds})`);
    if (cur.division && prev.division && cur.division !== prev.division) parts.push(`Weight class now ${cur.division}`);
    for (const i of sides) {
      if (cur.lastFights[i] !== prev.lastFights[i]) parts.push(`New result for ${names[i]}${cur.lastFights[i] ? ` (${cur.lastFights[i]})` : ""}`);
      else if (cur.records[i] !== prev.records[i]) parts.push(`Record corrected: ${names[i]} ${prev.records[i] ?? "?"} → ${cur.records[i] ?? "?"}`);
    }
    for (const i of sides) if (cur.scouting[i] > prev.scouting[i]) parts.push(`New scouting notes on ${names[i]}`);
  }
  if (!parts.length)
    parts.push(prev ? "New information: updated fighter stats or fight-history details" : "New information: fighter data updated since the opening freeze");
  const shown = parts.slice(0, 3).join("; ") + (parts.length > 3 ? ` (+${parts.length - 3} more)` : "");
  return EXTRA ? `${shown}; ${EXTRA}` : shown;
}

/** Keep ledger keys in a stable, readable order. */
const ordered = (l: Ledger): Ledger => {
  const { eventId, title, date, lockAt, promotion, forecast, results, review, ...rest } = l;
  return { eventId, title, date, lockAt, promotion, forecast, results, review, ...rest } as Ledger;
};

const log: string[] = [];
let filesWritten = 0, opened = 0, revised = 0, retired = 0;
for (const e of SEED_EVENTS) {
  if (ONLY && e.id !== ONLY) continue;
  if (!e.fights.length) continue;
  const lockAt = lockAtFor(e.date, e.time);
  if (now.getTime() >= Date.parse(lockAt)) continue; // locked: no freezes, no revisions
  const file = `data/ledger/${e.id}.json`;
  const ledger: Ledger = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { eventId: e.id, title: e.title, date: e.date, promotion: e.promotion, forecast: null, results: null, review: null };
  if (ledger.results) continue; // results (even live ones) = the card has started
  const before = JSON.stringify(ledger);
  ledger.title = e.title;
  ledger.date = e.date;
  ledger.lockAt = lockAt;
  const cardEngine = ledger.forecast?.engine;
  const bouts: FrozenPick[] = ledger.forecast?.bouts ?? [];
  const fresh: { f: Fight; a: Fighter; b: Fighter }[] = [];
  const onCard: FrozenPick[] = [];

  for (const f of e.fights) {
    const a = SEED_FIGHTERS[f.a], b = SEED_FIGHTERS[f.b];
    if (!a || !b) continue;
    const names = { a: a.name, b: b.name };
    const existing = bouts.find((x) => !x.status && sameBout(x, names)) ?? bouts.find((x) => sameBout(x, names));
    if (!existing) { fresh.push({ f, a, b }); continue; }
    onCard.push(existing);
    if (existing.status) {
      // Back on the card before lock (a cancellation that was reversed): the same pick record resumes.
      log.push(`${e.id}: ${existing.a} vs ${existing.b} is back on the card (was ${existing.status})`);
      delete existing.status; delete existing.statusAt; delete existing.statusNote; delete existing.replacedBy;
    }
    const { call } = callFor(f, a, b, e);
    const flip = sidePicked(a.name, existing) === "b";
    const inputs = inputsFor(f, a, b, e, flip);
    const lastRev = existing.revisions?.[existing.revisions.length - 1];
    const prevCall: PickCall = lastRev ?? existing;
    const changed = materialChanges(prevCall, call, existing);
    if (!changed.length) continue;
    const prevEngine = lastRev?.engine ?? existing.engine ?? cardEngine;
    const reason = reasonFor(prevEngine, lastRev?.inputs ?? existing.inputs, inputs, [existing.a, existing.b]);
    const rev: PickRevision = { at: nowIso, engine: ENGINE_VERSION, ...call, reason, changed, inputs };
    existing.revisions = [...(existing.revisions ?? []), rev];
    revised++;
    const fmt = (c: PickCall) => `${c.pick ?? "N/A"}${c.confidence != null ? ` ${c.confidence}%` : ""} · ${c.rounds ? `${c.rounds.side} ${c.rounds.line}` : "—"} · ${c.method ?? "—"}`;
    log.push(`${e.id}: REVISED ${existing.a} vs ${existing.b}: ${fmt(prevCall)} → ${fmt(call)} [${changed.join(", ")}] · ${reason}`);
  }

  // Bouts that fell off the card: replaced (a fighter on it now faces someone new) or cancelled. Never deleted.
  for (const x of bouts) {
    if (x.status || onCard.includes(x)) continue;
    const repl = fresh.find(({ a, b }) => [a.name, b.name].some((n) => sameFighter(n, x.a) || sameFighter(n, x.b)));
    x.statusAt = nowIso;
    if (repl) {
      const stays = [repl.a.name, repl.b.name].find((n) => sameFighter(n, x.a) || sameFighter(n, x.b))!;
      const out = sameFighter(stays, x.a) ? x.b : x.a;
      const inn = sameFighter(stays, repl.a.name) ? repl.b.name : repl.a.name;
      x.status = "replaced";
      x.replacedBy = { a: repl.a.name, b: repl.b.name };
      x.statusNote = `${out} out; ${inn} steps in against ${stays}`;
      log.push(`${e.id}: REPLACED ${x.a} vs ${x.b} → ${repl.a.name} vs ${repl.b.name}`);
    } else {
      x.status = "cancelled";
      x.statusNote = "No longer on the card";
      log.push(`${e.id}: CANCELLED ${x.a} vs ${x.b} (kept on record, ungraded)`);
    }
    retired++;
  }

  // New bouts (incl. replacements) get their own opening pick.
  for (const { f, a, b } of fresh) {
    const { call, p } = callFor(f, a, b, e);
    const replaced = bouts.find((x) => x.status === "replaced" && x.replacedBy && sameBout(x.replacedBy, { a: a.name, b: b.name }));
    const sn = f.fightWeek?.shortNotice;
    const note = replaced ? `Replacement opponent${sn ? ` (short notice, ${sn.daysNotice} days)` : ""}` : sn ? `Late booking (short notice, ${sn.daysNotice} days)` : undefined;
    bouts.push({
      a: a.name, b: b.name,
      ...call,
      scheduledRounds: f.rounds,
      evidence: p.evidence,
      reasons: p.reasons.map((x) => `${x.title}: ${x.text}`),
      ...(ledger.forecast ? { frozenAt: nowIso } : {}),
      engine: ENGINE_VERSION,
      inputs: inputsFor(f, a, b, e, false),
      ...(replaced ? { replaces: { a: replaced.a, b: replaced.b } } : {}),
      ...(note ? { note } : {}),
    } as FrozenPick);
    opened++;
    log.push(`${e.id}: OPENED ${a.name} vs ${b.name}: ${call.pick ?? "N/A"}${call.confidence != null ? ` ${call.confidence}%` : ""}${note ? ` · ${note}` : ""}`);
  }

  if (!bouts.length) continue;
  ledger.forecast = ledger.forecast ?? { engine: ENGINE_VERSION, frozenAt: nowIso, basis: "Engine output frozen before the event. Opening picks are never edited; later material changes before lock are appended as revisions.", bouts: [] };
  ledger.forecast.bouts = bouts;
  if (JSON.stringify(ledger) === before) continue;
  if (!DRY) writeFileSync(file, JSON.stringify(ordered(ledger), null, 1) + "\n");
  filesWritten++;
}
for (const l of log) console.log(l);
console.log(`${DRY ? "[dry run] " : ""}today ${today} (Toronto) · engine ${ENGINE_VERSION} · ${opened} opened · ${revised} revised · ${retired} replaced/cancelled · ${filesWritten} ledger file(s) ${DRY ? "would change" : "updated"}`);
