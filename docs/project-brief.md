# JANGO PLAYZ — Project Brief (ChatGPT Sep 9–24 → Claude from Sep 24, 2026)

Formerly "FightLens". The name is final: **JANGO PLAYZ** (two words, huge wordmark, custom "P" logo), with a black-and-gold theme. The site belongs to Suleman (Sully).
**Live site:** https://claude.ai/artifact/CB3f7jVHeYrvitrxxTkT1A (see STATUS at the bottom). The old GPT site is retired.

## Scope
- Promotions: UFC (priority), Dana White's Contender Series (DWCS), PFL, ACA. Removed: RIZIN, K-1, OKTAGON, ONE (including ONE Friday Fights). Exception: OKTAGON 94 (Sep 26) was added on request as a one-off.
- Numbered UFC cards get the deepest analysis (film and clip review, broadcast and commentary notes).
- Every upcoming bout must have a winner pick AND a rounds O/U pick. If key data truly can't be verified, show "N/A / analysis pending"; never force a pick.

## Prediction model — what the user looks at (use all of each, then reach a consensus; weights stay hidden)
- Full record, plus UFC record (shown in brackets below the overall record).
- Last 10 fights (Tapology): opponents' records at fight time, organization, weight class, method, round.
- Quality of opposition (weighted heavily): who they beat AND who beat them.
- Height and reach advantage; stance; physique (current photos and Instagram, not old Tapology photos).
- Fighting-style matchup (striker vs wrestler, sambo, kickboxing, etc.); striking and grappling stats (strikes, control time, takedowns).
- Round and pace history: have they ever gone past R1? What is their distance history?
- Age, inactivity or layoff, losing streaks, recent momentum.
- Elite-vs-elite rule: two finishers who stopped weaker opposition may NOT finish each other. Lean toward a longer fight, unless both are true power KO artists (e.g. heavyweights).
- Discount regional finish records: finishes against weak or losing opponents don't transfer to the UFC.
- Footage: search "<name> fight", highlights, YouTube, TikTok and breakdowns. Prefer full fights over highlights, and label evidence that comes only from highlights.
- ODDS are display only (BestFightOdds) and NEVER a model input. No other people's predictions either.
- Weights are internal only, and the model should self-adjust after every result. Several internal models vote; disagreement lowers confidence. The model may disagree with the user when the evidence says so.
- The user's own reads are logged:
  - Favoured Cortez over Blaydes.
  - Tuivasa should lose (losing streak, size and physique).
  - UFC 333: Yan over Merab (5 rounds, title); Azaitar over Reyes (card is now Reyes vs Murzakanov); Yakhyaev over Krylov; Pico can't be counted out.

## Confidence
- Must NOT cluster at 50–60%. Tiers: 50–54 coin flip · 55–62 slight lean · 63–71 solid lean · 72–81 strong · 82%+ exceptional.
- Combine matchup edge and evidence quality. An animated gold ring winds up to the %.

## Rounds O/U
- 3-round fights: always O/U 1.5. 5-round fights (main events and title fights): always O/U 2.5. There are no 4-round fights (a validation check blocks them).
- The rounds pick sits in its own box, separate from the winner pick, with 2–3 blunt reasons. The winner pick gets up to 5 reasons plus the strongest counterargument.

## Learning loop / Picks & Results
- Freeze predictions before the fight and never rewrite them after. Score winner, method and rounds, and show accuracy %.
- For each miss: record the cause (data gap, style read, variance, model logic), note it, adjust the model, and backtest before shipping.
- Re-review completed fights for 3 days as commentary and recaps appear. Wait for more information rather than force an inconclusive review.
- Post-fight sources: Sherdog play-by-play and round scoring (key), cross-checked with UFC.com.

## Data sources
Tapology (preferred; reach it via Firecrawl scrape) · Sherdog · UFC.com / UFCStats · ESPN fightcenter · SofaScore · BestFightOdds (odds display only). Units: height in ft/in, reach in inches.

## Nightly refresh — 2:30 a.m. Toronto, daily (LIVE from Sep 26, 2026)
A scheduled task, "Jango Playz nightly refresh", runs in the cloud with no notifications. It must never send messages or use any GitHub account or token.
1. Restore the source from the artifact's `source/bundle.json`, then follow `docs/NIGHTLY.md`.
2. Add newly announced UFC/DWCS (plus PFL/ACA) cards. Fill in photos (transparent only), height, reach and histories. Mark N/A where data is pending and retry the next day.
3. Close finished cards: put results in the ledger, score the frozen picks, and write the postmortem with a miss cause for each miss. Re-review for 3 days. Proposed model changes need approval.
4. Update the Champions page from the UFC.com media rankings.
5. Freeze picks for new bouts, run check and build, and republish to the same artifact. Leave films untouched.

