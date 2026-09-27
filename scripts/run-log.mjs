#!/usr/bin/env node
// Small machine-readable run log: data/runs/YYYY-MM-DD.json = { date, runs: RunLog[] } (type in lib/types.ts).
// It rides along in source/bundle.json, so the next run (and anyone reading the bundle) can see what the last
// published run checked, changed and failed. If a log entry is in the restored bundle, that publish succeeded.
//
//   node scripts/run-log.mjs start <nightly|live|weigh-in|sunday|friday|manual>
//   node scripts/run-log.mjs source <firecrawl|webfetch|mixed>
//   node scripts/run-log.mjs checked "<what>" ["<what>" ...]
//   node scripts/run-log.mjs changed "<what>" ["<what>" ...]
//   node scripts/run-log.mjs failed "<step>" "<error>"
//   node scripts/run-log.mjs note "<text>"
//   node scripts/run-log.mjs check                                 # runs npm run check, records error/warning counts, keeps its exit code
//   node scripts/run-log.mjs published <file-count>                # call BEFORE bundling, right before the publish
//   node scripts/run-log.mjs finish <ok|partial|failed|no-change>
//   node scripts/run-log.mjs show
// Every command is idempotent (repeated items are de-duplicated) and never throws on a bad log: it starts a new one.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const DIR = "data/runs", KEEP_DAYS = 45;
const tz = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const file = (date) => `${DIR}/${date}.json`;
const read = (date) => {
  try { const d = JSON.parse(fs.readFileSync(file(date), "utf8")); if (Array.isArray(d.runs)) return d; } catch {}
  return { date, runs: [] };
};
const write = (d) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file(d.date), JSON.stringify(d, null, 1) + "\n"); };
const today = tz(), yesterday = tz(new Date(Date.now() - 86400000));

/** The open run (status "running") from today or yesterday (live runs cross midnight); else start a nightly one. */
function current(kind) {
  for (const date of [today, yesterday]) {
    const d = read(date);
    const r = [...d.runs].reverse().find((x) => x.status === "running" && (!kind || x.kind === kind));
    if (r) return { d, r };
  }
  const d = read(today);
  const r = { kind: kind || "nightly", startedAt: new Date().toISOString(), status: "running", checked: [], changed: [], failed: [], notes: [] };
  d.runs.push(r);
  return { d, r };
}
const add = (arr, xs) => { for (const x of xs) if (x && !arr.includes(x)) arr.push(x); };

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "start": {
    const kind = args[0] || "nightly";
    const d = read(today);
    // A run that never finished (crash, timeout) is closed as failed so it shows up.
    for (const r of d.runs) if (r.status === "running") { r.status = "failed"; r.finishedAt = new Date().toISOString(); r.failed.push({ step: "run", error: "did not finish (superseded by a new run)" }); }
    d.runs.push({ kind, startedAt: new Date().toISOString(), status: "running", checked: [], changed: [], failed: [], notes: [] });
    write(d);
    // Retention
    if (fs.existsSync(DIR)) for (const f of fs.readdirSync(DIR)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
      if (m && Date.parse(today) - Date.parse(m[1]) > KEEP_DAYS * 86400000) fs.unlinkSync(`${DIR}/${f}`);
    }
    console.log(`run-log: started ${kind} run (${file(today)})`);
    break;
  }
  case "source": { const { d, r } = current(); r.sourcePath = args[0]; write(d); break; }
  case "checked": { const { d, r } = current(); add(r.checked, args); write(d); break; }
  case "changed": { const { d, r } = current(); add(r.changed, args); write(d); break; }
  case "note": { const { d, r } = current(); r.notes = r.notes ?? []; add(r.notes, args); write(d); break; }
  case "failed": {
    const { d, r } = current();
    const [step, ...rest] = args, error = rest.join(" ") || "failed";
    if (!r.failed.some((x) => x.step === step && x.error === error)) r.failed.push({ step: step || "unknown", error });
    write(d);
    break;
  }
  case "check": {
    // Runs `npm run check` itself (so its exit code is not lost in a pipe), echoes the output,
    // records the error/warning counts, and exits with check's own exit code.
    const res = spawnSync("npm", ["run", "-s", "check"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const out = (res.stdout || "") + (res.stderr || "");
    process.stdout.write(out);
    const line = out.split("\n").reverse().find((l) => l.startsWith("VALIDATE "));
    const { d, r } = current();
    if (line) { const v = JSON.parse(line.slice(9)); r.errors = v.errors; r.warnings = v.warnings; }
    if (res.status !== 0) {
      const why = line ? `${r.errors} validation error(s)` : "ledger index or typecheck failed before validation";
      if (!r.failed.some((x) => x.step === "check" && x.error === why)) r.failed.push({ step: "check", error: why });
    }
    write(d);
    process.exit(res.status ?? 1);
  }
  case "published": { const { d, r } = current(); r.published = { at: new Date().toISOString(), files: Number(args[0]) || 0 }; write(d); break; }
  case "finish": {
    const { d, r } = current();
    r.status = ["ok", "partial", "failed", "no-change"].includes(args[0]) ? args[0] : (r.failed.length ? "partial" : "ok");
    r.finishedAt = new Date().toISOString();
    if (r.published === undefined) r.published = null;
    write(d);
    console.log(`run-log: ${r.kind} run ${r.status} · checked ${r.checked.length} · changed ${r.changed.length} · failed ${r.failed.length}`);
    break;
  }
  case "show": { console.log(JSON.stringify(read(args[0] || today), null, 1)); break; }
  default:
    console.error("usage: node scripts/run-log.mjs start|source|checked|changed|failed|note|check|published|finish|show …");
    process.exit(2);
}
