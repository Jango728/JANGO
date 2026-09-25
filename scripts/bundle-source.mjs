// Pack every tracked text source file into dist/source/bundle.json so the site
// artifact itself carries a restorable copy of the project (images are already
// published at the same relative paths as public/).
import { execSync } from "node:child_process";
import fs from "node:fs";
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|css|md|html|py|txt|svg|yml|yaml|sh)$|(^|\/)\.(npmrc|gitignore)$/;
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const bundle = { made: new Date().toISOString(), text: {}, published: [] };
for (const f of files) {
  if (f.startsWith("archive/")) continue; // retired 3D assets stay out
  if (f.startsWith("public/")) {
    if (f.startsWith("public/films/")) continue; // clips stay in the artifact; nightly runs never touch them
    if (!TEXT.test(f) || f.endsWith(".svg")) { bundle.published.push(f.slice(7)); continue; }
  }
  if (TEXT.test(f)) bundle.text[f] = fs.readFileSync(f, "utf8");
}
fs.mkdirSync("dist/source", { recursive: true });
fs.writeFileSync("dist/source/bundle.json", JSON.stringify(bundle));
console.log("bundled", Object.keys(bundle.text).length, "text files,", bundle.published.length, "published assets,", (fs.statSync("dist/source/bundle.json").size / 1e6).toFixed(2), "MB");
