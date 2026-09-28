/**
 * Publication gate: fails (exit 1) only on data that would mislead or break the site.
 * Staleness and completeness gaps are WARNINGS and never block a publish.
 * Run before every publish: `npm run validate` (part of `npm run check`).
 *
 * Rule of thumb for severity: an ERROR must be something the nightly run can fix on its own
 * (a bad results row, an unfrozen fight-day bout, a missing portrait file). Anything that can't
 * be fixed overnight (frozen forecasts are permanent, upstream data lag) is a warning.
 *
 * Env: JANGO_TODAY=YYYY-MM-DD overrides "today" (Toronto date) for testing.
 *      VALIDATE_VERBOSE=1 prints every warning (default: up to 12 per category).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import seedRaw from "../lib/seed.json";
import { SEED_EVENTS, SEED_FIGHTERS, PROMOTIONS, CHECKED_AT } from "../lib/data";
import { predict } from "../lib/engine";
import { predictRounds } from "../lib/rounds";
import { ledgers, sameBout, sameFighter, scoredBouts, ledgerLockAt, lockAtFor, materialChanges } from "../lib/ledger";
import { DIVISIONS, RANKINGS_AS_OF, NEXT_IN_LINE_AS_OF } from "../lib/rankings";
import { DWCS_WEEK7_EVENT, DWCS_WEEK7_FIGHTERS } from "../lib/dwcs-week7";
import { endedByFinish, followUpFor } from "../lib/round-recaps";
import type { Fighter } from "../lib/types";
import type { FrozenPick, Ledger } from "../lib/ledger-types";

type Sev = "error" | "warn";
const issues: { sev: Sev; cat: string; msg: string }[] = [];
const err = (cat: string, msg: string) => issues.push({ sev: "error", cat, msg });
const warn = (cat: string, msg: string) => issues.push({ sev: "warn", cat, msg });

// ---------- dates (Toronto) ----------
const torontoDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const today = process.env.JANGO_TODAY || torontoDate();
const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / DAY);
/** "Sep 22, 2026" or "2026-09-22" → "2026-09-22" (null if unparseable). */
const isoOf = (s: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s + " 12:00 UTC");
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const yesterday = addDays(today, -1);

/** Fields and passes introduced on this date are only expected for events on/after it (older cards are grandfathered). */
const POSTFIGHT_SINCE = "2026-09-26";
/** Round-by-round recaps (rounds + recap) are expected on finished UFC / DWCS cards from this date (warnings). Move it earlier to widen the backfill. */
const ROUNDS_SINCE = "2026-09-12";
/** From this card date on, a review can't be "final" while a main-card bout lacks rounds (ERROR). Earlier finals only warn. */
const ROUNDS_FINAL_GATE_SINCE = "2026-09-26";

// ---------- published assets (live runs skip the image restore) ----------
const published = new Set<string>(existsSync(".published.json") ? (JSON.parse(readFileSync(".published.json", "utf8")) as string[]) : []);
const assetExists = (rel: string) => existsSync("public/" + rel) || published.has(rel);

// ---------- fighters ----------
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const rawSeedIds = new Set(Object.keys((seedRaw as { fighters: Record<string, unknown> }).fighters));
{
  const byName = new Map<string, string[]>();
  for (const [id, f] of Object.entries(SEED_FIGHTERS)) {
    if (f.id !== id) err("fighters", `${id}: profile id is "${f.id}" (must match its key)`);
    const k = norm(f.name);
    byName.set(k, [...(byName.get(k) ?? []), id]);
  }
  for (const ids of byName.values()) {
    if (ids.length < 2) continue;
    const dobs = new Set(ids.map((i) => SEED_FIGHTERS[i].birthDate).filter(Boolean));
    const sameDob = dobs.size === 1 && ids.every((i) => SEED_FIGHTERS[i].birthDate);
    (sameDob ? err : warn)("fighters", `same person twice? ${ids.join(" / ")} share the name "${SEED_FIGHTERS[ids[0]].name}"${sameDob ? " and birth date" : " (fine if namesakes; add birthDate to tell them apart)"}`);
  }
}
// lib/dwcs-week7.ts is merged over the seed; an overlapping id would silently replace a seed profile.
for (const id of Object.keys(DWCS_WEEK7_FIGHTERS)) if (rawSeedIds.has(id)) err("fighters", `${id}: defined in both lib/seed.json and lib/dwcs-week7.ts (the TS copy wins silently)`);
if ((seedRaw as { events: { id: string }[] }).events.some((x) => x.id === DWCS_WEEK7_EVENT.id)) err("events", `${DWCS_WEEK7_EVENT.id}: defined in both lib/seed.json and lib/dwcs-week7.ts`);

const upcomingIds = new Set<string>();
const lastEventDate = new Map<string, string>();
for (const e of SEED_EVENTS) for (const f of e.fights) for (const x of [f.a, f.b]) {
  if (e.date >= today) upcomingIds.add(x);
  if (e.date > (lastEventDate.get(x) ?? "")) lastEventDate.set(x, e.date);
}

