#!/usr/bin/env bash
# Simulate NIGHTLY.md step 1 end to end, without touching this checkout's dist/:
#   bundle (from a temp copy) -> unpack `text` into a fresh folder -> restore `published` assets
#   (copied from ./public as a stand-in for the artifact download) -> npm ci -> npm run check -> vite build.
#
#   bash scripts/verify-restore.sh                 # bundle the current tree
#   bash scripts/verify-restore.sh <bundle.json>   # test a bundle downloaded from the artifact
#   options (env): LINK_MODULES=1  symlink ./node_modules instead of npm ci (fast, offline)
#                  NO_ASSETS=1     skip the asset restore (what a live run does)
#                  KEEP=1          keep the temp folder
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/jango-restore-XXXXXX")"
cleanup() { [ "${KEEP:-}" = 1 ] && echo "kept $TMP" || rm -rf "$TMP"; }
trap cleanup EXIT
BUNDLE="${1:-}"
if [ -z "$BUNDLE" ]; then
  mkdir -p "$TMP/copy"
  (cd "$SRC" && tar --exclude=./node_modules --exclude=./dist --exclude=./render/node_modules --exclude=./archive --exclude=./public/films -cf - .) | (cd "$TMP/copy" && tar xf -)
  (cd "$TMP/copy" && node scripts/bundle-source.mjs)
  BUNDLE="$TMP/copy/dist/source/bundle.json"
fi
mkdir -p "$TMP/restore" && cd "$TMP/restore"
node -e 'const b=require(process.argv[1]);const fs=require("fs"),p=require("path");for(const[f,t]of Object.entries(b.text)){fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,t)}fs.writeFileSync(".published.json",JSON.stringify(b.published))' "$BUNDLE"
echo "unpacked $(node -e 'const b=require(process.argv[1]);console.log(Object.keys(b.text).length+" text files, "+b.published.length+" published assets")' "$BUNDLE")"
if [ "${NO_ASSETS:-}" != 1 ]; then
  node -e '
    const pub=require("./.published.json"),fs=require("fs"),p=require("path");const miss=[];
    for(const f of pub){const s=process.argv[1]+"/public/"+f;if(!fs.existsSync(s)){miss.push(f);continue}fs.mkdirSync(p.dirname("public/"+f),{recursive:true});fs.copyFileSync(s,"public/"+f)}
    console.log("restored",pub.length-miss.length,"assets"+(miss.length?"; NOT in ./public (would come from the artifact): "+miss.join(", "):""))' "$SRC"
fi
git init -q && git add -A && git -c user.name=restore -c user.email=restore@invalid commit -qm restore
if [ "${LINK_MODULES:-}" = 1 ]; then ln -s "$SRC/node_modules" node_modules; else npm ci --prefer-offline --no-audit --no-fund >/dev/null; fi
node scripts/nightly-publish-plan.mjs --baseline
npm run -s check | grep -v '^        '
npx vite build --outDir "$TMP/restore/dist" --logLevel warn
node scripts/bundle-source.mjs
python3 scripts/prepare-publish.py >/dev/null
set +e; node scripts/nightly-publish-plan.mjs; code=$?; set -e
[ $code = 3 ] && echo "plan: nothing changed (expected for an untouched restore)"
[ $code = 1 ] && { echo "RESTORE CHECK FAILED at the publish plan"; exit 1; }
echo "RESTORE OK"
