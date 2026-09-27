// Pack every text source file (tracked AND untracked, minus .gitignore'd) into dist/source/bundle.json so the
// site artifact itself carries a restorable copy of the project. Binary assets under public/ are listed in
// `published` instead: they're already published at the same relative paths and get restored from the artifact.
// Works without git too (falls back to walking the tree with the same ignore rules), so a run that skipped
// `git init` can still bundle.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEXT = /\.(ts|tsx|js|mjs|cjs|json|css|md|html|py|txt|svg|yml|yaml|sh)$|(^|\/)\.(npmrc|gitignore)$/;
// Never bundled: run-time state and build output (also in .gitignore, repeated here for the no-git fallback).
const SKIP = /^(node_modules|dist|publish|archive|\.git|\.claude|coverage|outputs|work)\/|(^|\/)(node_modules|__pycache__)\/|^render\/(node_modules|public)\/|^\.published\.json$|^\.restored-bundle\.json$|^\.restore-manifest\.json$|^tsconfig\.tsbuildinfo$|(^|\/)\.env|(^|\/)\.DS_Store$/;
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
const MAX_BYTES = 14e6; // artifact text-file limit is 16 MB

function listFiles() {
  try {
    return execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  } catch {
    console.warn("bundle-source: git unavailable, walking the tree instead");
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = path.posix.join(dir === "." ? "" : dir, e.name);
        if (SKIP.test(rel + (e.isDirectory() ? "/" : "")) || gitIgnored(rel) || /^dist/.test(rel)) continue;
        if (e.isDirectory()) walk(rel);
        else if (e.isFile()) out.push(rel);
      }
    };
    walk(".");
    return out;
  }
}

const files = listFiles().filter((f) => !SKIP.test(f) && fs.existsSync(f)); // deleted-but-tracked files drop out
const bundle = { made: new Date().toISOString(), text: {}, published: [] };
for (const f of files) {
  if (f.startsWith("public/")) {
    if (f.startsWith("public/films/")) continue; // clips stay in the artifact; nightly runs never touch them
    if (f.startsWith("public/roster/")) {
      bundle.published.push(f.slice(7)); // big data files: restored from the artifact, rebuilt by scripts/build-roster.py
      // names.json (~90 KB) is imported by lib/roster.ts at build time, so it must also be in the text map:
      // live runs skip the asset restore and would otherwise fail the typecheck and build.
      if (f === "public/roster/names.json") bundle.text[f] = fs.readFileSync(f, "utf8");
      continue;
    }
    if (!TEXT.test(f) || f.endsWith(".svg")) { bundle.published.push(f.slice(7)); continue; }
  }
  if (TEXT.test(f)) bundle.text[f] = fs.readFileSync(f, "utf8");
}
// Live-update runs skip the image restore: keep every asset already published
// (from .published.json) so the next restore still lists them.
if (fs.existsSync(".published.json")) {
  for (const f of JSON.parse(fs.readFileSync(".published.json", "utf8"))) {
    if (!f.startsWith("films/") && !bundle.published.includes(f)) bundle.published.push(f);
  }
}
bundle.published.sort();
// Sanity: the restore needs these to build and check.
for (const need of ["package.json", "package-lock.json", "lib/seed.json", "docs/NIGHTLY.md", "checks/validate-data.ts", "scripts/bundle-source.mjs", "public/roster/names.json"]) {
  if (!(need in bundle.text)) { console.error(`bundle-source: ${need} missing from the bundle — refusing to write an unrestorable bundle`); process.exit(1); }
}
const json = JSON.stringify(bundle);
if (json.length > MAX_BYTES) { console.error(`bundle-source: bundle is ${(json.length / 1e6).toFixed(1)} MB (limit ${MAX_BYTES / 1e6} MB) — move large data out of the text bundle`); process.exit(1); }
fs.mkdirSync("dist/source", { recursive: true });
fs.writeFileSync("dist/source/bundle.json", json);
console.log("bundled", Object.keys(bundle.text).length, "text files,", bundle.published.length, "published assets,", (json.length / 1e6).toFixed(2), "MB");