## Design rules
- Feel like UFC.com: clean, smooth, minimal scrolling, one cohesive black-and-gold theme, polished buttons with click feedback.
- Promotion logos always visible and transparent; a clear event selector (the event rail with status chips).
- Card: Main card / Prelims tabs. Bold event title and venue; no clutter.
- Matchup: large fighters with 3D-tilt portraits. Boxed tabs: Prediction · Compare stats · Rounds · Full history · Film room · My notes. Highlight the better stat in each row.
- Portraits: full body or torso, heads never cut off, ALWAYS with a transparent background. Flags for all fighters.
- No weight sliders. Model Lab explains how a take is made (read-only).
- Nav order: Fight center · Champions · Track record · Clips · Model lab (phones: Fights · Champs · Record · Clips · Lab). Search button (or /) finds fighters and cards. Clicking the JANGO PLAYZ brand goes to Fight center.

## Finish films (projected finish)
- Pre-rendered, hyper-real clips (three.js, Rocketbox characters, Bandai-Namco mocap, full arena and crowd). Each plays once and then shows Replay.
- KO: an exchange, then the KO; the ref waves it off; ends on the loser's POV of the winner giving double middle fingers. No goofy victory run.
- Submission: rear-naked choke, tap, the ref pulls the winner off, the loser goes limp, then the clown face. No run.
- Decision: the ref raises the hand, then the winner climbs the cage.
- Red- and blue-corner versions exist for men and women. Files are `films/<ko|sub|dec>-<red|blue>[-f].mp4`, and name-tag tracks are merged in `films/tracks.json`. The render pipeline is in `render/`.

## Sully's Collection — Headshot List
- Rivals who lost, shown as crosshair photos. "Son of" in gold plus the winner's name in blood red (Merab → Petr Yan; Ilia → Justin Gaethje).
- Calm v2 animation: the gun stays level, the reticle locks, the shot lands, and a real blood tear wells up under the eye and runs down.
- The magazine stands upright below the trigger, next to the rounds and the 2/5 count. The replay button is at the top right.
- Don't change the title. v1 is kept at `archive/headshot-v1` (git tag `headshot-v1`).

## Champions page
- UFC.com media rankings. Each division shows the champion with a belt photo, the top 10 with movement, and "Next in line"; there is also a pound-for-pound view.
- Threat radar: under-the-radar prospects, labelled "(all listed fighters are outside the division's top 10)". Contender Series signees and unbeaten newcomers only; no declining veterans.

## STATUS — updated Sep 27, 2026
**Live site:** https://claude.ai/artifact/CB3f7jVHeYrvitrxxTkT1A (version 19, published Sep 27 ~1:10 a.m.). Private until shared from its Share menu.
**GitHub Pages copy:** https://jango728.github.io/JANGO/ (repo Jango728/JANGO, uploaded by Suleman himself). Claude can't push to it from the cloud; Suleman uploads update zips via GitHub's "Upload files" (max 100 files per upload). Never use the hpervaiz9-commits account or any GitHub connector (it's his brother's). Never reuse or print any token pasted in chat.

**Added Sep 27 (engine 1.1):**
- Fighter profiles: tap any name anywhere (faceoff, histories, Champions, clips, search). Tabs: Overview, Fight history (clickable opponents, W/L + KO/SUB/DEC icon, bold finish), Scouting, Clips, Stats. Profiles merge ledger results the scraped history is missing (lib/logged-history.ts).
- Site search (fighters + cards, finished or upcoming).
- Gold record under the main record is promotion-specific (UFC on UFC cards, PFL on PFL, etc.).
- Scouting notes = the model's permanent memory (data/scouting.json, tags: cardio-fade, five-round-proven, td-vulnerable, td-offense, sub-threat, chin-concern, durable, power, discipline-risk, slow-starter, dq-loss, dq-win). Only count for fights after their date. Nightly adds them from round-by-round reports.
- Engine 1.1: DQ/overturned results ignored; elite UFC wins get extra weight; head-to-head fades (half weight per 3 years); scouting signal (weight 0.1).
- Track record: "X of Y winners/rounds right", Win ✓/✗ and Over/Under ✓/✗ beside each pick, bold pick/%/method, tabs per promotion (All/UFC/DWCS/PFL/OKTAGON).
- Champions: all names clickable; `nextInLine` researched per division (booked > credible report > ranking), not always #1. Women's flyweight shown vacant (Shevchenko vacated Sep 5; Silva vs Wang Cong for the belt at UFC 332, Oct 3).
- Clips tab (24 verified official YouTube clips) + clips in profiles and the Film room.
- Where the edges are: plain-English names grouped by Résumé / Style matchup / Form & readiness, bigger text, leader + strength per row.
- My notes: Save button + saved indicator (Ctrl+S).
- Nightly task prompt updated: WebFetch/WebSearch fallback when Firecrawl is out of credits (402), scouting notes, next-in-line re-research.


