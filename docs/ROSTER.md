# UFC roster dataset

`public/roster/roster.json` gives every fighter with at least one UFC bout on or after **2021-01-01** a full profile: tale of the tape, full UFC history (any year), career striking/grappling aggregates, and a per-fight stat line on every history row. `public/roster/names.json` is the small search index. `public/roster/rounds.json` keeps the round-by-round stat lines for every roster bout (engine v1.3, see below).

Built by `scripts/build-roster.py`. Current build: **1,211 fighters**, 10,104 history rows, data as of **2026-09-19** (UFC 331). 4.6 MB (single file; the script splits into `roster-N.json` + `roster-index.json` automatically above 6 MB).

## Rebuild

```bash
python3 scripts/build-roster.py            # downloads fresh CSVs to /tmp/jango-roster-cache, rebuilds
python3 scripts/build-roster.py --offline  # reuse the cached CSVs
npx tsx scripts/build-stats-timeline.ts    # then: engine timelines for seed fighters + auto-scouting
```

Standard library only (no pandas needed). Deterministic: the same input gives byte-identical output. It prints diagnostics to stderr: unresolved names, fuzzy matches, rejected tale-of-tape rows, every duplicate-name decision, seed merges and field coverage. It fails if two fighters get the same slug.

## Sources

| Source | Used for |
|---|---|
| [Greco1899/scrape_ufc_stats](https://github.com/Greco1899/scrape_ufc_stats) (UFCStats mirror, refreshed daily): `ufc_event_details`, `ufc_fight_results`, `ufc_fight_stats`, `ufc_fighter_details`, `ufc_fighter_tott` | Everything by default: identity, nickname, DOB, height, reach, stance, bouts, methods, per-round stats |
| `lib/seed.json` (this project's verified profiles, Sherdog/UFC.com sourced) | `country`, `proRecord`, plus height/reach/stance/DOB only where UFCStats is blank. Merged only when the normalized name matches exactly one roster fighter **and** at least one UFC bout date agrees (163 fighters). |

I looked for other public GitHub datasets with full pro records and nationality and found none current enough to use. Sherdog, Tapology, Wikipedia and UFC.com can't be reached from the build environment.

## Field coverage (all 1,211 / the 761 who fought in 2025–26)

| Field | All | Fought 2025+ |
|---|---|---|
| name, slug, ufcstatsId, weightClass, ufcRecord, lastFight, history, stats | 100% | 100% |
| dob | 99.5% | 99.2% |
| stance | 95.2% | 92.4% |
| heightIn | 94.9% | 91.9% |
| reachIn | 94.7% | 91.6% |
| nickname | 71.3% | 71.1% (UFCStats lists none for the rest) |
| country | 13.5% | 20.4% |
| proRecord | 13.5% | 20.4% |

## Field notes

- **slug**: ASCII, lowercase, hyphens, with apostrophes and periods removed. When two roster fighters share a name, the one with the earlier UFC debut keeps the plain slug and later namesakes get `-2`, `-3`. This keeps slugs stable when a new namesake arrives. Today there is one pair: `bruno-silva` (Flyweight "Bulldog", ufcstats 294aa73dbf37d281) and `bruno-silva-2` (Middleweight "Blindado", 12ebd7d157e91701).
- **name**: the spelling on the fighter's most recent UFCStats bout, e.g. "Waldo Cortes Acosta" or "Patricio Pitbull".
- **weightClass**: the class of the most recent UFC bout, skipping catchweight/openweight bouts when an earlier bout has a real division.
- **ufcRecord**: `W-L-D`, with ` (n NC)` added only when n > 0. It is computed from UFCStats bouts, so it covers UFC and UFC-sanctioned bouts listed there (TUF finales, Road to UFC semifinals). DWCS is not included.
- **proRecord**: the seed profile's record, plus any UFC results dated after the newest bout the seed knows about. For example, UFC 331 results are added to 24 fighters. It is null when the fighter isn't in the seed.
- **history[]**: newest first, with `date, event, opponent, opponentSlug, result, method, round, time, weightClass, title, fightId, s`.
  - `opponentSlug` is null when the opponent has no fight since 2021. 82% of rows link, and every link is reciprocal.
  - `title` is true only for UFC championship bouts (undisputed, interim, superfight). TUF and Road to UFC tournament finals are false.
  - `method` is condensed from UFCStats detail, e.g. `KO/TKO (Punches)`, `KO/TKO (Kick to Body)`, `KO/TKO (Injury)`, `KO/TKO (Doctor Stoppage)`, `Submission (Rear-Naked Choke)`, `Decision (Split)`, `DQ`, `Overturned`, `Could Not Continue`.
  - `bonus` is omitted because UFCStats CSVs don't carry bonuses.
- **history[].s** holds per-fight totals, summed over rounds, so stats can be computed "as of" any date:
  - `sl`/`sa`: significant strikes landed/attempted by the fighter; `osl`/`osa`: the same for the opponent.
  - `tdl`/`tda`: takedowns landed/attempted; `otdl`/`otda`: the opponent's.
  - `sub`/`osub`: submission attempts; `kd`/`okd`: knockdowns.
  - `ctrl`/`octrl`: control time in seconds; `sec`: fight duration in seconds, computed from the time format.
- **stats** are career aggregates over all UFC bouts with stat lines, using UFCStats formulas:
  - `slpm`, `sapm`: significant strikes landed/absorbed per minute.
  - `strAcc` = sl/sa; `strDef` = 1 − osl/osa.
  - `tdPer15`; `tdAcc`; `tdDef` = 1 − otdl/otda.
  - `subPer15`, `kdPer15`, `ctrlPer15` (seconds of control per 15 minutes), `minutes`, `fights`.
  - Percentages are whole numbers. A ratio is null when its denominator is 0.
- `names.json` rows are `[slug, name, nickname|null, weightClass, lastFightYear, ufcRecord]`. It is bundled into the JS (lib/roster.ts) for instant search and links; `roster.json` is fetched on demand.

## Round-by-round data (engine v1.3)

`public/roster/rounds.json` (~1.05 MB raw, ~360 KB gzipped; not bundled, fetched by nothing at runtime today) holds one entry per roster bout where both corners have a line for every round (all 5,978 today):

```
{ asOf, source, fields: ["kd","sigL","sigA","headL","groundL","totL","tdL","tdA","subAtt","rev","ctrlSec"],
  fights: { <fightId>: [<slug of the first side>, [[R1 line], [R2 line], …], [[R1 line], …]] } }
```

The first rounds list belongs to the slug in position 0; the second to the opponent (who may not be a roster fighter). `roster.json` is unchanged and stays per-fight totals only.

`scripts/build-stats-timeline.ts` turns it into:

- `lib/round-timeline.json` (bundled, ~100 KB raw / ~24 KB gzipped): one summary row per UFC bout for every seed fighter matched to the roster, compact `fields` subset of `ROW` in `lib/round-features.ts` (round-1 vs rounds-3+ output, knockdowns scored/suffered by round, knockdowns survived, takedowns absorbed round 1 vs later, control suffered, round-1 sub attempts, KO losses). The engine computes shrunk "as of" features from bouts strictly before each card (`roundFormAsOf`).
- `data/scouting-auto.json`: machine-generated scouting tags (`source: "ufcstats-rounds"`: cardio-fade, chin-concern, durable, td-vulnerable, power) with the evidence behind each. Suggestions only. They are never written into `data/scouting.json`, the engine does not read them (backtest: no out-of-sample gain), and a human note on the same trait always takes precedence wherever both are shown.

Backtests (`scripts/backtest-data.ts`) build the same summary rows for every roster fighter straight from `rounds.json`. The feature study is `npx tsx scripts/backtest-rounds.ts`.

## Photos

`scripts/pack-roster-photos.py` packs the transparent portraits (`/home/claude/roster-photos/<slug>.webp` + `manifest.json`) into `public/roster/photos-<n>.json` chunks (`{slug: data URI}`, ~500–950 KB each; chunk = FNV-1a(slug) mod N), `photos-thumbs.json` (60 px square head crops for search) and `photos-index.json` (`{chunks, fighters: {slug: [chunk, "f"|"h"]}}`). The site loads a chunk only when one of its photos is needed. Seed portraits (`public/fighters/*.webp`) take priority. Re-run the script after adding photos.

## Identity resolution

UFCStats bout rows list names, not fighter IDs, so names are mapped to IDs in this order:

1. exact fighter-page name
2. tale-of-tape name
3. accent-, punctuation- and suffix-insensitive key ("Kai Kamaka" = "Kai Kamaka III")
4. token-sorted key ("Meng Bo" = "Bo Meng")
5. the `ALIASES` table (one entry: "Rafael Cerquiera")
6. a unique fuzzy match at ≥ 0.90

In the current data every bout name resolves.

When a name has more than one UFCStats ID (Bruno Silva, Jean Silva, Mike Davis, Victor Valenzuela, Joey Gomez, Michael McDonald), the bout goes to the candidate whose listed weight is closest to the division limit, with an age penalty outside 21–38. Every decision is printed. If one is ever wrong, add a line to `PINS` in the script.

Four UFCStats tale-of-tape rows carry another person's data, and the script ignores them: Tyrell Fortune (row shows Regina Malpica), Tina Black (Valesca Machado), and the swapped Jose Montanha / Henrique Da Silva Lopes pair. Those fighters get null measurements unless the seed has them.

## Known gaps

- **Country and pro record are only 13.5% covered.** Only fighters in the seed have them. Filling the rest needs a source the build can reach, such as a Wikipedia "List of current UFC fighters" snapshot or UFCStats fighter-list W/L/D columns committed to a GitHub repo. The merge code in `build-roster.py` already handles it; add another block next to the seed merge.
- **The UFC event on 2026-09-26 isn't in the upstream CSVs yet.** Re-run the script once the Greco1899 mirror updates. `asOf` reports the newest event in the data.
- `UFC - Road to UFC 4.6` (two bouts) has no row in the upstream event list. Its date is hard-coded to 2025-08-22 in `EVENT_DATES`.
- There are no bonuses and no DWCS bouts. `nickname` is null where UFCStats has none.
- The scope includes released and retired fighters whose last UFC bout was in 2021 or later. There is no "active" flag.
