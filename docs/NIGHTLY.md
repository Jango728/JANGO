# Jango Playz: nightly refresh runbook

This runs every night at 2:30 a.m. Toronto time, as a scheduled task. Each run starts with no memory of earlier runs.

The live site is the Claude artifact **https://claude.ai/artifact/CB3f7jVHeYrvitrxxTkT1A**. The artifact also stores the project's source, so a run can restore the source, update the data, and republish to the same link.

**What the run is for:** feed the prediction engine verified, fresh facts that actually predict fights, and close the learning loop (results → round-by-round recaps → reviews → scouting notes → proposed model changes), without ever breaking the live site. The shorter passes at the end (fight-week, post-fight) follow this same runbook with a narrower scope.

## Hard rules

- Never use or touch the `hpervaiz9-commits` GitHub account or any token. This project needs no GitHub.
- Never send email, Teams, Slack, or any other message to anyone. Report only inside the session.
- Odds are for display and for benchmarking us against the market. They are never an input to the model.
- Opening picks in `data/ledger/*.json` are permanent. Never hand-edit a `forecast` block. The only changes allowed are the ones `scripts/freeze.ts` makes: new bouts, append-only `revisions` before lock, and marking a bout `replaced`/`cancelled`. The check compares against the restore commit and errors on anything else.
- Never invent a fighter, result, record, or number. If you can't verify something, leave it out and note the gap in the run log.
- Publish only when `npm run check` and `npm run build` both pass **and** the publish plan says something changed. If anything fails, stop and report. The live site stays as it was.
- Never pass `null` for anything under `films/` or `roster/`. The only removals allowed are superseded `assets/index-*.js` files, and `scripts/nightly-publish-plan.mjs` computes those.
- Units: height and reach are stored in **centimetres** (5'11" → 180.3, 72" reach → 182.9). The site converts them for display.

## Collect / skip

Collect facts that predict fights or keep the record honest:
- lineups: replacements (with days of notice), withdrawals, cancellations
- official weigh-ins, missed weight, catchweights
- division changes
- venue altitude, cage size, time zone
- records and full fight histories, with opponents
- scheduled rounds, and 5-round / title-fight history
- results, official scorecards, result changes
- round-by-round recaps of every finished bout (`rounds` + `recap`, step 2.4a): how each round went, who won it, knockdowns, rocked-and-recovered, cardio fades, takedowns, cuts. They are the record we read the next time those fighters fight, and the source of the scouting notes
- display odds and closing odds, for the benchmark only

Skip noise:
- hype and trash talk
- "looked great in camp" stories
- pundit or community picks, betting tips
- rumoured injuries (act only on an official withdrawal)
- regional records taken at face value: record what happened and who it was against, and let the engine weigh the opposition

The field shapes are in `docs/SCHEMA.md`.

## 1. Restore the source

1. Read the artifact file `source/bundle.json` with the Artifact tool:
   - action `read`
   - `url` = the site link above
   - `path` = `source/bundle.json`

   It's saved locally. Note the path.
2. Unpack it into `~/jango`:
   ```bash
   mkdir -p ~/jango && cd ~/jango
   node -e 'const b=require(process.argv[1]);const fs=require("fs"),p=require("path");for(const[f,t]of Object.entries(b.text)){fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,t)}fs.writeFileSync(".published.json",JSON.stringify(b.published))' <saved bundle path>
   ```
3. Fetch the assets listed in `.published.json` (portraits, champions, logos, `roster/*`):
   - Use Artifact `read` with `paths`, at most 256 per call. Leave `out_dir` at its default so nobody gets asked to approve the save.
   - Each file lands at `<saved folder>/<published path>`. Copy the tree into `public/`:
     ```bash
     cp -r <saved folder>/. ~/jango/public/
     ```
   - If this step fails, carry on. The check accepts assets listed in `.published.json`, and the publish plan never deletes them. Only the roster-photo portrait fallback and the roster check need `public/roster/`.
4. Install and set a baseline:
   ```bash
   cd ~/jango
   npm ci --prefer-offline || { npm install && git checkout -- package-lock.json 2>/dev/null; }
   git init -q && git add -A && git -c user.name=nightly -c user.email=nightly@invalid commit -qm restore
   node scripts/nightly-publish-plan.mjs --baseline   # hashes every file so "nothing changed" can be detected later
   node scripts/run-log.mjs start nightly             # opens today's entry in data/runs/<date>.json
   ```
   Use `npm ci`, not `npm install`, so `package-lock.json` doesn't change.

**Log as you go** (every command is idempotent):
```bash
node scripts/run-log.mjs checked "ufc332 lineup"
node scripts/run-log.mjs changed "ufc332: Whitehead replaces X (9 days notice)"
node scripts/run-log.mjs failed portraits "Firecrawl 402"
node scripts/run-log.mjs source webfetch        # or firecrawl / mixed
```

## 2. Refresh the data

**ACA cards** (first one: `aca-208`, Oct 4, 2026, added by `scripts/add-aca208.py`):
- **Histories:** Firecrawl-scrape each fighter's Tapology page with `formats: ["markdown", "rawHtml"]` (the raw HTML carries pro/amateur and sport flags per bout), then `python3 scripts/parse-tapology-fighter.py --out <dir> <saved result files>`. Every line must print `OK` or only "no opponent record" problems (opponents with no Tapology page). Cross-check against Sherdog (WebFetch works; add `?r=2` to the URL if the page looks stale).
- **Card and weigh-ins:** ACA's event page (`aca-mma.com/en/tournamentnext/…`, PPV mirror `aca-mma.tv/aca<number>/en/`), Sherdog's event page, and ACA's Telegram (`t.me/acamma_russia`). Tapology can lag or drop a bout.
- **Portraits:** ACA's own profile cut-outs, `…/Upload/Pictures/Fighters/<hash>_495x495.png`, already transparent. Fetch them with Firecrawl `interact` on the event page (`language: "node"`, `page.evaluate` → same-origin `fetch` of each profile and image → canvas → WebP data URL). `/en/api_v1/fighters_for_filter` lists profile links; `/en/fighters/x_<id>` works for any id.
- **Results and round-by-round:** Sherdog play-by-play, ACA's site news and Russian outlets (metaratings, sports.ru, championat). Log, score and review ACA cards like any other card.
- ACA and ACB bouts count as top-level experience on ACA cards (`lib/engine.ts`, `profile()`).

**One-off exception:** OKTAGON 94 (`oktagon-94`, Sep 26, 2026) was added on request. Keep it. After the event, log its results, score it and review it like any other card. Don't add any other OKTAGON events.

"Today" means the date in Toronto. Use the Firecrawl scrape tool to read pages. Tapology blocks direct fetches but works through Firecrawl. ESPN and UFC.com work as cross-checks.

**If Firecrawl fails** (402 "insufficient credits", timeouts, any error), don't stop the run:
- Switch to `WebFetch` (ufcstats.com, ufc.com, sherdog.com, espn.com, mmajunkie.usatoday.com, mmafighting.com, tapology.com if it loads) and `WebSearch` to find pages.
- For portraits, see step 1 (option 2 onward).
- Record the path you used with `run-log.mjs source` and say it in the report.

1. **Upcoming cards (next 21 days).** For each event in `lib/seed.json`, check the Tapology event page and UFC.com. Apply:
   - replacements, withdrawals and cancellations
   - newly added bouts
   - bout order
   - scheduled rounds (3, or 5 for main events and title fights)
   - weight class

   Append every change to `event.changes[]` (date, kind, note, source).

   For a **late replacement**, set `fight.fightWeek.shortNotice`:
   - `fighter` = `a` or `b`
   - `replaced` = the fighter who pulled out
   - `announced` = the date the booking was reported
   - `daysNotice` = event date − announced
   - `source`

   If a fighter is **moving divisions**, set `fight.fightWeek.divisionChange`.

   For a **new event**, also set `event.venue`:
   - `altitudeM`: city elevation
   - `cageFt`: 25 for the small APEX Octagon, 30 for UFC arena cards
   - `tz`: IANA zone
   - `source`

   For any **new fighter**, add:
   - record, and full fight history from Tapology (opponent, result, method, round, date, promotion). Add `scheduledRounds` (3/5) and `title: true` where the source shows it.
   - date of birth
   - height and reach, **in cm**
   - country and stance

   **Portraits must have a transparent background** so they blend into the faceoff. In order of preference:
   1. The official UFC.com `athlete_bio_full_body` image (already transparent). Get it with Firecrawl `interact` on `https://www.ufc.com/athletes`:
      - In the page, `fetch('/athlete/<slug>')` and take the `athlete_bio_full_body` URL. Skip it if it contains `SHADOW`, which is UFC's no-photo silhouette.
      - Fetch the image same-origin, draw it to a canvas at most 640 px tall, and return a WebP data URL.
      - Fetch 3–4 fighters per call. Larger results get saved to a file, which you decode with Python.
   2. **Without Firecrawl:** `WebFetch` the UFC.com athlete page to find the `athlete_bio_full_body` URL, then download it with `curl` if the shell allows that host.
   3. **Without Firecrawl or curl:** run `python3 scripts/portrait-from-roster.py --missing`. It copies transparent full-body portraits out of the restored roster photo pack (`public/roster/photos-*.json`) for UFC fighters it can match by name exactly, and sets `image` in the seed. It never guesses. Unmatched fighters are listed.
   4. A real photo from Sherdog or Tapology, with the background removed locally:
      - `pip install --break-system-packages rembg onnxruntime`
      - upscale 2×, then `rembg.remove(img, session=new_session("isnet-general-use"), post_process_mask=True)`. Try `u2net_human_seg` if arms get cut off.
      - Save as `public/fighters/<id>.webp` with alpha. Look at the result before using it.
   5. Nothing. Leave `image` unset and the site shows a placeholder. Never use a silhouette or placeholder image, such as Sherdog's no-photo picture.

   Add new events inside the 21-day window the same way.

   **File budget:** the artifact holds at most about 511 files per version, and each portrait is one file. The check warns above 430.

1b. **Fight week (cards in the next 7 days).**
   - **Weigh-ins.** Official weigh-ins are the day before the card: Friday for Saturday cards, Monday for DWCS. After they're posted:
     - set `event.fightWeek = { weighInsChecked: <date>, allMadeWeight, source }`
     - for each miss, set `fight.fightWeek.weighIn`: `a`/`b` with `lbs`, `missed`, `missedBy`, plus `limit`, `catchweight`, `checked`, `source`
     - a bout moved to catchweight gets `catchweight: true` and a `changes[]` entry
   - **Cancellations** on weigh-in day: remove the bout and log it in `changes[]`. Don't touch its frozen forecast; it simply gets no result.
   - The check warns on fight day if weigh-ins weren't recorded.
2. **Display odds.** Refresh the display odds if a public source lists them. Do it daily in fight week. They are for display only.
3. **Finished cards (date before today).**
   - If a live run already logged results (`results.live` true or false, see docs/LIVE.md), verify and complete them: fix any wrong row, add missing bouts, add notes and source links. Then set `live` to `false`.
   - Write `results` in `data/ledger/<event>.json`. Follow the shape in `lib/ledger-types.ts`; `data/ledger/ufc331.json` is a complete example.
   - Record:
     - winner and loser
     - method and detail
     - round and time
     - scheduled rounds
     - rounds line, and whether the fight went Over or Under it
     - source links
   - Post-fight extras (see `docs/SCHEMA.md`):
     - `scorecards`: for decisions. Official judges' totals from UFC.com or the commission, media scores from MMADecisions.
     - `bonuses`
     - `closingOdds`: the last display line before the bout, e.g. BestFightOdds. Benchmark only.
   - **Result changes:** if a result was overturned (NC after a failed test, an appeal), rewrite the row to the official result and keep the original in `change` (date, from, reason, source).
   - Then do the round-by-round recap for every bout (step 4a). It is not optional and it is not a one-line note: the owner needs every round of every bout on record.
4. **Reviews.**
   - When results first land, write a `review` with status `initial`. Set `followUpUntil` to 3 days after the event.
   - For each missed pick, name the cause (`data`, `style-read`, `variance`, or `model`) and add a one-line note. A split decision, or a 29-28 loss on the cards, points to `variance`.
   - When the 3-day follow-up date has passed, re-check the reviews (scorecards, injury news, missed context) and set the status to `final` — **but only once every main-card bout has `rounds`, or `recap.status: "unavailable"` with a note of what was searched** (step 4a). Until then leave it `follow-up`. From Sep 26, 2026 on, the check **errors** on a `final` review that breaks this rule.
   - Proposed model changes go in `modelChanges`. They're for Suleman to approve; don't change `lib/engine.ts` on your own.
4a. **Round-by-round recap (every bout of every card finished in the last 3 days).** Post-fight write-ups come out over several days, so this runs on **every** nightly and post-fight pass while a card is inside its review window (event date → `review.followUpUntil`, 3 days after the event), not just the night after. Do it in this order:
   1. **List the work.** Every `results.bouts[]` row on cards dated in the last 3 days (UFC and DWCS always — the check enforces those; PFL / OKTAGON too when the write-ups exist), plus any bout on an older card whose `recap.status` is `pending` or `partial` and whose card's `followUpUntil` is today or later. Main card first (`section` matching "main"; DWCS bouts all count as main card), then prelims. Skip bouts already `complete` unless a new source adds something.
   2. **Search the named sources, in this order**, for each bout (`<A>`/`<B>` = the fighters, `<event>` = the card name as the source writes it, e.g. "UFC Fight Night Rosas Jr. vs Barcelos"):
      - **Sherdog play-by-play (primary):** `"<A> vs <B>" play-by-play sherdog`, `sherdog "<event>" play-by-play`. Sherdog posts one play-by-play per bout on fight night, with round scores from its staff; the event page on sherdog.com links them.
      - **UFC.com:** `site:ufc.com "<event>" results`, then the event page's fight card — each bout's "Scorecards" image has the official round-by-round judges' scores (decisions).
      - **MMA Junkie:** `"<event>" results round by round mmajunkie`, `mmajunkie "<A>" "<B>"`.
      - **MMA Fighting:** `mmafighting "<event>" results`, `"<A> vs. <B>" mmafighting`.
      - **Cageside Press:** `cagesidepress "<event>" live results`, `cagesidepress "<A>" "<B>"`.
      - **MMADecisions (media scores, decisions only):** `mmadecisions <A> <B>`, or the event on mmadecisions.com. Usually posted 1–3 days after the card.
      - Also allowed as a cross-check: ESPN's live results / round-by-round (`espn "<event>" live results round by round`).
      Use Firecrawl scrape; if it fails, `WebFetch` + `WebSearch` (sherdog.com, ufc.com, mmajunkie.usatoday.com, mmafighting.com, cagesidepress.com, mmadecisions.com, espn.com). Log what you searched: `node scripts/run-log.mjs checked "round-by-round <event>"`.
   3. **Fill `rounds` and `recap`** on the bout (shape in `docs/SCHEMA.md` and `lib/ledger-types.ts`):
      - one entry per round actually fought, `n` = 1, 2, 3… in order; a finish's last entry is the finish round
      - `summary`: 2–3 plain sentences on what happened in that round, from the play-by-play, cross-checked with at least one other source where it exists
      - `edge`: who won the round per the write-ups (`"a"`, `"b"`, or `"even"` when the sources split or call it even) — never our own opinion
      - `score`: only when a source scores the round (Sherdog's staff score, an official judge's round card, MMADecisions media), e.g. `"10-9 a"`, `"10-8 b"`
      - `keyMoments`: short tags for what predicts future fights — `knockdown (<name>)`, `rocked, recovered (<name>)`, `cardio fade (<name>)`, `takedowns at will (<name>)`, `stuffed takedowns (<name>)`, `cut (<name>)`, `sub attempt (<name>)`, `point deducted (<name>)`
      - `recap`: `status` (`complete` = every round covered from at least one play-by-play; `partial` = some rounds still thin; `pending` = nothing published yet), `checkedAt` = today, `sources` = every page you used (`{ label, url }`, http(s) only), optional `note`
   4. **Update the bout's `notes`** (2–4 lines: how the fight was won, the rounds that decided it) and **`scorecards`** (official judges from UFC.com / the commission, media from MMADecisions) from what you just read.
   5. **Derive the scouting notes from it** (step 4b): the rounds are the evidence for tags like `cardio-fade`, `td-vulnerable`, `td-offense`, `chin-concern`, `durable`, `slow-starter`, `five-round-proven`.
   6. **Re-check every night** bouts still `pending` or `partial` until the card's `followUpUntil`. On the first run after the window closes, do one last search for any main-card bout still without `rounds`; if there is truly nothing, set `recap.status: "unavailable"` with a `note` listing what was searched and where (e.g. "No play-by-play: Sherdog, MMA Junkie, MMA Fighting, Cageside Press, UFC.com searched Sep 29"). Only then can the review become `final` (step 4).
   The check warns about any finished UFC / DWCS bout with no round-by-round from 1 day after the event, warns **OVERDUE** (`recaps-overdue`) once the window has passed with main-card bouts still missing, and errors (`recaps-final`) on a `final` review that skipped this. It also errors on a malformed `rounds` block (numbering, more rounds than scheduled or fought, a finish not on the last entry, a bad `edge`, a non-http source).
4b. **Scouting notes (the model's permanent memory, `data/scouting.json`).** For every finished bout, read the round-by-round recap from step 4a (the bout's `rounds`, built from Sherdog play-by-play, MMA Junkie / MMA Fighting / Cageside Press / ESPN round-by-round and official scorecards) and append one note per fighter where something useful showed up. Shape:
   ```json
   { "fighter": "<fighter id>", "date": "<event date YYYY-MM-DD>", "event": "<event name>", "tags": ["td-vulnerable"], "kind": "weakness|strength|context", "note": "<one or two plain sentences on what happened>", "source": "<URL(s)>" }
   ```
   - Allowed tags, only when the fight clearly showed it: `cardio-fade`, `five-round-proven`, `td-vulnerable`, `td-offense`, `sub-threat`, `chin-concern`, `durable`, `power`, `discipline-risk`, `slow-starter`, `dq-loss`, `dq-win`.
   - A loss by DQ or illegal strike is `dq-loss` (the engine doesn't count it as a real loss), and the other fighter gets `dq-win`.
   - Use `kind: "context"` with no tags for résumé points (e.g. "wins over X, Y, Z deserve weight").
   - Be unbiased: record what happened, especially where our pick was wrong.
   - Notes only count for fights after their date.
   - Append only: never edit or delete an existing note, and never append the same note twice (a re-run on the same day must not duplicate; the check warns).
   - **Close the loop:** every fighter on a finished bout gets a note, or an explicit "no note" in the ledger:
     ```json
     "review": { …, "scouting": { "checkedAt": "<today>", "noNote": [{ "fighter": "<id>", "reason": "quick finish, nothing new" }] } }
     ```
     The check lists anyone missing, from Sep 26, 2026 on.
5. **Champions page (`lib/rankings.ts`).** Scrape https://www.ufc.com/rankings and use the Media Ranking section. Update the top 10 and movement arrows for each division, the pound-for-pound lists, and `RANKINGS_AS_OF`. The UFC updates these weekly, usually Tuesday; the check warns after 8 days.
   - **New champion:** update the name, record and bio. To get the belt photo, run Firecrawl `interact` on their UFC.com athlete page. Fetch the `athlete_bio_full_body` image with a same-origin relative URL, return a WebP data URL, and save it to `public/champions/<slug>.webp`.
   - **Vacated title:** set `champion.vacated` to the date; the page shows the belt as vacant. When a new champion is crowned, replace the champion and remove `vacated`.
   - **Next in line (`nextInLine`, every division): re-research it every night.**
     - Order of evidence:
       1. an officially booked title fight (`booked`)
       2. credible reporting that a contender is getting the next shot (`expected`: UFC.com, ESPN, MMA Junkie, MMA Fighting, Sherdog)
       3. the highest-ranked contender who hasn't just lost to the champ (`ranking`)
     - It is often NOT the #1 (e.g. a #1 who just lost to the champion, or a champ-vs-champ super-fight).
     - Update `name`, `status`, `note` (one line on why) and `source`, and set `NEXT_IN_LINE_AS_OF` to today.
     - Never drop the block when regenerating the file.
   - **Threat radar:**
     - Drop any prospect who enters the top 10 or takes a bad loss.
     - Add fresh Contender Series signees and unbeaten newcomers.
     - Every prospect must be outside their division's top 10.
     - Records come from Tapology.
6. **Freeze and revise picks.** Run this **after** every data refresh above (lineups, weigh-ins, results, roster, scouting), so the picks see the newest facts:
   ```bash
   npx tsx scripts/freeze.ts --dry-run   # read what would change: OPENED / REVISED / REPLACED / CANCELLED lines
   npx tsx scripts/freeze.ts
   node scripts/run-log.mjs changed "freeze: <n> opened, <n> revised, <n> replaced/cancelled"
   ```
   What it does, per upcoming card (only cards before their lock, never cards with results):
   - **New bout** → an **opening pick** (the first freeze). Opening picks are never edited or deleted.
   - **Existing bout** → if the engine's call changed **materially** since the last recorded pick, it appends a **revision** with a timestamp, engine version and a plain-English reason. Material = the winner side changes (including pick ↔ N/A), the rounds side or line changes, the method changes, or confidence moves **≥ 5 points** on the same side. Anything smaller is ignored, so the record doesn't churn.
   - **Reasons are derived automatically** from what changed in the engine's inputs: an engine version change ("Engine 1.2 update (…)"), `fightWeek.weighIn` ("Missed weight by 2.5 lb (Name)"), catchweight, `fightWeek.shortNotice`, a division change, scheduled rounds, a new result or corrected record, new scouting notes. Otherwise "New information: …". When you know the real cause better (e.g. an injury-driven style change you logged), re-run just that card with `--event <id> --reason "<short why>"` — before running it without the flag.
   - **Replacement** (opponent changed) → the new pairing is a **new bout** with its own opening pick (with `replaces` and a note such as "Replacement opponent (short notice, 9 days)"). The old bout stays in the file marked `status: "replaced"`; a bout that simply disappears is marked `cancelled`. Neither is graded. Nothing is deleted.
   - **Lock rule.** Picks lock at the card's start: the event date plus the earliest ET time in the event's `time` text (e.g. "Prelims 5pm ET · main card 8pm ET" → 5 p.m. Toronto), or midnight Toronto at the start of the event date if no time is listed. The ledger stores it as `lockAt`. After the lock, `freeze.ts` changes nothing on that card. The **final pick** (last revision before lock, or the opening pick) is what the Track record grades; the opening-pick record is shown beside it.
   - When `ENGINE_VERSION` changes, add a one-line summary to `ENGINE_NOTES` in `scripts/freeze.ts` so the revision reason says what changed ("Engine 1.2 update (calibrated confidence, as-of-date stats)"). Engine changes that don't bump the version show up as "New information: …", so bump it.
   - "Today" and the lock use Toronto time. `JANGO_NOW=<ISO>` pretends it's another moment (testing only).
   The check **errors** if a bout on a card that is today or tomorrow has no frozen pick, and if a revision is out of order, after the lock, missing a reason, or if an opening pick or earlier revision differs from the restore commit.
7. Set `CHECKED_AT` in `lib/data.ts` to today. A change to `CHECKED_AT` alone doesn't count as "something changed".
8. Run the check through the run log, so the counts are recorded and the exit code is kept:
   ```bash
   node scripts/run-log.mjs check
   ```
   It rebuilds the ledger index, runs the typecheck, and runs `checks/validate-data.ts`.
   - **Errors block the publish.** Each one is something this run can fix: a bad results row, O/U inconsistent with round and time, a fight-day bout with no frozen pick, a missing portrait file, an implausible height or reach, a malformed `rounds` block, a `final` review with main-card bouts missing their round-by-round. Fix it and re-run.
   - **Warnings never block.** They are staleness and completeness gaps: missing reach, stale rankings, no scorecards or closing odds, reviews past follow-up, scouting gaps, round-by-round recaps still missing (`recaps`, `recaps-overdue`), roster lag. Fix what you can tonight and list the rest in the report. `recaps-overdue` is the loud one: work it before anything cosmetic.
9. **UFC roster (all fighter profiles).** Run `python3 scripts/build-roster.py`, then `npx tsx scripts/build-stats-timeline.ts`. The first downloads UFCStats CSVs from GitHub, which the workspace can reach, and refreshes `public/roster/roster.json`, `names.json` and `rounds.json` (round-by-round lines) with the latest UFC results. The second rebuilds the engine's as-of timelines for seed fighters (`lib/stats-timeline.json`, `lib/round-timeline.json`) and the machine-generated `data/scouting-auto.json`.
   ```bash
   python3 scripts/build-roster.py && npx tsx scripts/build-stats-timeline.ts
   ```
   - Run it before step 6 (freeze) when the mirror has a new card, so fresh picks see the latest fights; if it only updates after the freeze, the next run picks it up.
   - The upstream mirror can lag 1–3 days after a card; the check warns until it catches up.
   - Don't run `scripts/pack-roster-photos.py`. The photo chunks (`public/roster/photos-*.json`) are restored from the artifact and stay as they are.
   - The publish plan uploads `roster.json` / `names.json` / `rounds.json` only if they changed. Never hand-edit `data/scouting-auto.json`; it is regenerated every run and is not `data/scouting.json`.

## 2b. Fight-day live updates

If a **UFC or DWCS** card is on today's date (Toronto), schedule its first live update by rescheduling the existing scheduled task "Jango Playz live update":
- id `trig_01LYQkLyy5QBqVWyh3AfBj7v`; if it's missing, look it up by name with `list_triggers`
- `update_trigger` with `run_once_at` = 30 minutes after the card's first scheduled bout (event `time`, ET; if unknown, 6:00 p.m. ET) and `enabled` = true
- Reuse that one task (set up Sep 26). If it no longer exists, note it in the report.

Live runs repeat every 25 minutes (docs/LIVE.md) and stop when the card is done.

## 3. Build, plan, publish

```bash
npm run build
node scripts/bundle-source.mjs      # refreshes dist/source/bundle.json (fails loudly if the bundle would be unrestorable or >14 MB)
python3 scripts/prepare-publish.py  # writes publish/index.html
```

Get the live file list, so superseded JS bundles can be removed:
- Artifact `list` with `scope: "files"` and `url` = the site.
- Save the listing text to `/tmp/jango-live-files.txt`, **outside** `~/jango`.

Then plan:
```bash
node scripts/nightly-publish-plan.mjs --live /tmp/jango-live-files.txt; echo "plan exit $?"
```

- **Exit 3: nothing changed.** Run `node scripts/run-log.mjs finish no-change` and **do not publish**. This is the normal result for a quiet night.
- **Exit 1: problem** (stale bundle, missing build). Fix it and re-run, or stop without publishing.
- **Exit 0: publish.**
  1. Record the publish, then re-bundle so the run log rides along:
     ```bash
     node scripts/run-log.mjs published <file count from the plan>
     node scripts/bundle-source.mjs
     ```
  2. Publish with the Artifact tool, once per batch file (normally only `publish/files-batch-1.json`):
     - action `publish`
     - `url` = the site link
     - `file_path` = `publish/index.html`
     - `root` = `dist`
     - `files` = the JSON object in `publish/files-batch-<n>.json`, passed as is

     It contains the new `assets/*.js`, `source/bundle.json`, and any new or changed images and roster files. It contains `null` only for superseded `assets/index-*.js`. Files left out stay as they are, including `films/`.
  3. The first publish in a fresh session is usually refused ("hadn't viewed the live version"), and the live page is saved locally. Read its lines 1–8 and 10–15 (skip the huge CSS line 9). If the only differences are the generated CSS and the `assets/index-*.js` name, publish the same call again.
  4. Afterwards: `node scripts/run-log.mjs finish ok`, or `finish partial` if some steps failed.

Never use `scripts/publish-plan.py` in a nightly or live run. It is for manual publishes from a full `dist/`, and it also refuses to null `films/` and `roster/`.

**Re-running is safe.** A second run on the same day restores the latest published bundle, finds nothing new, and publishes nothing. `freeze.ts` never overwrites an opening pick and only appends a revision when the call changed materially since the last one, so a re-run adds nothing. Scouting notes must not be appended twice; the check warns.

## 4. Push to GitHub (only if set up)

This step runs only when both environment variables exist:
- `JANGO_GH_TOKEN`: Suleman's fine-grained token, scoped to this one repo
- `JANGO_GH_REPO`: e.g. `sulxman/jango-playz`

If either is missing, skip this step and say so in the report.

- Never print, echo or log the token, and never write it to a file.
- Never push to any other repo or account (never `hpervaiz9-commits`).
- Don't use a GitHub connector.

```bash
cd /tmp && rm -rf site && git clone --depth 1 "https://x-access-token:${JANGO_GH_TOKEN}@github.com/${JANGO_GH_REPO}.git" site
# copy refreshed source over the repo (no --delete: the repo has the films, the restored copy doesn't)
rsync -a --exclude node_modules --exclude dist --exclude publish --exclude .git --exclude .published.json --exclude .restore-manifest.json --exclude 'public/films/' ~/jango/ site/
cd site && git add -A && git -c user.name="Jango Playz nightly" -c user.email="nightly@jango-playz.invalid" commit -qm "Nightly refresh $(TZ=America/Toronto date +%F)" && git push -q origin HEAD:main
```

GitHub Actions then rebuilds, and the GitHub Pages site updates within a couple of minutes.

## 5. Report

End with a short summary covering:
- lineup changes applied (including weigh-in misses and short-notice bookings)
- new fighters added
- results logged and how the picks did (winner, O/U, method), plus vs-market where closing odds exist
- round-by-round recaps: bouts completed tonight, still `partial` / `pending` (and until when), any marked `unavailable`
- reviews written or finalized, and scouting notes added or no-note decisions
- check result (errors / warnings by category, from the `VALIDATE` line) and what you left as warnings
- source path used (Firecrawl / WebFetch), and failures from the run log
- published or not (and the plan's reason)
- any gaps you couldn't verify

Include the site link.

---

## Extra passes (same runbook, narrower scope)

Each pass is its own scheduled session. It does step 1 (restore, baseline, `run-log.mjs start <kind>`), then only the steps listed, then steps 6–8 and 3. It publishes only if the plan says something changed, and it ends with a three-line report.

### Fight-week pass (`kind` = `weigh-in`), Mon / Thu / Fri late afternoon
- Exit right away (no restore) unless a UFC, DWCS or PFL card in `lib/seed.json` is **tomorrow** (Toronto). To check that without a full restore: read the bundle, unpack it, look at `lib/seed.json`.
- Do: step 2.1b (weigh-ins, misses, catchweights, cancellations), step 2.1 for that card only (late replacements with `shortNotice`, new fighters, portraits), step 2.2 (display odds), then step 6 **after** those updates: it freezes replacement bouts (new opening picks, old bout marked `replaced`) and records a revision wherever the new facts moved a pick materially. This is the last chance before lock — the Friday pass runs the day before the card, so its revisions become the final picks unless the card's own day brings more news before the start time.
- A missed weight doesn't move the engine by itself yet (see "Engine hooks" in `docs/SCHEMA.md`); log it anyway so a revision caused by it — or by anything else that night — carries the right reason, and the review can read it.

### Post-fight pass (`kind` = `sunday`), Sunday early afternoon
- Exit right away unless a card finished in the last 3 days, or a card still in its review window has bouts with `recap.status` `pending` / `partial`.
- Do, in this order: step 2.3 in full (results verification, official scorecards, media scores, bonuses, closing odds, result changes, `live=false`), step 2.4 (initial review), **step 2.4a (round-by-round recap for every bout, main card first — run the searches listed there, fill `rounds` + `recap`, update `notes` / `scorecards`)**, step 2.4b (scouting notes derived from the rounds, plus the `review.scouting` decision), step 2.9 (roster, if the mirror has updated).
- Recaps and official scorecards are usually posted by Sunday midday. At 2:30 a.m. they often aren't — so bouts the pass can't cover yet get `recap.status: "pending"`, and the nightly keeps re-checking them until `followUpUntil`.
- The three-line report says how many bouts got a complete round-by-round, how many are partial / pending, and which main-card bouts are still missing.