function checkFighter(x: Fighter, where: string) {
  // Measurements are stored in centimetres. Inches typed into a cm field (e.g. 70) would silently shrink a fighter.
  if (x.height !== undefined && !(145 <= x.height && x.height <= 215)) err("measurements", `${where}: ${x.name} height ${x.height} cm is not plausible (store cm: 5'11" = 180.3)`);
  if (x.reach !== undefined && !(140 <= x.reach && x.reach <= 225)) err("measurements", `${where}: ${x.name} reach ${x.reach} cm is not plausible (store cm: 72" = 182.9)`);
  if (x.height && x.reach && Math.abs(x.reach - x.height) > 22) warn("measurements", `${where}: ${x.name} reach − height = ${(x.reach - x.height).toFixed(1)} cm (unusual; double-check)`);
  if (x.image && !assetExists(x.image.replace(/^\//, ""))) err("portraits", `${where}: ${x.name} portrait file missing (${x.image})`);
  if (x.image?.startsWith("/")) err("portraits", `${where}: ${x.name} portrait path must be relative`);
  if (x.birthDate && !ISO.test(x.birthDate)) warn("fighters", `${where}: ${x.name} birthDate "${x.birthDate}" is not YYYY-MM-DD`);
  // History sanity
  const seen = new Set<string>();
  for (const h of x.history) {
    if (!ISO.test(h.date)) { warn("history", `${x.name}: history row with bad date "${h.date}"`); continue; }
    if (h.date > today) err("history", `${x.name}: history row dated in the future (${h.date} vs ${h.opponent})`);
    const k = h.date + "|" + norm(h.opponent);
    if (seen.has(k)) err("history", `${x.name}: duplicate history row ${h.date} vs ${h.opponent} (double-counts in the model)`);
    seen.add(k);
    if (h.round !== undefined && h.scheduledRounds !== undefined && h.round > h.scheduledRounds) warn("history", `${x.name}: ${h.date} round ${h.round} > scheduled ${h.scheduledRounds}`);
  }
  // Record vs history, where the history claims to be complete. A finished card may keep the pre-fight record,
  // so accept either the full count or the count before the fighter's latest card; fighters on upcoming cards need the full count.
  const m = /^(\d+)-(\d+)-(\d+)/.exec(x.record ?? "");
  if (x.historyComplete && m) {
    const rec = m.slice(1).map(Number).join("-");
    const mma = x.history.filter((h) => (h.rules ?? "MMA") === "MMA");
    const count = (rows: typeof mma) => ["W", "L", "D"].map((r) => rows.filter((h) => h.result === r).length).join("-");
    const full = count(mma);
    const last = lastEventDate.get(x.id);
    const pre = last ? count(mma.filter((h) => h.date < last)) : full;
    if (rec !== full && (upcomingIds.has(x.id) || rec !== pre))
      warn("record-vs-history", `${x.name}: record ${x.record} but complete history counts ${full}${upcomingIds.has(x.id) ? " (on an upcoming card: update the record or the history)" : ""}`);
  }
}
for (const [id, f] of Object.entries(SEED_FIGHTERS)) checkFighter(f, id);

// ---------- events / cards ----------
const eventIds = new Set<string>(), fightIds = new Set<string>();
const ledgerById = new Map<string, Ledger>(ledgers.map((l) => [l.eventId, l]));
let venueMissing: string[] = [];
for (const e of SEED_EVENTS) {
  if (eventIds.has(e.id)) err("events", `${e.id}: duplicate event id`);
  eventIds.add(e.id);
  if (!ISO.test(e.date)) err("events", `${e.id}: date "${e.date}" is not YYYY-MM-DD`);
  if (!(PROMOTIONS as readonly string[]).includes(e.promotion)) err("events", `${e.id}: promotion ${e.promotion} is not allowed`);
  const upcoming = e.date >= today;
  const daysOut = daysBetween(today, e.date);
  if (upcoming && daysOut <= 21 && e.fights.length && !e.venue) venueMissing.push(e.id);
  const seen = new Set<string>();
  e.fights.forEach((f, i) => {
    const a = SEED_FIGHTERS[f.a], b = SEED_FIGHTERS[f.b];
    const tag = `${e.id} #${i + 1}`;
    if (fightIds.has(f.id)) err("events", `${tag}: duplicate fight id ${f.id}`);
    fightIds.add(f.id);
    if (!a || !b) return err("events", `${tag}: missing fighter profile (${f.a} / ${f.b})`);
    if (f.a === f.b) err("events", `${tag}: fighter booked against himself`);
    for (const x of [f.a, f.b]) {
      if (seen.has(x)) err("events", `${tag}: ${SEED_FIGHTERS[x].name} appears twice on the card`);
      seen.add(x);
    }
    if (![3, 5].includes(f.rounds)) err("rounds", `${tag}: ${a.name} vs ${b.name} scheduled for ${f.rounds} rounds (must be 3 or 5)`);
    if (i === 0 && e.promotion === "UFC" && f.rounds !== 5) warn("rounds", `${tag}: UFC main event is ${f.rounds} rounds`);
    if (i > 0 && f.rounds === 5 && !/title/i.test([...f.notes, f.division].join(" ")) && e.promotion !== "UFC") warn("rounds", `${tag}: 5 rounds but not the main event (fine for a title fight; say so in notes)`);
    if (f.odds && (!ISO.test(f.odds.asOf.slice(0, 10)) || !f.odds.source)) warn("odds", `${tag}: display odds need asOf + source`);
    if (!upcoming) return;
    // Upcoming only: completeness of the tale of the tape (past cards are history; gaps there are noise).
    for (const x of [a, b]) {
      if (!x.record || !/^\d+-\d+-\d+/.test(x.record)) warn("profiles", `${tag}: ${x.name} record missing`);
      if (!x.height) warn("profiles", `${tag}: ${x.name} height missing`);
      if (!x.reach) warn("profiles", `${tag}: ${x.name} reach missing`);
    }
    const p = predict(f, a, b, e);
    const r = predictRounds(f, a, b, e);
    if (!r) err("picks", `${tag}: no rounds pick`);
    if (p.status === "pending") warn("picks", `${tag}: ${a.name} vs ${b.name} pick pending — ${p.pendingReason}`);
    if (p.confidence !== null && (p.confidence < 50 || p.confidence > 90)) err("picks", `${tag}: confidence ${p.confidence} out of range`);
    // Display odds freshness in fight week (display only; never a model input).
    if (daysOut <= 3 && f.odds && daysBetween(f.odds.asOf.slice(0, 10), today) > 2) warn("odds", `${tag}: display odds are from ${f.odds.asOf.slice(0, 10)} (fight in ${daysOut}d)`);
    // Fight-week facts
    const fw = f.fightWeek;
    if (fw?.shortNotice && !(fw.shortNotice.daysNotice >= 0 && ISO.test(fw.shortNotice.announced))) warn("fight-week", `${tag}: shortNotice needs announced (YYYY-MM-DD) and daysNotice ≥ 0`);
    if (fw?.weighIn && !(ISO.test(fw.weighIn.checked) && fw.weighIn.source)) warn("fight-week", `${tag}: weighIn needs checked + source`);
    // Frozen pick by fight day (freeze.ts must have run). ERROR on the day before / day of: the nightly fixes it by running freeze.
    const l = ledgerById.get(e.id);
    const frozen = l?.forecast?.bouts.find((x) => sameBout(x, { a: a.name, b: b.name }));
    if (!frozen && !l?.results) (daysOut <= 1 ? err : warn)("freeze", `${tag}: ${a.name} vs ${b.name} has no frozen pick (fight in ${daysOut}d) — run npx tsx scripts/freeze.ts`);
    if (frozen && frozen.pick === null && !frozen.naReason && !frozen.reasons?.length) warn("freeze", `${tag}: frozen pick is null with no N/A reason`);
  });
  // Weigh-ins: on fight day the official weigh-ins (day before) should be recorded for UFC/DWCS/PFL cards.
  if (e.date === today && e.fights.length && ["UFC", "DWCS", "PFL"].includes(e.promotion) && !e.fightWeek?.weighInsChecked && !e.fights.some((f) => f.fightWeek?.weighIn))
    warn("fight-week", `${e.id}: fight day but official weigh-ins not recorded (set event.fightWeek.weighInsChecked; per-bout misses in fight.fightWeek.weighIn)`);
  if (e.changes) for (const c of e.changes) if (!ISO.test(c.date) || !c.source) warn("fight-week", `${e.id}: card change "${c.note}" needs date + source`);
}
if (venueMissing.length) warn("venue", `${venueMissing.length} card(s) in the next 21 days have no venue info (altitudeM / cageFt / tz): ${venueMissing.join(", ")}`);

// Orphan portraits cost artifact file slots (limit ~511 files per version).
if (existsSync("public/fighters")) {
  const used = new Set(Object.values(SEED_FIGHTERS).map((f) => f.image?.replace(/^\//, "")).filter(Boolean) as string[]);
  const orphans = readdirSync("public/fighters").map((f) => "fighters/" + f).filter((f) => !used.has(f));
  if (orphans.length) warn("artifact", `${orphans.length} portrait file(s) in public/fighters are not used by any fighter: ${orphans.slice(0, 8).join(", ")}${orphans.length > 8 ? " …" : ""}`);
}

// ---------- ledgers ----------
const seedById = new Map(SEED_EVENTS.map((e) => [e.id, e]));
const ledgerFiles = existsSync("data/ledger") ? readdirSync("data/ledger").filter((f) => f.endsWith(".json")) : [];
for (const f of ledgerFiles) {
  const l = JSON.parse(readFileSync("data/ledger/" + f, "utf8")) as Ledger;
  if (l.eventId + ".json" !== f) err("ledger", `data/ledger/${f}: eventId is "${l.eventId}" (must match the file name)`);
}
// ---------- pick revisions (see scripts/freeze.ts and docs/SCHEMA.md) ----------
/** A card's ledger as committed at git HEAD (the nightly's restore baseline), or null when git / the file isn't available. */
function headLedger(file: string): Ledger | null {
  try {
    return JSON.parse(execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as Ledger;
  } catch {
    return null;
  }
}
const OPENING_KEYS = ["pick", "confidence", "tier", "rounds", "method", "scheduledRounds", "frozenAt", "naReason", "engine"] as const;
const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
function checkRevisions(l: Ledger) {
  const L = `ledger ${l.eventId}`;
  const lockAt = ledgerLockAt(l);
  const anyRevs = l.forecast!.bouts.some((b) => b.revisions?.length);
  if (anyRevs && !l.lockAt) err("revisions", `${L}: has pick revisions but no lockAt (freeze.ts writes it)`);
  const seedEvent = SEED_EVENTS.find((e) => e.id === l.eventId);
  if (l.lockAt && seedEvent && !l.results && l.lockAt !== lockAtFor(seedEvent.date, seedEvent.time))
    warn("revisions", `${L}: lockAt ${l.lockAt} differs from the card's start (${lockAtFor(seedEvent.date, seedEvent.time)}) — re-run freeze.ts`);
  for (const b of l.forecast!.bouts) {
    const B = `${L}: ${b.a} vs ${b.b}`;
    let prevAt = b.frozenAt ?? l.forecast!.frozenAt;
    let prev: FrozenPick | NonNullable<FrozenPick["revisions"]>[number] = b;
    for (const [i, r] of (b.revisions ?? []).entries()) {
      const R = `${B} revision #${i + 1}`;
      if (Number.isNaN(Date.parse(r.at))) { err("revisions", `${R}: "at" is not an ISO time`); continue; }
      if (Date.parse(r.at) >= Date.parse(lockAt)) err("revisions", `${R}: made ${r.at}, at or after the lock (${lockAt}) — picks can't change once the card starts`);
      if (Date.parse(r.at) <= Date.parse(prevAt)) err("revisions", `${R}: not after the previous pick (${prevAt}) — revisions must be chronological`);
      if (!r.reason?.trim()) err("revisions", `${R}: no reason`);
      if (!r.engine) err("revisions", `${R}: no engine version`);
      if (!r.changed?.length) err("revisions", `${R}: "changed" is empty (a revision needs a material change)`);
      if (r.pick === null && !r.naReason) warn("revisions", `${R}: pick is null with no N/A reason`);
      if (r.confidence !== null && (r.confidence < 50 || r.confidence > 100)) warn("revisions", `${R}: confidence ${r.confidence}`);
      if (!materialChanges(prev, r, b).length) warn("revisions", `${R}: not a material change from the previous pick (threshold: side, rounds, method, or ≥5 confidence points)`);
      prevAt = r.at;
      prev = r;
    }
    if (b.status && !["cancelled", "replaced"].includes(b.status)) err("revisions", `${B}: unknown status "${b.status}"`);
    if (b.status === "replaced" && !b.replacedBy) warn("revisions", `${B}: replaced but no replacedBy`);
    if (b.status && l.results?.bouts.some((x) => sameBout(x, b))) warn("revisions", `${B}: marked ${b.status} but has a result`);
  }
  // Append-only against the committed version: opening picks unchanged, no bout removed, earlier revisions untouched.
  const head = headLedger(`data/ledger/${l.eventId}.json`);
  if (!head?.forecast) return;
  if (head.forecast.frozenAt !== l.forecast!.frozenAt || head.forecast.engine !== l.forecast!.engine) err("revisions", `${L}: forecast frozenAt/engine changed vs git HEAD (opening forecasts are permanent)`);
  for (const hb of head.forecast.bouts) {
    const cur = l.forecast!.bouts.find((x) => x.a === hb.a && x.b === hb.b);
    const B = `${L}: ${hb.a} vs ${hb.b}`;
    if (!cur) { err("revisions", `${B}: frozen bout removed vs git HEAD (mark it cancelled/replaced instead)`); continue; }
    const edited = OPENING_KEYS.filter((k) => !same(hb[k], cur[k]));
    if (edited.length) err("revisions", `${B}: opening pick edited vs git HEAD (${edited.join(", ")})`);
    const hr = hb.revisions ?? [], cr = cur.revisions ?? [];
    if (cr.length < hr.length || hr.some((r, i) => !same(r, cr[i]))) err("revisions", `${B}: earlier revisions changed or removed vs git HEAD (append-only)`);
    if (hb.status && !cur.status) warn("revisions", `${B}: was ${hb.status} at git HEAD, now back on the card`);
  }
}

let scoutNotes: { fighter: string; date: string }[] = [];
try { scoutNotes = (JSON.parse(readFileSync("data/scouting.json", "utf8")) as { notes: { fighter: string; date: string }[] }).notes ?? []; }
catch (e) { err("scouting", `data/scouting.json unreadable: ${(e as Error).message}`); }
const METHODS = ["KO/TKO", "Submission", "Decision", "Draw", "No contest", "DQ"];
for (const l of ledgers) {
  const L = `ledger ${l.eventId}`;
  if (!(PROMOTIONS as readonly string[]).includes(l.promotion)) err("ledger", `${L}: promotion ${l.promotion} is not allowed`);
  // Forecasts are permanent, so problems in them can only be warnings.
  if (l.forecast) {
    if (l.forecast.frozenAt.slice(0, 10) > l.date) err("ledger", `${L}: forecast frozen after the event`);
    for (const b of l.forecast.bouts) {
      if (b.frozenAt && b.frozenAt.slice(0, 10) > l.date) warn("ledger", `${L}: ${b.a} vs ${b.b} frozen after the event (${b.frozenAt})`);
      if (![3, 5].includes(b.scheduledRounds)) warn("ledger", `${L}: frozen ${b.a} vs ${b.b} has ${b.scheduledRounds} scheduled rounds`);
      if (b.rounds && ![1.5, 2.5].includes(b.rounds.line)) warn("ledger", `${L}: frozen ${b.a} vs ${b.b} rounds line ${b.rounds.line}`);
      if (b.confidence !== null && (b.confidence < 50 || b.confidence > 100)) warn("ledger", `${L}: frozen ${b.a} vs ${b.b} confidence ${b.confidence}`);
    }
    checkRevisions(l);
  }
  const finished = l.date < today;
  const seedEvent = seedById.get(l.eventId);
  if (l.results) {
    for (const b of l.results.bouts) {
      const B = `${L}: ${b.a} vs ${b.b}`;
      if (![1.5, 2.5].includes(b.line)) err("results", `${B}: bad O/U line ${b.line}`);
      if (![3, 5].includes(b.scheduledRounds)) err("results", `${B}: scheduledRounds ${b.scheduledRounds} (must be 3 or 5)`);
      else if (b.line !== (b.scheduledRounds === 5 ? 2.5 : 1.5)) warn("results", `${B}: line ${b.line} for a ${b.scheduledRounds}-round fight`);
      if (!METHODS.includes(b.method)) err("results", `${B}: unknown method "${b.method}"`);
      const tm = /^(\d):([0-5]\d)$/.exec(b.time);
      if (!tm || +tm[1] * 60 + +tm[2] > 300 || +tm[1] * 60 + +tm[2] === 0) err("results", `${B}: time "${b.time}" (must be m:ss, 0:01–5:00)`);
      if (!(b.round >= 1 && b.round <= b.scheduledRounds)) err("results", `${B}: round ${b.round} outside 1–${b.scheduledRounds}`);
      if (tm && b.round >= 1) {
        const elapsed = (b.round - 1) * 5 + +tm[1] + +tm[2] / 60;
        const ou = elapsed > b.line * 5 ? "Over" : "Under";
        if (ou !== b.ou) err("results", `${B}: ou "${b.ou}" but R${b.round} ${b.time} vs line ${b.line} is ${ou}`);
      }
      const noWinner = b.method === "Draw" || b.method === "No contest";
      if (noWinner && (b.winner || b.loser)) err("results", `${B}: ${b.method} must have winner and loser null`);
      if (!noWinner) {
        if (!b.winner || !b.loser) err("results", `${B}: ${b.method} needs a winner and a loser`);
        else if (!((sameFighter(b.winner, b.a) && sameFighter(b.loser, b.b)) || (sameFighter(b.winner, b.b) && sameFighter(b.loser, b.a)))) err("results", `${B}: winner/loser don't match the bout`);
      }
      if (b.method === "Decision" && (b.round !== b.scheduledRounds || b.time !== "5:00")) warn("results", `${B}: decision logged at R${b.round} ${b.time}`);
      if (b.change && !(ISO.test(b.change.date) && b.change.source)) warn("results", `${B}: result change needs date + source`);
      if (b.closingOdds && !(ISO.test(b.closingOdds.asOf.slice(0, 10)) && b.closingOdds.source)) warn("results", `${B}: closingOdds need asOf + source`);
      if (b.scorecards?.judges && b.scorecards.judges.length !== 3) warn("results", `${B}: ${b.scorecards.judges.length} judges' cards (expected 3)`);
    }
    if (l.results.live && l.date < yesterday) warn("results", `${L}: results still marked live ${daysBetween(l.date, today)} days after the event — verify and set live=false`);
    if (seedEvent && finished && !l.results.live && l.results.bouts.length < seedEvent.fights.length)
      warn("results", `${L}: ${l.results.bouts.length}/${seedEvent.fights.length} bouts have results (log cancellations in a note)`);
    // Post-fight completeness for recent cards (display + benchmark data; soft).
    if (l.date >= POSTFIGHT_SINCE && !l.results.live) {
      const decided = l.results.bouts.filter((b) => b.winner);
      const noOdds = decided.filter((b) => !b.closingOdds).length;
      if (noOdds) warn("benchmark", `${L}: ${noOdds}/${decided.length} bouts lack closingOdds (display-only market benchmark)`);
      const noCards = l.results.bouts.filter((b) => b.method === "Decision" && !b.scorecards).length;
      if (noCards) warn("postfight", `${L}: ${noCards} decision(s) without scorecards`);
    }
  } else if (finished && l.date <= yesterday && (l.forecast || seedEvent?.fights.length)) {
    warn("results", `${L}: event was ${l.date} and has no results yet`);
  }
  // Reviews
  if (l.results && !l.results.live && l.date <= yesterday && l.forecast && !l.review) warn("reviews", `${L}: results logged but no review`);
  if (l.review) {
    const r = l.review;
    if (!ISO.test(r.followUpUntil)) warn("reviews", `${L}: followUpUntil "${r.followUpUntil}" is not a date`);
    else if (r.followUpUntil < today && r.status !== "final") warn("reviews", `${L}: follow-up window ended ${r.followUpUntil} but review is "${r.status}" — re-check and set final`);
    const misses = scoredBouts(l).filter((s) => s.winner === false);
    const unexplained = misses.filter((s) => !r.bouts.some((x) => sameBout(x, s.bout) && x.cause));
    if (unexplained.length) warn("reviews", `${L}: ${unexplained.length} missed pick(s) without a cause: ${unexplained.map((s) => `${s.bout.a} vs ${s.bout.b}`).join("; ")}`);
  }
  // Scouting completeness: every fighter on a finished bout gets a note dated the event day, or an explicit no-note decision.
  if (l.results && !l.results.live && l.date >= POSTFIGHT_SINCE && l.date <= yesterday && seedEvent) {
    const noNote = new Set((l.review?.scouting?.noNote ?? []).map((x) => x.fighter));
    const missing: string[] = [];
    for (const b of l.results.bouts) {
      const fight = seedEvent.fights.find((f) => SEED_FIGHTERS[f.a] && SEED_FIGHTERS[f.b] && sameBout({ a: SEED_FIGHTERS[f.a].name, b: SEED_FIGHTERS[f.b].name }, b));
      for (const id of fight ? [fight.a, fight.b] : []) {
        const name = SEED_FIGHTERS[id].name;
        if (scoutNotes.some((n) => n.fighter === id && n.date === l.date)) continue;
        if (noNote.has(id) || noNote.has(name)) continue;
        missing.push(name);
      }
    }
    if (missing.length) warn("scouting", `${L}: ${missing.length} fighter(s) with no scouting note or no-note decision: ${missing.join(", ")}`);
  }
}
// ---------- round-by-round recaps (LedgerBout.rounds / recap; docs/NIGHTLY.md step 2.4a) ----------
// Shape: checked on every ledger. Completeness: finished UFC and DWCS cards from ROUNDS_SINCE on.
{
  const EDGES = ["a", "b", "even"];
  const STATUSES = ["complete", "partial", "pending", "unavailable"];
  const HTTP = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
  for (const l of ledgers) {
    for (const b of l.results?.bouts ?? []) {
      const B = `ledger ${l.eventId}: ${b.a} vs ${b.b}`;
      const rs = b.rounds as unknown;
      const rc = b.recap as unknown;
      if (rs !== undefined) {
        if (!Array.isArray(rs) || !rs.length) err("recaps", `${B}: rounds must be a non-empty array (leave it out until there is a write-up)`);
        else {
          const rows = rs as { n?: unknown; summary?: unknown; edge?: unknown; score?: unknown; keyMoments?: unknown }[];
          rows.forEach((r, i) => {
            const R = `${B} rounds[${i}]`;
            if (r?.n !== i + 1) err("recaps", `${R}: n is ${JSON.stringify(r?.n)} — rounds must be numbered 1, 2, 3… in order with no gaps`);
            if (typeof r?.summary !== "string" || !r.summary.trim()) err("recaps", `${R}: summary is empty`);
            else if (r.summary.length > 700) warn("recaps", `${R}: summary is ${r.summary.length} characters (keep it to 2–3 sentences)`);
            if (r?.edge !== undefined && !EDGES.includes(r.edge as string)) err("recaps", `${R}: edge ${JSON.stringify(r.edge)} (must be "a", "b" or "even")`);
            if (r?.edge === undefined) warn("recaps", `${R}: no edge (who won the round per the write-ups: "a", "b" or "even")`);
            if (r?.score !== undefined && (typeof r.score !== "string" || !/^\d{1,2}-\d{1,2}(\s+(a|b))?$/.test(r.score.trim()))) warn("recaps", `${R}: score ${JSON.stringify(r.score)} (expected e.g. "10-9 a", "10-8 b", "10-10")`);
            if (r?.keyMoments !== undefined && (!Array.isArray(r.keyMoments) || r.keyMoments.some((k) => typeof k !== "string" || !k.trim()))) err("recaps", `${R}: keyMoments must be a list of short strings`);
          });
          const k = rows.length;
          if (k > b.scheduledRounds) err("recaps", `${B}: ${k} rounds recorded but only ${b.scheduledRounds} scheduled`);
          else if (k > b.round) err("recaps", `${B}: ${k} rounds recorded but the fight ended in R${b.round}`);
          else if (endedByFinish(b) && k !== b.round) err("recaps", `${B}: finished in R${b.round} but the last recorded round is R${k} (the finish round must be the last entry)`);
          else if (k < b.round && (rc as { status?: string } | undefined)?.status !== "partial") warn("recaps", `${B}: ${k} of ${b.round} rounds recorded — add the rest or set recap.status "partial"`);
          if (rc === undefined) warn("recaps", `${B}: rounds but no recap (status, checkedAt and source links)`);
        }
      }
      if (rc !== undefined) {
        const r = rc as { status?: unknown; checkedAt?: unknown; sources?: unknown; note?: unknown };
        if (!STATUSES.includes(r?.status as string)) err("recaps", `${B}: recap.status ${JSON.stringify(r?.status)} (must be complete, partial, pending or unavailable)`);
        if (typeof r?.checkedAt !== "string" || !ISO.test(r.checkedAt.slice(0, 10))) warn("recaps", `${B}: recap.checkedAt missing or not a date`);
        if (!Array.isArray(r?.sources)) err("recaps", `${B}: recap.sources must be a list of { label, url }`);
        else
          for (const s of r.sources as { label?: unknown; url?: unknown }[]) {
            if (typeof s?.url !== "string" || !HTTP.test(s.url)) err("recaps", `${B}: recap source ${JSON.stringify(s?.url)} is not an http(s) URL`);
            if (typeof s?.label !== "string" || !s.label.trim()) warn("recaps", `${B}: recap source without a label`);
          }
        const hasRounds = Array.isArray(rs) && rs.length > 0;
        if ((r?.status === "complete" || r?.status === "partial") && !hasRounds) err("recaps", `${B}: recap.status "${r.status}" but no rounds recorded`);
        if ((r?.status === "complete" || r?.status === "partial") && Array.isArray(r?.sources) && !r.sources.length) err("recaps", `${B}: recap.status "${r.status}" with no source links`);
        if (r?.status === "pending" && hasRounds) warn("recaps", `${B}: recap is "pending" but rounds are recorded — set "partial" or "complete"`);
        if (r?.status === "unavailable" && (typeof r.note !== "string" || !r.note.trim())) warn("recaps", `${B}: recap "unavailable" needs a note saying what was searched`);
      }
    }
  }

  // Completeness. "Main card" = section matching /main/i; a bout with no section counts as main card (DWCS cards are one card).
  const isMain = (b: { section?: string }) => !b.section || /main/i.test(b.section);
  const covered = (b: { rounds?: unknown[]; recap?: { status?: string; note?: string } }) => !!(b.rounds && b.rounds.length) || b.recap?.status === "unavailable";
  const label = (b: { a: string; b: string }) => `${b.a} vs ${b.b}`;
  for (const l of ledgers) {
    if (!["UFC", "DWCS"].includes(l.promotion) || !l.results || l.results.live || l.date < ROUNDS_SINCE || l.date > yesterday) continue;
    const L = `ledger ${l.eventId}`;
    const bouts = l.results.bouts;
    const missMain = bouts.filter((b) => isMain(b) && !covered(b));
    const missPre = bouts.filter((b) => !isMain(b) && !covered(b));
    const until = followUpFor(l);
    const windowOver = until < today;
    // A review can only be final once every main-card bout has rounds or an explained "unavailable".
    const blocking = l.review?.status === "final" ? bouts.filter((b) => isMain(b) && !(b.rounds && b.rounds.length) && !(b.recap?.status === "unavailable" && b.recap.note?.trim())) : [];
    const gated = l.date >= ROUNDS_FINAL_GATE_SINCE;
    if (blocking.length && gated)
      err("recaps-final", `${L}: review is "final" but ${blocking.length} main-card bout(s) have no rounds and no recap.status "unavailable" with a note: ${blocking.map(label).join("; ")} — fill the round-by-round, or set the review back to "follow-up"`);
    if (missMain.length || missPre.length) {
      const parts = [missMain.length ? `main card ${missMain.length}: ${missMain.map(label).join("; ")}` : "", missPre.length ? `prelims ${missPre.length}: ${missPre.map(label).join("; ")}` : ""].filter(Boolean).join(" · ");
      const finalNote = blocking.length && !gated ? ` The review was set "final" before this rule — backfill, then keep it final.` : "";
      if (windowOver && missMain.length)
        warn("recaps-overdue", `${L}: OVERDUE — review window ended ${until} and ${missMain.length} main-card bout(s) still have no round-by-round (${parts}). Search Sherdog / UFC.com / MMA Junkie / MMA Fighting / Cageside Press / MMADecisions again; fill rounds + recap, or set recap.status "unavailable" with a note of what was searched.${finalNote}`);
      else warn("recaps", `${L}: ${missMain.length + missPre.length}/${bouts.length} finished bouts have no round-by-round yet (${parts}) — keep checking until ${until} (docs/NIGHTLY.md step 2.4a)`);
    } else if (blocking.length && !gated) warn("recaps-overdue", `${L}: review is "final" but main-card bout(s) have an "unavailable" recap with no note: ${blocking.map(label).join("; ")}`);
    const stillPartial = bouts.filter((b) => (b.recap?.status === "partial" || b.recap?.status === "pending") && !missMain.includes(b));
    if (windowOver && stillPartial.length) warn("recaps-overdue", `${L}: review window ended ${until} but ${stillPartial.length} recap(s) are still pending/partial: ${stillPartial.map(label).join("; ")} — complete them or mark "unavailable" with a note`);
  }
}

// Every upcoming seed card with bouts should have a ledger file (freeze.ts writes it).
for (const e of SEED_EVENTS) if (e.date >= today && e.fights.length && !ledgerById.has(e.id)) (daysBetween(today, e.date) <= 1 ? err : warn)("freeze", `${e.id}: no ledger file yet — run npx tsx scripts/freeze.ts`);

// ---------- scouting notes shape ----------
{
  const seenNotes = new Set<string>();
  for (const [i, n] of (scoutNotes as { fighter: string; date: string; note?: string; tags?: string[] }[]).entries()) {
    if (!SEED_FIGHTERS[n.fighter]) warn("scouting", `note #${i + 1}: fighter id "${n.fighter}" is not in the seed`);
    if (!ISO.test(n.date)) warn("scouting", `note #${i + 1}: date "${n.date}" is not YYYY-MM-DD`);
    if (n.date > today) warn("scouting", `note #${i + 1}: dated in the future (${n.date})`);
    // A re-run of the nightly must not append the same lesson twice (it would double-count in the engine).
    const k = `${n.fighter}|${n.date}|${(n.note ?? "").trim().toLowerCase()}`;
    if (seenNotes.has(k)) warn("scouting", `note #${i + 1}: duplicate of an earlier note for ${n.fighter} on ${n.date}`);
    seenNotes.add(k);
  }
}

// ---------- rankings / freshness ----------
{
  const rk = isoOf(RANKINGS_AS_OF), nx = isoOf(NEXT_IN_LINE_AS_OF);
  if (!rk) err("freshness", `RANKINGS_AS_OF "${RANKINGS_AS_OF}" is not a date`);
  else if (daysBetween(rk, today) > 8) warn("freshness", `rankings are ${daysBetween(rk, today)} days old (RANKINGS_AS_OF ${RANKINGS_AS_OF}; UFC updates weekly)`);
  if (!nx) err("freshness", `NEXT_IN_LINE_AS_OF "${NEXT_IN_LINE_AS_OF}" is not a date`);
  else if (daysBetween(nx, today) > 2) warn("freshness", `next-in-line is ${daysBetween(nx, today)} days old (NEXT_IN_LINE_AS_OF ${NEXT_IN_LINE_AS_OF}; re-research nightly)`);
  if (!ISO.test(CHECKED_AT)) err("freshness", `CHECKED_AT "${CHECKED_AT}" is not YYYY-MM-DD`);
  else if (daysBetween(CHECKED_AT, today) > 2) warn("freshness", `CHECKED_AT is ${CHECKED_AT} (${daysBetween(CHECKED_AT, today)} days old)`);
  for (const d of DIVISIONS) {
    if (!d.nextInLine) { warn("rankings", `${d.name}: no nextInLine`); continue; }
    const n = d.nextInLine;
    if (!n.name) warn("rankings", `${d.name}: nextInLine has no name`);
    if (n.status !== "ranking" && !n.source) warn("rankings", `${d.name}: nextInLine "${n.status}" needs a source`);
    const top = d.top10.map((c) => c.name);
    if (n.status === "ranking" && !top.includes(n.name)) warn("rankings", `${d.name}: nextInLine by ranking but ${n.name} is not in the top 10`);
    if (d.top10.length !== 10) warn("rankings", `${d.name}: top10 has ${d.top10.length} names`);
    for (const p of d.prospects) if (top.includes(p.name) || (p.rank !== undefined && p.rank <= 10)) warn("rankings", `${d.name}: prospect ${p.name} is inside the top 10 (drop from threat radar)`);
    if (!assetExists(d.champion.img)) err("portraits", `${d.name}: champion image missing (${d.champion.img})`);
  }
}

// ---------- roster dataset ----------
if (existsSync("public/roster/roster.json")) {
  try {
    const asOf = (JSON.parse(readFileSync("public/roster/roster.json", "utf8")) as { asOf: string }).asOf;
    const lastUfc = ledgers.filter((l) => l.promotion === "UFC" && l.date < today && l.results).map((l) => l.date).sort().pop();
    if (lastUfc && asOf < lastUfc) warn("freshness", `roster.json asOf ${asOf} is before the last UFC event (${lastUfc}); re-run scripts/build-roster.py (the UFCStats mirror can lag 1–3 days)`);
  } catch (e) { warn("roster", `public/roster/roster.json unreadable: ${(e as Error).message}`); }
} else if (published.has("roster/roster.json")) {
  // live run without the asset restore: nothing to check
} else warn("roster", "public/roster/roster.json not found (restore it from the artifact)");

// ---------- clips ----------
if (existsSync("data/clips.json")) {
  const clips = JSON.parse(readFileSync("data/clips.json", "utf8")) as { id: string; title?: string; fighters?: string[]; date?: string; verifiedAt?: string }[];
  const ids = new Set<string>();
  for (const c of clips) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(c.id)) err("clips", `clip id "${c.id}" is not an 11-character YouTube id`);
    if (ids.has(c.id)) err("clips", `clip ${c.id} listed twice`);
    ids.add(c.id);
    if (!c.title || !c.fighters?.length) warn("clips", `clip ${c.id}: missing title or fighters`);
    if (c.date && !ISO.test(c.date)) warn("clips", `clip ${c.id}: date "${c.date}" is not YYYY-MM-DD`);
    if (!c.verifiedAt) warn("clips", `clip ${c.id}: no verifiedAt`);
  }
}

// ---------- run logs ----------
if (existsSync("data/runs")) {
  const files = readdirSync("data/runs").filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync("data/runs/" + f, "utf8")) as { date: string; runs: { status: string; failed?: { step: string; error: string }[]; kind: string }[] };
      if (d.date + ".json" !== f || !Array.isArray(d.runs)) warn("runs", `data/runs/${f}: expected { date: "${f.slice(0, 10)}", runs: [...] }`);
    } catch (e) { warn("runs", `data/runs/${f}: not valid JSON (${(e as Error).message})`); }
  }
  const last = files.pop();
  if (last) {
    const d = JSON.parse(readFileSync("data/runs/" + last, "utf8")) as { date: string; runs: { status: string; kind: string; failed?: { step: string; error: string }[] }[] };
    for (const r of d.runs ?? []) for (const x of r.failed ?? []) warn("runs", `${d.date} ${r.kind} run: ${x.step} failed — ${x.error}`);
  }
}

// ---------- artifact budget ----------
{
  // Files the artifact version will hold: every published asset + films (never in the restored copy) + page assets.
  const pub = new Set(published);
  const walk = (dir: string): string[] => existsSync(dir) ? readdirSync(dir).flatMap((f) => { const p = `${dir}/${f}`; return statSync(p).isDirectory() ? walk(p) : [p.slice(7)]; }) : [];
  for (const f of walk("public")) pub.add(f);
  const films = [...pub].filter((f) => f.startsWith("films/")).length || 25;
  // + the page's JS files (the entry plus per-card seed chunks; counted from dist/ when built) + source/bundle.json
  const js = existsSync("dist/assets") ? readdirSync("dist/assets").filter((f) => f.endsWith(".js")).length : 1;
  const total = [...pub].filter((f) => !f.startsWith("films/")).length + films + js + 1;
  if (total > 430) warn("artifact", `about ${total} files in the artifact version (limit ~511): pack new portraits or prune unused ones`);
}

// ---------- report ----------
const errors = issues.filter((i) => i.sev === "error"), warnings = issues.filter((i) => i.sev === "warn");
const verbose = !!process.env.VALIDATE_VERBOSE;
const byCat = (xs: typeof issues) => xs.reduce((m, i) => m.set(i.cat, [...(m.get(i.cat) ?? []), i.msg]), new Map<string, string[]>());
console.log(`today ${today} (Toronto) · ${errors.length} errors · ${warnings.length} warnings`);
for (const [cat, msgs] of byCat(warnings)) {
  console.log(`  warn  [${cat}] ${msgs.length}`);
  for (const m of verbose ? msgs : msgs.slice(0, 12)) console.log("        " + m);
  if (!verbose && msgs.length > 12) console.log(`        … ${msgs.length - 12} more (VALIDATE_VERBOSE=1)`);
}
for (const [cat, msgs] of byCat(errors)) for (const m of msgs) console.log(`  ERROR [${cat}] ${m}`);
// One machine-readable line for the run log.
console.log("VALIDATE " + JSON.stringify({ today, errors: errors.length, warnings: warnings.length, categories: Object.fromEntries([...byCat(warnings)].map(([k, v]) => [k, v.length])) }));
if (errors.length) process.exit(1);
