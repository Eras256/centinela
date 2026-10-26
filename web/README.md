# Centinela - web/

Static status page (Vite + vanilla TypeScript, no framework). No
`@stellar/stellar-sdk` import anywhere in this directory on purpose: it
failed with `ERR_REQUIRE_ESM` in a Vercel serverless function the night
before this build, so the page stays static and reads already-computed
JSON instead of talking to the chain itself.

## Data source

`src/main.ts` fetches `positions.json` / `history.json` from
`raw.githubusercontent.com/Eras256/centinela/main/data/`, with a same-origin
fallback to `public/data/*.json` (a bundled snapshot, copied from the root
project's `data/` at build time - see the root `README.md`) if that fetch
fails (offline dev, or before the repo exists on GitHub).

## Commands

```bash
npm install
npm run dev      # local dev server
npm run build    # -> dist/, deployed by .github/workflows/pages.yml
```

`vite.config.ts` sets `base: "/centinela/"` for GitHub Pages project-page
hosting; override with `BASE_PATH=/ npm run build` for a host that serves
from the root (e.g. Vercel, once that account is sorted out - see the root
`REPORT.md`).