**Sep 27 afternoon (versions 20–22):**
- Engine 1.2: as-of-date UFCStats numbers for 168 seed fighters (no leakage), results-vs-opposition replaces raw schedule strength, calibrated probabilities, age from birth date. Out-of-sample (504 fights, 2025–26): 65.5% winners vs 62.4% for v1.1; on bouts with odds 71.4% vs market favourite 71.3%. Rounds accuracy ≈ always-Over; gains are in calibration. Backtest: scripts/backtest.ts.
- Track record: plain headline, "Model vs market" panel (evaluation only), log-loss/Brier.
- Full UFC roster profiles (1,211 fighters, 413 photos), all opponent names clickable, v2 finish films (CMU mocap, IK, ragdoll), clips library of 155 official videos (link-out inside Claude; inline on GitHub Pages).
- OKTAGON 94 results + review logged (winners 6/8, rounds 5/10); FN 289 follow-up; 30 new scouting notes.
- Site code-split: first load ~670 KB JS (was 3.3 MB).
- Nightly hardened: publish plan script (no-change runs publish nothing), run log, more data checks, roster rebuild. New scheduled tasks: fight-week pass (Mon/Thu/Fri 5:12 p.m.) and post-fight pass (Sun 12:47 p.m.).

**Still open:**
- Finish animations still look cartoonish. Survey done: best path is MetaHuman (needs a one-off Unreal export on a PC) or MPFB2/CC0 bodies + Mixamo/CMU mocap, rotation-based retargeting, two-bone IK so punches land, Jolt ragdoll for the KO, gloves modelled from the hand mesh, AgX tone mapping. Waiting on Suleman's go-ahead before a full re-render.
- Striking/grappling stats (UFCStats) missing for most fighters — biggest accuracy gap.
- Sep 22 ranking changes not fully applied; Firecrawl has no credits (nightly now falls back to WebFetch).
- Barcelos UFC record history gap; Davi Cabral and Lucas Armand have no real photo; Chopurov nationality unverified.

**Stack:** Vite + React 19 + TypeScript + Tailwind 4, static. Build: `npm run check && npx vite build && node scripts/bundle-source.mjs && python3 scripts/prepare-publish.py && python3 scripts/publish-plan.py`. Publish: read the artifact first, upload only changed files, null only stale assets/index-*.js, never null films/. Source lives in the artifact at source/bundle.json.

## STATUS — updated Oct 1, 2026 (artifact version 32, engine 1.3)
**Since Sep 27:** engine 1.3 (round-by-round UFCStats tape; winners 65.5%, rounds 68.9% on 2025–26 fights it never saw), pick revisions until each card locks (opening pick kept, final pick graded), Matchmaker tab, Breakdown tab on every bout, clips library (373 official videos), round-by-round "How it went" recaps on every finished bout (runbook step 2.4a), GitHub copy at Jango728/JANGO updated by Suleman's own GitHub Claude from zips.

**ACA 208: Shaikhaev vs. Tumenov (Sun Oct 4, Grozny) added Oct 1** — event id `aca-208`, 22 bouts, 44 fighters, first bout 6am ET (picks lock then).
- Card confirmed against ACA's event page, Sherdog and Russian media. Tapology drops one bout (Sulumov vs Moraes) and lists Kerimov vs Podlesniy at 145; ACA says bantamweight. Israpilov vs Gadzhiev is loaded as flyweight (ACA's event page says 61.7 kg) pending the Oct 3 weigh-in.
- Histories: Tapology (opponent record going into each fight) parsed by `scripts/parse-tapology-fighter.py` from Firecrawl scrapes with `formats: ["markdown","rawHtml"]`, cross-checked bout by bout with Sherdog (978 fights). Differences are written into each fighter's record note. Builder: `scripts/add-aca208.py` (inputs in `data/research/aca208/`).
- Portraits: ACA's own transparent profile cut-outs for all 44, fetched with Firecrawl `interact` (same-origin fetch inside the page).
- Not published for most ACA fighters, left blank: reach, stance, a few birth dates. Display odds on 13 of 22 bouts (BestFightOdds; Winline for two).
- Engine: unchanged, but ACA and ACB fights count as top-level experience on ACA cards (same idea as OKTAGON). No striking/grappling stats exist for ACA, so these picks are lower-evidence than UFC picks.
- Opening picks frozen Oct 1: Tumenov 61% (Over 2.5), Abdulvakhabov 75%, Dudaev 56%, Selimkhanov 58%, Starodub 52%, Podlesniy 61%, Dolgov 52%, Matsola 62%, Sulumov 59%, Abdurakov 62%, Boraev 71%, Figueiredo 69%, Hulme 73%, Israpilov 68%, Vitakhanov 55%, Kushagov 56%, A. Suleymanov 55%, Malsagov 60%, Oliveira 50%, R. Suleymanov 69%, Fakov 52%, Geroev 68%. All non-title bouts Over 1.5.
- To do on fight week: weigh-in results (Oct 3), any late changes, closing odds; after the card: results, scoring, round-by-round recaps.

**Publishing note:** when the nightly has published since the last manual publish, merge its `source/bundle.json` first, build the files map against the live file list, and expect one "newer version" refusal (read the saved page, publish again).
