# Jango Playz

UFC, Contender Series, PFL and ACA fight predictions. Every bout gets a winner pick and a rounds over/under, frozen before the fight and scored afterwards. Odds are shown for reference only and never used by the model.

- **Live site:** GitHub Pages (Settings → Pages shows the address).
- **Stack:** Vite + React 19 + TypeScript + Tailwind 4. Fully static, with no server or database.
- **Deploys:** every push to `main` rebuilds and redeploys automatically (`.github/workflows/deploy.yml`).
- **Nightly refresh:** a scheduled Claude task runs at 2:30 a.m. Toronto time. It updates cards, results, reviews and rankings, freezes new picks, and pushes to this repo. See `docs/NIGHTLY.md`.

## Run locally
```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # ledger index + typecheck + data validation
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
| `docs/NIGHTLY.md` | Nightly refresh runbook |
