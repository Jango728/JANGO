#!/usr/bin/env node
// Nightly/live publish planner. Two modes:
//
//   node scripts/nightly-publish-plan.mjs --baseline
//       Run right after the restore (NIGHTLY.md step 1). Hashes every file into .restore-manifest.json.
//
//   node scripts/nightly-publish-plan.mjs [--live <live page .html or files listing>]
//       Run after `npm run check`, `npm run build` and `node scripts/bundle-source.mjs`.
//       Decides whether anything substantive changed and writes the Artifact `files` map(s):
//         publish/nightly-plan.json      summary (publish true/false, changed files, batches)
//         publish/files-batch-<n>.json   one `files` map per publish call (usually just files-batch-1.json)
//       Exit code 0 = publish, 3 = nothing changed (do NOT publish), 1 = problem (do NOT publish).
//
// Rules it enforces:
//   - nothing under films/ or roster/ is ever nulled; the only removals are superseded assets/*.js files
//     named in --live (so old 3 MB bundles don't pile up toward the 256 MB version cap);
//   - "nothing changed" ignores CHECKED_AT, the run log (data/runs/) and the generated ledger index;
//   - batches stay under 250 files and 60 MB per publish call (limits: 255 files / 64 MB).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MANIFEST = ".restore-manifest.json";
const SKIP = /^(node_modules|dist|publish|archive|\.git|\.claude|coverage|outputs|work)\/|(^|\/)(node_modules|__pycache__)\/|^render\/(node_modules|public)\/|^\.published\.json$|^\.restore-manifest\.json$|^\.restored-bundle\.json$|^tsconfig\.tsbuildinfo$|(^|\/)\.env|(^|\/)\.DS_Store$|^public\/films\//;
const IGNORE = [/^data\/runs\//, /^lib\/ledger-index\.ts$/];
const MAX_FILES = 250, MAX_BYTES = 60e6;

// Minimal .gitignore reader (used when git isn't available): plain names, leading "/", trailing "/", "*" globs.
function gitignoreTest() {
  let pats = [];
  try { pats = fs.readFileSync(".gitignore", "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("!")); } catch {}
  const res = pats.map((p) => {
    const anchored = p.startsWith("/") || p.replace(/\/$/, "").includes("/");
    const body = p.replace(/^\//, "").replace(/\/$/, "").split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
    return new RegExp((anchored ? "^" : "(^|/)") + body + "(/|$)");
  });
  return (rel) => res.some((r) => r.test(rel));
}
const gitIgnored = gitignoreTest();
const sha = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
function walk(dir = ".", out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = dir === "." ? e.name : `${dir}/${e.name}`;
    if (SKIP.test(rel + (e.isDirectory() ? "/" : "")) || gitIgnored(rel) || /^dist/.test(rel)) continue;
    if (e.isDirectory()) walk(rel, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}
// lib/data.ts with the CHECKED_AT line blanked, so a date bump alone doesn't count as a change.
const hashFile = (f) => {
  const buf = fs.readFileSync(f);
  return f === "lib/data.ts" ? sha(buf.toString("utf8").replace(/CHECKED_AT\s*=\s*"[^"]*"/, 'CHECKED_AT=""')) : sha(buf);
};

if (process.argv.includes("--baseline")) {
  const files = Object.fromEntries(walk().map((f) => [f, hashFile(f)]));
  fs.writeFileSync(MANIFEST, JSON.stringify({ made: new Date().toISOString(), files }));
  console.log(`baseline: ${Object.keys(files).length} files hashed → ${MANIFEST}`);
  process.exit(0);
}

const fail = (msg) => { console.error("PLAN ERROR: " + msg + " — do not publish."); process.exit(1); };
if (!fs.existsSync(MANIFEST)) fail(`${MANIFEST} not found (run with --baseline right after the restore)`);
for (const need of ["dist/index.html", "dist/source/bundle.json", "publish/index.html"]) if (!fs.existsSync(need)) fail(`${need} missing (run npm run build, bundle-source, prepare-publish)`);

const base = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).files;
const now = Object.fromEntries(walk().map((f) => [f, hashFile(f)]));
const changed = Object.keys(now).filter((f) => base[f] !== now[f]).sort();
const deleted = Object.keys(base).filter((f) => !(f in now)).sort();
const ignored = changed.filter((f) => IGNORE.some((r) => r.test(f)));
const substantive = [...changed.filter((f) => !ignored.includes(f)), ...deleted.filter((f) => !IGNORE.some((r) => r.test(f)))];

// The bundle must be fresh: every text file in it must match the disk.
const bundle = JSON.parse(fs.readFileSync("dist/source/bundle.json", "utf8"));
const staleAll = Object.entries(bundle.text).filter(([f, t]) => fs.existsSync(f) && fs.readFileSync(f, "utf8") !== t).map(([f]) => f);
const stale = staleAll.filter((f) => !IGNORE.some((r) => r.test(f)));
if (staleAll.length > stale.length) console.log(`note: bundle predates the latest ${staleAll.filter((f) => !stale.includes(f)).join(", ")} (run log / index); fine`);
if (stale.length) fail(`dist/source/bundle.json is older than ${stale.slice(0, 3).join(", ")} (re-run node scripts/bundle-source.mjs)`);
const missingText = changed.filter((f) => !f.startsWith("public/") && /\.(ts|tsx|json|md|py|mjs|css)$/.test(f) && !(f in bundle.text));
if (missingText.length) fail(`changed files missing from the bundle: ${missingText.slice(0, 5).join(", ")}`);

const summary = { made: new Date().toISOString(), publish: false, reason: "", changed: substantive, ignored, deleted, batches: [], removals: [] };
if (!substantive.length) {
  summary.reason = "nothing changed (only CHECKED_AT / run log / generated index)";
  fs.mkdirSync("publish", { recursive: true });
  fs.writeFileSync("publish/nightly-plan.json", JSON.stringify(summary, null, 1));
  console.log(`NOTHING CHANGED — do not publish. (${ignored.length} ignorable change(s): ${ignored.join(", ") || "none"})`);
  process.exit(3);
}

// Files to upload (paths relative to dist/, which is the publish root).
const html = fs.readFileSync("dist/index.html", "utf8");
const entry = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
if (!entry) fail("no assets/*.js entry in dist/index.html");
const jsFiles = fs.readdirSync("dist/assets").filter((f) => f.endsWith(".js")).map((f) => "assets/" + f);
const assets = changed.filter((f) => f.startsWith("public/") && !f.startsWith("public/films/")).map((f) => f.slice(7));
for (const a of assets) if (!fs.existsSync("dist/" + a)) fail(`changed asset ${a} is not in dist/ (rebuild)`);
const upload = [...new Set([...jsFiles, "source/bundle.json", ...assets])];
const size = (f) => fs.statSync("dist/" + f).size;

// Removals: only superseded JS bundles named in the live page / listing.
if (process.argv.includes("--live")) {
  const src = process.argv[process.argv.indexOf("--live") + 1];
  if (!src || !fs.existsSync(src)) fail(`--live file "${src}" not found`);
  const liveJs = [...new Set([...fs.readFileSync(src, "utf8").matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]))];
  summary.removals = liveJs.filter((f) => !jsFiles.includes(f));
} else {
  console.log("note: no --live given, so superseded assets/*.js files are left in the artifact (they count toward the version size cap)");
}

// Batches: JS + bundle + removals go in batch 1 with the page; the rest in size/count-limited batches.
const first = [...jsFiles, "source/bundle.json"];
const rest = upload.filter((f) => !first.includes(f)).sort((a, b) => size(b) - size(a));
const batches = [[...first]];
for (const f of rest) {
  let b = batches[batches.length - 1];
  const bytes = b.reduce((s, x) => s + size(x), 0);
  if (b.length + 1 > MAX_FILES || bytes + size(f) > MAX_BYTES) batches.push((b = []));
  b.push(f);
}
fs.mkdirSync("publish", { recursive: true });
for (const f of fs.readdirSync("publish").filter((f) => /^files-batch-\d+\.json$/.test(f))) fs.unlinkSync("publish/" + f);
batches.forEach((b, i) => {
  const map = Object.fromEntries(b.map((f) => [f, f]));
  if (i === 0) for (const r of summary.removals) map[r] = null;
  for (const [k, v] of Object.entries(map)) if (v === null && !/^assets\/[^/]+\.js$/.test(k)) fail(`refusing to null ${k}`);
  fs.writeFileSync(`publish/files-batch-${i + 1}.json`, JSON.stringify(map, null, 1));
  summary.batches.push({ file: `publish/files-batch-${i + 1}.json`, count: b.length, bytes: b.reduce((s, x) => s + size(x), 0) });
});
summary.publish = true;
summary.reason = `${substantive.length} substantive change(s)`;
fs.writeFileSync("publish/nightly-plan.json", JSON.stringify(summary, null, 1));
console.log(`PUBLISH: ${summary.reason}; entry ${entry}`);
for (const b of summary.batches) console.log(`  ${b.file}: ${b.count} file(s), ${(b.bytes / 1e6).toFixed(1)} MB`);
if (summary.removals.length) console.log(`  removes superseded: ${summary.removals.join(", ")}`);
if (deleted.length) console.log(`  deleted locally (left in the artifact, never nulled): ${deleted.slice(0, 8).join(", ")}${deleted.length > 8 ? " …" : ""}`);
console.log(`  changed: ${substantive.slice(0, 12).join(", ")}${substantive.length > 12 ? " …" : ""}`);
