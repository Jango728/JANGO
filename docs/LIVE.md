# Jango Playz: live fight-night updates

Quick result-only updates while a **UFC** or **Dana White's Contender Series** card is running. Each run is a fresh scheduled session, about every 25 minutes. It marks who won, the method, round and time, and whether the frozen pick and the rounds O/U hit. It does **not** write notes, reviews or analysis; the 2:30 a.m. nightly run does that once recaps exist.

Site: https://claude.ai/artifact/CB3f7jVHeYrvitrxxTkT1A

## Hard rules
- Never use or touch the `hpervaiz9-commits` GitHub account, any GitHub connector or any token. No GitHub push in live runs.
- Never send email, Teams, Slack or any message.
- Never edit a frozen `forecast` block. Never invent a result: log a bout only when a source explicitly shows the winner and method.
- Publish only if `npm run check` and `npm run build` both pass.

## 1. Restore (fast: no images)
1. Artifact `read`, `url` = the site, `path` = `source/bundle.json`.
2. Unpack into `~/jango` (same node one-liner as NIGHTLY.md step 1, which also writes `.published.json`). **Skip the image restore** — live runs only republish code and data; `scripts/bundle-source.mjs` keeps every asset listed in `.published.json`, and `npm run check` accepts portraits that are listed there.
3. `npm ci --prefer-offline` (fall back to `npm install` only if that fails), then `node scripts/nightly-publish-plan.mjs --baseline` and `node scripts/run-log.mjs start live`.

## 2. Find the live card
"Today" = Toronto date. The live card is the UFC or DWCS event in `lib/seed.json` whose `date` is today, or yesterday if it is before 4 a.m. Toronto. If there is none, or its ledger `results.live` is already `false`, stop (do not schedule another run).

## 2b. Book the next run FIRST
Right after confirming the card is live, and before fetching anything: if it is before 3:00 a.m. Toronto, reschedule the next run now (step 5 mechanics: `update_trigger`, `run_once_at` = now + 25 minutes, `enabled` = true). This keeps a steady 25-minute rhythm no matter how long this run takes. If this run then marks the card final, set that task back to `enabled` = false at the end.

Keep each run short (target under 10 minutes): one pass over the sources, no waiting or retry loops. Whatever isn't posted yet gets picked up next run.

## 3. Get results
Sources, in order (use WebFetch; Firecrawl if it has credits):
- UFC.com event page (the event's `source.url` for UFC; `https://www.ufc.com/event/...`) and the UFC.com "Prelim Results" / "Main Card Results" news posts (find with WebSearch).
- ESPN fightcenter page for the event, MMA News / MMA Junkie / Yahoo live-results posts, Tapology event page.
Record only completed bouts with an explicit winner + method (+ round and time; a decision is final round, time 5:00). Pages can lag; if unsure, leave the bout for the next run.

Write them to a JSON file and merge:
```bash
python3 scripts/live-update.py <event-id> /path/results.json          # keeps live=true
python3 scripts/live-update.py <event-id> /path/results.json --final  # when every bout on the card has a result (or the rest were officially cancelled)
```
The file format is in the script header. Names must match the card's fighter names. If a bout happened with a late replacement who is not on the card (the script stops with "bout not on card"), leave it out and name it in the report; the nightly run fixes the card. If nothing new came in, skip to step 5 (no publish).

## 4. Build and publish
```bash
node scripts/run-log.mjs check && npm run build
node scripts/bundle-source.mjs && python3 scripts/prepare-publish.py
node scripts/nightly-publish-plan.mjs --live /tmp/jango-live-files.txt; echo "plan exit $?"   # 3 = nothing new: don't publish
mkdir -p /home/claude/jpub && rm -rf /home/claude/jpub/* && cp -r dist /home/claude/jpub/dist && cp publish/index.html /home/claude/jpub/index.html
```
(`/tmp/jango-live-files.txt` = the text of an Artifact `list` with `scope: "files"` on the site; skip `--live` if that call fails.)
Artifact `publish`: `url` = site, `file_path` = `/home/claude/jpub/index.html`, `root` = `/home/claude/jpub/dist`, `files` = the object in `publish/files-batch-1.json` (new `assets/index-*.js`, `source/bundle.json`, and `null` only for the superseded `assets/index-*.js`). Never pass `null` for anything else (especially `films/` and `roster/`). Then `node scripts/run-log.mjs finish ok`.
The first publish in a fresh session is usually refused ("hadn't viewed the live version") and the live page is saved locally. Read its lines 1–8 and 10–15 (skip the huge CSS line 9): if the only differences are the generated CSS and the `assets/index-*.js` name, publish the same file again.

## 5. Next run or stop (already booked in step 2b)
- If the card is not final **and** it is before 3:00 a.m. Toronto the night of the card: reschedule the existing scheduled task "Jango Playz live update" (id `trig_01LYQkLyy5QBqVWyh3AfBj7v`; if missing, look it up by name with `list_triggers`) with `update_trigger`: `run_once_at` = now + 25 minutes (RFC3339 UTC), `enabled` = true. Reuse this one task every time (set up Sep 26) so no duplicate tasks pile up. If it no longer exists, stop and say so in the report.
- Otherwise stop. After 3:00 a.m. Toronto, leave any missing results to the nightly run.

End with a two-line in-session report: results added (and pick/O-U hits), and whether another run was scheduled.

## Live prompt (use verbatim for every live trigger)
> Jango Playz live fight-night update. Run silently. Read the artifact https://claude.ai/artifact/CB3f7jVHeYrvitrxxTkT1A file source/bundle.json with the Artifact tool, unpack its "text" map into ~/jango, and follow ~/jango/docs/LIVE.md exactly: results only (winner, method, round, time, pick and O/U hit), no reviews, no messages to anyone, no GitHub. Schedule the next run in 25 minutes only if the card is still going, as LIVE.md says.
