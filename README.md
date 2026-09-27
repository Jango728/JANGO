# Jango Playz

UFC, Contender Series, PFL and ACA fight predictions. Every bout gets a winner pick and a rounds over/under, frozen before the fight and scored afterwards. Odds are shown for reference only and never used by the model.

- **Live site:** https://jango728.github.io/JANGO/
- **Stack:** Vite + React 19 + TypeScript + Tailwind 4. Fully static, with no server or database.
- **Deploys:** every push to `main` rebuilds and redeploys automatically (`.github/workflows/deploy.yml`).
- **Nightly refresh:** `.github/workflows/nightly.yml` runs Claude Code at 2:30 a.m. Toronto time. It updates cards, results, reviews and rankings and freezes new picks, then the workflow checks, commits and redeploys. It needs the repo secret `CLAUDE_CODE_OAUTH_TOKEN`. See `docs/NIGHTLY.md`.

## Run locally
```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # ledger index + typecheck + data validation
npm run verify:restore   # simulate the nightly restore from a fresh source bundle
npx vite build     # static site in dist/
```

## Key files
| Path | What it is |
|---|---|
| `lib/seed.json` | Cards, fighters, histories |
| `lib/engine.ts` | Winner model (engine v1.0, four sub-models vote) |
| `lib/rounds.ts` | Rounds over/under model |
| `data/ledger/*.json` | Frozen picks, results, postmortems. **Never edit a frozen forecast.** |
| `lib/rankings.ts` | Champions page (UFC.com media rankings + Threat radar) |
| `public/films/` | Pre-rendered finish clips (`tracks.json` holds the name-tag tracking) |
| `render/` | The 3D film renderer (three.js), used only to make new clips |
| `docs/NIGHTLY.md` | Nightly refresh runbook (plus the fight-week and post-fight passes) |
| `docs/SCHEMA.md` | Optional fight-week / post-fight fields, run logs, proposed engine hooks |
| `checks/validate-data.ts` | Publish gate: errors block, staleness/completeness are warnings |
| `data/runs/*.json` | Machine-readable log of each automated run (`scripts/run-log.mjs`) |
