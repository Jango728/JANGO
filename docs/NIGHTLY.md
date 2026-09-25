# Jango Playz: nightly refresh runbook

This runs every night at 2:30 a.m. Toronto time, as a scheduled task. Each run starts with no memory of earlier runs. The live site is the Claude artifact **https://claude.ai/artifact/CB3f7jVHeYrvitrxxTkT1A**. It also stores the project's source, so a run can restore the source, update the data, and republish to the same link.

## Hard rules

- Never use or touch the `hpervaiz9-commits` GitHub account or any token. This project needs no GitHub.
- Never send email, Teams, Slack, or any other message to anyone. Report only inside the session.
- Odds are for display only. They are never an input to the model.
- Frozen forecasts in `data/ledger/*.json` are permanent. Never edit a `forecast` block once it exists. `scripts/freeze.ts` already refuses to.
- Never invent a fighter, result, record, or number. If you can't verify something, leave it out and note the gap.
- Publish only when `npm run check` and `npm run build` both pass. If anything fails, stop and report. The live site stays as it was.

## 1. Restore the source

1. Read the artifact file `source/bundle.json` with the Artifact tool:
   - action `read`
   - `url` = the site link above
   - `path` = `source/bundle.json`

   It's saved locally.
2. Unpack it into `~/jango`:
   ```bash
   mkdir -p ~/jango && cd ~/jango
   node -e 'const b=require(process.argv[1]);const fs=require("fs"),p=require("path");for(const[f,t]of Object.entries(b.text)){fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,t)}fs.writeFileSync(".published.json",JSON.stringify(b.published))' <saved bundle path>
   ```
3. Fetch the images listed in `.published.json`:
   - Use Artifact `read` with `paths`, at most 256 per call.
   - Copy each saved file into `public/<same path>`.
4. Run `npm install`. Then run `git init && git add -A && git commit -qm restore` so the run's diff is easy to see.

## 2. Refresh the data

"Today" means the date in Toronto. Use the Firecrawl scrape tool to read pages. Tapology blocks direct fetches but works through Firecrawl. ESPN and UFC.com work as cross-checks.

