# Data schema: optional fields for fight-week, post-fight and run logs

All fields below are **optional and additive**. Old data stays valid; the engine ignores anything it doesn't read yet. Types live in `lib/types.ts` (seed) and `lib/ledger-types.ts` (ledger). `checks/validate-data.ts` checks their shape and warns when an expected one is missing. Nothing here is a model input until the model owner wires it in (see "Engine hooks" at the end).

Units: heights and reaches are **centimetres** (5'11" = 180.3, 72" reach = 182.9), weights are **pounds**, dates are `YYYY-MM-DD` (Toronto), odds are **American** (−150 / +130).

## What to collect, and what to skip

Collect only facts that predict fights or keep the record honest:
- official weigh-ins, missed weight, catchweights
- late replacements (with days of notice), withdrawals, cancellations
- division changes
- venue altitude, cage size, time zone
- 5-round and title-fight history
- official scorecards, result changes
- fight-time display odds (as a benchmark only)

Skip noise:
- hype, trash talk, "looked great in camp" stories
- pundit or community picks, betting tips
- social-media rumours of injuries (log an injury only when it causes an official withdrawal)
- padded regional records taken at face value: the engine already weighs opposition, so record what happened and who it was against

## Seed (`lib/seed.json`)

### `event.venue`
```json
"venue": { "altitudeM": 1288, "cageFt": 30, "tz": "America/Denver", "source": "https://en.wikipedia.org/wiki/Salt_Lake_City" }
```
- `altitudeM`: city elevation in metres. It matters from about 1,200 m up (Salt Lake City about 1,290 m, Mexico City about 2,240 m).
- `cageFt`: 25 for the small UFC APEX Octagon (most APEX cards, DWCS included; confirm per event when it's reported), 30 for arena UFC cards. Use the promotion's cage size for PFL and OKTAGON when it's published; otherwise leave it out.
- `tz`: IANA time zone of the venue.

### `event.fightWeek` (card level)
```json
"fightWeek": { "weighInsChecked": "2026-10-02", "allMadeWeight": false, "source": "https://www.ufc.com/news/..." }
```
Set this once the official weigh-in results are read. When someone misses, set `allMadeWeight: false` and record the miss on that bout.

### `event.changes[]` (append only)
```json
{ "date": "2026-09-30", "kind": "replacement", "note": "Bruce Whitehead replaces injured X vs Lucas Armand", "source": "https://..." }
```
`kind` is one of `withdrawal`, `replacement`, `added`, `cancelled`, `moved`, `weight`, `rounds`, `other`. Log every lineup change the nightly applies. It is the audit trail, and reviews read it.

### `fight.fightWeek`
```json
"fightWeek": {
  "weighIn": { "a": { "lbs": 146 }, "b": { "lbs": 148.5, "missed": true, "missedBy": 2.5 }, "limit": 146, "catchweight": false, "checked": "2026-10-02", "source": "https://..." },
  "shortNotice": { "fighter": "b", "replaced": "Original Opponent", "announced": "2026-09-24", "daysNotice": 9, "source": "https://..." },
  "divisionChange": [{ "fighter": "a", "from": "Lightweight", "source": "https://..." }]
}
```
- `limit`: the division limit, or the contracted catchweight. Non-title bouts get a 1 lb allowance, so `missedBy` is pounds over limit + allowance.
- `daysNotice` = event date − `announced` date. Record it only when the booking is reported as a replacement or a late booking (≤ 21 days).
- `fighter` is `"a"` or `"b"`, matching the bout's sides.

### `fighter.history[]`: new optional keys
- `scheduledRounds`: 3 or 5, for the fight as booked. It is the only way to count real 5-round experience, including 5-rounders that ended early.
- `title`: true for a world-title or interim-title fight in any promotion.

### `fighter.base` (optional, low priority)
```json
"base": { "location": "Albuquerque, NM", "tz": "America/Denver", "source": "https://...", "checked": "2026-09-27" }
```
The training base, used for travel and time-zone context. Fill it only from a stated source (UFC.com "Trains at", the fighter's gym).

## Ledger (`data/ledger/<event>.json`)

### `results.bouts[]`: new optional keys
```json
"scorecards": { "judges": [{ "judge": "Sal D'Amato", "a": 29, "b": 28 }, { "a": 28, "b": 29 }, { "a": 29, "b": 28 }],
                "media": [{ "outlet": "MMA Junkie", "a": 29, "b": 28, "url": "https://..." }], "source": "https://www.ufc.com/..." },
"bonuses": [{ "type": "POTN", "fighter": "Rodolfo Vieira" }, { "type": "FOTN" }],
"change": { "date": "2026-10-20", "from": "Win for X by KO/TKO R2 3:11", "reason": "Overturned to NC after a failed drug test", "source": "https://..." },
"closingOdds": { "a": -210, "b": 175, "asOf": "2026-09-26T23:40:00Z", "source": "https://www.bestfightodds.com/events/..." }
```
- `scorecards`: decisions only. Official cards come from UFC.com (posted after the event) or the athletic commission. Media scores come from MMADecisions.com. A split or 29-28 x3 loss is evidence for a `variance` cause in the review.
- `change`: when a result is overturned, rewrite the bout row to the official result (e.g. `method: "No contest"`, `winner`/`loser` null) and keep the original in `change.from`. Never touch the frozen forecast.
- `closingOdds`: the last line before the bout. It is **display and benchmark only, never a model input.**

### `review.scouting`
```json
"scouting": { "checkedAt": "2026-09-29", "noNote": [{ "fighter": "tina-black", "reason": "Quick first-round finish; nothing new learned" }] }
```
After the scouting pass, every fighter on a finished bout either has a note in `data/scouting.json` dated the event day, or is listed in `noNote` with a reason. Use the fighter id or the exact name. The check warns about anyone who has neither.

### `forecast.bouts[]`: new optional keys (written by `scripts/freeze.ts`)
- `frozenAt`: per-bout freeze time, for bouts added after the first freeze. It is already written; now it is typed too.
- `naReason`: why `pick` is null. The check accepts a null pick only with a reason.
- `engine`, `inputs`: engine version and inputs fingerprint of the opening pick (bouts frozen from Sep 27, 2026 on).

### Pick revisions (`lockAt`, `forecast.bouts[].revisions`, `status`)
The top-level fields of a frozen bout are its **opening pick** and never change. Later material changes before the card starts are appended:
```json
"lockAt": "2026-10-24T14:00:00.000Z",
"forecast": { "bouts": [ {
  "a": "Petr Yan", "b": "Merab Dvalishvili", "pick": "Merab Dvalishvili", "confidence": 51, "tier": "Coin flip", "…": "opening pick, permanent",
  "revisions": [ {
    "at": "2026-09-27T18:56:50.929Z", "engine": "1.2",
    "pick": "Petr Yan", "confidence": 52, "tier": "Coin flip", "rounds": { "line": 2.5, "side": "Over" }, "method": "Decision",
    "reason": "Engine 1.2 update (calibrated confidence, as-of-date stats)",
    "changed": ["pick"],
    "inputs": { "scheduledRounds": 5, "division": "Bantamweight", "records": ["20-5-0", "21-5-0"], "lastFights": ["2025-12-06", "2025-12-06"], "scouting": [0, 0] }
  } ]
} ] }
```
- `lockAt` (ledger level): when picks lock, as a UTC instant. It is the event date plus the earliest ET start time in the event's `time` text, in Toronto time; with no time listed, midnight Toronto at the start of the event date. `freeze.ts` writes it and changes nothing on a card at or after it.
- A **revision** is recorded only for a material change vs the previous pick (last revision, else opening): winner side (incl. pick ↔ N/A), rounds side or line, method, or confidence moving **≥ 5 points** (`REVISION_CONFIDENCE_STEP` in `lib/ledger.ts`). `changed` lists which. `reason` is short plain English, derived from what changed in `inputs` (engine version, weigh-in miss, short notice, rounds, new result, new scouting notes, …). Append-only and chronological.
- **Final pick** = the last revision with `at` before `lockAt`, else the opening pick (`finalCall` in `lib/ledger.ts`). The Track record, the confidence bands, the Brier score and the market benchmark grade the final pick; the opening-pick record is shown next to it. A ledger with no revisions grades exactly as before.
- `status`: `"replaced"` (the opponent changed; `replacedBy` names the new pairing) or `"cancelled"` (the bout left the card), with `statusAt` and `statusNote`. The bout stays in the file and is not graded. The replacement pairing is a new bout with its own opening pick, `replaces` (the old pairing) and a `note` such as "Replacement opponent (short notice, 9 days)".
- `checks/validate-data.ts` errors when a revision is after the lock, out of order, or has no reason / engine / `changed`, and — comparing with git HEAD (the nightly's restore commit) — when an opening pick was edited, a frozen bout was removed, or an earlier revision was changed.

## Run logs (`data/runs/YYYY-MM-DD.json`)

```json
{ "date": "2026-09-28", "runs": [ {
  "kind": "nightly", "startedAt": "...", "finishedAt": "...", "status": "ok",
  "sourcePath": "webfetch",
  "checked": ["ufc332 lineup", "oktagon-94 results"], "changed": ["ufc332: Whitehead replaces X"],
  "failed": [{ "step": "portraits", "error": "Firecrawl 402" }],
  "notes": [], "errors": 0, "warnings": 41, "published": { "at": "...", "files": 3 } } ] }
```
- Written only through `node scripts/run-log.mjs …` (see NIGHTLY.md).
- `kind` is one of `nightly`, `live`, `weigh-in`, `sunday`, `friday`, `manual`.
- `status` is one of `running`, `ok`, `partial`, `failed`, `no-change`.
- Kept for 45 days. The log travels inside `source/bundle.json`, so an entry found in the restored bundle proves that publish succeeded.
- A night that publishes nothing keeps its log only in that session's report.

## Engine hooks (proposals for the model owner; not wired in)

Each hook should go through the backtest and be calibrated before it gets any weight. Until then, "shrink toward 50" (more uncertainty) is the safe default, not a directional lean.

| Signal | Field | Proposed use |
|---|---|---|
| Missed weight | `fightWeek.weighIn.*.missed/missedBy` | Winner: flag + confidence shrink; test a directional term once there are 30+ cases. Rounds: a bad cut is a cardio risk, so stack it with `cardio-fade`. |
| Short notice | `fightWeek.shortNotice.daysNotice` | ≤ 14 days: shrink confidence on the replacement side; ≤ 7 days: larger shrink. The rounds model could lean on cardio (late fade) for the replacement. |
| Division change | `fightWeek.divisionChange` | First fight at a new weight = extra uncertainty. Moving up: the size factor should use the opponent's natural frame. Moving down: cut risk. |
| Altitude | `event.venue.altitudeM` | ≥ 1,200 m: amplify `cardio-fade` tags and late-round fade in the rounds model. Fighters whose `base` is at altitude are exempt. |
| Cage size | `event.venue.cageFt` | 25 ft: slight lean toward pressure and wrestling styles and toward finishes (Under). Calibrate on APEX vs arena history in the ledgers and roster. |
| 5-round experience | `history[].scheduledRounds`, `round ≥ 4`, `five-round-proven` tag | In 5-round bouts: an edge for proven championship-round cardio vs none. Also feeds Over/Under 2.5. |
| Travel | `fighter.base.tz` vs `venue.tz` | ≥ 6 h shift (e.g. Americas → Abu Dhabi): small shrink. Low priority. |
| Market benchmark | `results.bouts[].closingOdds` | `lib/benchmark`: de-vig the closing odds and compare Brier and log-loss with our frozen confidence on the same bouts. Show "vs market" on the Track record. Never an input. |
| Scorecards | `results.bouts[].scorecards` | Reviews: auto-suggest `variance` for split or 29-28 losses. Rounds model: decision margins. |
| Result changes | `results.bouts[].change` | Scoring already treats `No contest` as ungraded; the row just has to be rewritten to the official result. |
| N/A picks | `forecast.bouts[].naReason` | `scripts/freeze.ts` writes the engine's `pendingReason` here when `pick` is null. |