1. **Upcoming cards (next 21 days).** For each event in `lib/seed.json`, check the Tapology event page and UFC.com. Apply:
   - replacements, withdrawals and cancellations
   - newly added bouts
   - bout order
   - scheduled rounds (3, or 5 for main events and title fights)
   - weight class

   For any new fighter, add:
   - record, and full fight history from Tapology (opponent, result, method, round, date, promotion)
   - date of birth
   - height in feet and inches, reach in inches
   - country and stance

   **Portraits must have a transparent background** so they blend into the faceoff. In order of preference:
   1. The official UFC.com `athlete_bio_full_body` image (already transparent). Get it with Firecrawl `interact` on `https://www.ufc.com/athletes`: `fetch('/athlete/<slug>')` in the page, take the `athlete_bio_full_body` URL (skip it if it contains `SHADOW`, which is UFC's no-photo silhouette), fetch it same-origin, draw it to a canvas at most 640 px tall, and return a WebP data URL. Fetch 3–4 fighters per call; larger results get saved to a file, which you decode with Python.
   2. A real photo from Sherdog or Tapology, with the background removed locally: `pip install --break-system-packages rembg onnxruntime`, upscale 2×, then `rembg.remove(img, session=new_session("isnet-general-use"), post_process_mask=True)`. Try `u2net_human_seg` if arms get cut off. Save as `public/fighters/<id>.webp` with alpha. Look at the result before using it.
   3. Nothing. Leave `image` unset and the site shows a placeholder. Never use a silhouette or placeholder image, such as Sherdog's no-photo picture. Add new events inside the 21-day window the same way.
2. **Display odds.** Refresh the display odds if a public source lists them. They are for display only.
3. **Finished cards (date before today).** Write `results` in `data/ledger/<event>.json`. Follow the shape in `lib/ledger-types.ts`, and see `data/ledger/ufc331.json` for a complete example. Record:
   - winner and loser
   - method and detail
   - round and time
   - scheduled rounds
   - rounds line, and whether the fight went Over or Under it
   - source links
4. **Reviews.**
   - When results first land, write a `review` with status `initial`. Set `followUpUntil` to 3 days after the event.
   - For each missed pick, name the cause (`data`, `style-read`, `variance`, or `model`) and add a one-line note.
   - When the 3-day follow-up date has passed, re-check the reviews (scorecards, injury news, missed context) and set the status to `final`. Proposed model changes go in `modelChanges`. They're for Suleman to approve; don't change `lib/engine.ts` on your own.
5. **Champions page (`lib/rankings.ts`).** Scrape https://www.ufc.com/rankings and use the Media Ranking section. Update the top 10 and movement arrows for each division, the pound-for-pound lists, and `RANKINGS_AS_OF`.
   - **New champion:** update the name, record and bio. To get the belt photo, run Firecrawl `interact` on their UFC.com athlete page. Fetch the `athlete_bio_full_body` image with a same-origin relative URL, return a WebP data URL, and save it to `public/champions/<slug>.webp`.
   - **Threat radar:** drop any prospect who enters the top 10 or takes a bad loss. Add fresh Contender Series signees and unbeaten newcomers. Every prospect must be outside their division's top 10. Records come from Tapology.
6. **Freeze picks.** Run `npx tsx scripts/freeze.ts`. It freezes the engine's picks for upcoming cards and never overwrites an existing forecast.
7. Set `CHECKED_AT` in `lib/data.ts` to today.
8. Run `npm run check`. It rebuilds the ledger index, runs the typecheck, and runs data validation (only 3 or 5 rounds, every portrait file exists, relative paths). Fix anything it flags.

## 3. Build and publish

```bash
npm run build
node scripts/bundle-source.mjs      # refreshes dist/source/bundle.json
python3 scripts/prepare-publish.py  # writes publish/index.html + publish/files-map.json
```

Publish with the Artifact tool:
- action `publish`
- `url` = the site link
- `file_path` = `publish/index.html`
- `root` = `dist`
- `files` = the new `assets/*.js`, `source/bundle.json`, and any new or changed images

Files left out of `files` stay as they are, including the film clips in `films/` (and `films/tracks.json`). **Never pass `null` for anything under `films/`**, and don't use `scripts/publish-plan.py` removals in a nightly run: the restored copy doesn't include the films, so a plan built from it would delete them.

## 4. Push to GitHub (only if set up)

This step runs only when both environment variables exist: `JANGO_GH_TOKEN` (Suleman's fine-grained token, scoped to this one repo) and `JANGO_GH_REPO` (e.g. `sulxman/jango-playz`). If either is missing, skip it and say so in the report.

- Never print, echo or log the token, and never write it to a file.
- Never push to any other repo or account (never `hpervaiz9-commits`).
- Don't use a GitHub connector.

```bash
cd /tmp && rm -rf site && git clone --depth 1 "https://x-access-token:${JANGO_GH_TOKEN}@github.com/${JANGO_GH_REPO}.git" site
# copy refreshed source over the repo (no --delete: the repo has the films, the restored copy doesn't)
rsync -a --exclude node_modules --exclude dist --exclude publish --exclude .git --exclude .published.json --exclude 'public/films/' ~/jango/ site/
cd site && git add -A && git -c user.name="Jango Playz nightly" -c user.email="nightly@jango-playz.invalid" commit -qm "Nightly refresh $(TZ=America/Toronto date +%F)" && git push -q origin HEAD:main
```

GitHub Actions then rebuilds, and the GitHub Pages site updates within a couple of minutes.

## 5. Report

End with a short summary covering:
- lineup changes applied
- new fighters added
- results logged and how the picks did
- reviews written or finalized
- any gaps you couldn't verify

Include the site link.
