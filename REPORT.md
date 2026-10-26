# Centinela - build report

Written by the AI agent (Claude, via Claude Code) that built this,
2026-10-26, 17:34 UTC (11:34 Mexico City). The session started at 10:36 UTC
(04:36 Mexico) and had a long idle gap in the middle (resumed at 17:21 UTC) -
real working time was well under the elapsed wall-clock time. The prompt's
internal soft deadlines (10:00/10:30 Mexico = 16:00/16:30 UTC) had already
passed by the time active work resumed; the actual APEX submission window
(26-oct 07:00-15:00 Mexico = 13:00-21:00 UTC) was still open, so the agent
kept working in ship-fast mode rather than stopping.

## The one thing that needs you before this is submittable

**The GitHub repo was never created or pushed.** Every `gh repo create`
call this session made was blocked by this environment's own safety
classifier ("Create Public Surface" - creating a public-facing surface
needs explicit human approval; the agent correctly did not try to work
around it). Everything is committed locally and ready to go:

```bash
cd /home/vaiosvaios/centinela   # or wherever this checkout lives for you
gh api user --jq .login          # confirm it prints Eras256 first
gh repo create Eras256/centinela --public --source=. \
  --description "Read-only liquidation monitor for Writz (testnet). Warns borrowers before and after liquidation." \
  --remote=origin
git push -u origin main
```

After that push, two more things need a human (both blocked for the same
"needs explicit approval" reason, or for credentials this sandbox
legitimately should not handle):

1. **Enable GitHub Pages**, Settings -> Pages -> Source: "GitHub Actions"
   (the repo already has `.github/workflows/pages.yml` ready - it will
   build and deploy automatically on the next push to `web/**`, or run it
   once manually: `gh workflow run pages.yml`). The page will be at
   `https://eras256.github.io/centinela/`.
2. **Open Monse's issue** (she works from ~09:00 Mexico per the brief):
   ```bash
   gh issue create --repo Eras256/centinela \
     --title "Página por posición + simulador: pulir UX y textos en español" \
     --assignee M0nsxx \
     --body-file - <<'EOF'
   ## Alcance
   La vista por posición y el pulido de UX/copy/responsive del simulador, solo dentro de `web/`, vía PR a `main`.

   ## Contrato de datos
   `web/` lee `data/positions.json` (ver `web/src/types.ts` para los tipos exactos - `PositionRecord`/`ScanSummary`). Campos relevantes por posición: `txidDisplay`, `depositor`, `btcSatoshis` (string, sats), `usdcDebt` (string, stroops 7 decimales), `status` (`no-debt`/`healthy`/`cannot-borrow-more`/`warning`/`liquidatable`/`liquidated`/`closed`), `healthBp` (string o `"max"`), `healthDisplay`, `timelockHeight`, `tipHeight`, `blocksUntilLiquidationCutoff`, `timelockNear`, `pctDropToLiquidation`, `ntfyTopic`. La lógica del simulador ya vive en `web/src/sim.ts` (misma matemática que `src/thresholds.ts` en la raíz) - no necesitas tocar esa parte, solo la presentación.

   ## No toques
   El escáner (`src/`), los workflows de GitHub Actions, ni nada fuera de `web/`.
   EOF
   ```

Also, per the original brief: the originally-targeted deploy accounts were
mismatched or unavailable this session -
- `vercel whoami` returned `vaiosx01`, not the specified `diximan4-1243`.
  GitHub Pages is the substitute; if you want it on Vercel instead, switch
  accounts (`vercel login`) and run `vercel --prod` from `web/` (after
  `BASE_PATH=/ npm run build`, since Vercel serves from the root, not
  `/centinela/`).
- `fly auth whoami` had no stored login at all. `.github/workflows/scan.yml`
  (GitHub Actions cron, using only the repo's own `GITHUB_TOKEN`) is the
  substitute scheduler and is what actually ran and is documented as
  verified below. `worker/Dockerfile` + `worker/fly.toml` are ready if you
  want the original Fly design later - `fly launch -c worker/fly.toml` from
  the repo root, then set a GitHub PAT as a Fly secret for the worker to
  push with (left unset deliberately - see `worker/fly.toml`'s last
  comment).
- Telegram alerts were skipped entirely (spec marked this optional, "if
  there's time left," and it needs you to create a bot via BotFather -
  nothing to build without that).

## What's verified (I ran it, not just "should work")

- **36/36 unit tests pass** (`npm test`): txid byte-order handling (pinned
  against the actual documented example txid with an independent reference
  implementation, not just round-tripping the function under test),
  threshold classification matched to `writz-lend`'s *exact* `<`/`>=`
  contract comparisons (not the brief's rounded "≤" language - see the
  comment above `classifyStatus` in `src/thresholds.ts` for why 12,000bp
  exactly is "warning," not "liquidatable"), the i128::MAX no-debt case,
  the price-drop simulator math, and the diff/alert-once logic.
- **One real scan against live testnet**, twice (17:22:22 UTC and
  17:34:20 UTC), both with **zero warnings**: `writz-lend`
  (`CABF7VK7...SHZGG`) and `bitcoin-spv` (`CBX23YK...FVCW7W4EO`) both
  responded correctly to simulated reads. Real position found: txid
  [`eac0f95c...07e269`](https://mempool.space/signet/tx/eac0f95c531b4bd5307597f74bedd7379928539056b9a1467ea6d1159507e269)
  (display order), `6,000` satoshis, `0` USDC debt, contract status
  `Closed`, tip height `328,100` then `328,104`. The second run produced
  **zero state changes** (confirms the "no repeats" alert rule) and
  **reused the same ntfy topic** from the first run (confirms topic
  persistence via `data/topics.json`).
- **getEvents discovery ran without error** against `writz-lend`'s
  `deposit` topic (paginated, per the brief's note about needing cursor
  pagination) and found no txids beyond the documented seed - consistent
  with the brief's own note that the pool had very few positions on
  2026-10-26.
- **One real TEST ntfy alert, independently confirmed delivered** - not
  just "the HTTP POST didn't throw." Sent via
  `node dist/cli.js --test-alert centinela-testnet-verify-1793036036`,
  then confirmed by polling ntfy's own REST API
  (`curl https://ntfy.sh/centinela-testnet-verify-1793036036/json?poll=1`),
  which returned the exact message back: `"title":"[TEST] Centinela
  testnet alert"`, `"tags":["test_tube"]`.
- **The web page, built and verified with a real headless Chromium**, not
  just `tsc`/`vite build` succeeding:
  - Chromium wouldn't launch at first (`libnspr4.so` missing, no root in
    this sandbox) - fixed by `apt-get download`-ing the missing `.deb`s
    without installing them and pointing `LD_LIBRARY_PATH` at the
    extracted `.so`s (a documented recipe from a prior project in this
    account's skill library).
  - Loaded the real built page, confirmed the live position renders
    (txid, depositor, BTC amount, health, status pill, correct ntfy
    subscribe button), confirmed the language toggle actually swaps
    content (ES default per the brief, EN works), confirmed the simulator
    slider updates its result live.
  - Found and fixed a real bug this way: the page had horizontal overflow
    at 375px width, traced to long unbroken monospace strings (contract
    IDs) with no wrap opportunity. Fixed with `overflow-wrap`/`word-break`
    rules; re-verified **zero horizontal overflow at all four required
    widths (320/375/768/1440px)** via a script measuring
    `document.documentElement.scrollWidth` at each.
  - Screenshotted both a mobile (375px) and desktop (1440px) render for a
    visual sanity check - both look like a real product page, not a
    scaffold.

## What was NOT verified (be skeptical of these until you check)

- **Nothing was ever pushed to GitHub** - see the top of this report. No
  public repo, no GitHub Pages deploy, no Actions run, because the repo
  doesn't exist yet. `.github/workflows/scan.yml` has never actually run
  on a schedule; its logic was exercised locally (`node dist/cli.js`
  directly) but the workflow YAML itself - checkout, `npm ci` in CI,
  commit-and-push-if-changed - has not been test-run by GitHub Actions.
- **The `writz-lend` 18:37 UTC switch** had not yet happened as of the
  last scan (17:34 UTC, ~1 hour before). The switch-handling code
  (`src/network.ts`: env override + `isPastDocumentedSwitch` warning) is
  unit-tested but has never actually run past the switch time against the
  real new contract (`CDKXFBHU...O5VBG`). If you're reading this after
  18:37 UTC and a scan starts erroring, that's the first thing to check -
  set `WRITZ_LEND_CONTRACT_ID=CDKXFBHUBIEUD2OXBSB44RJYZ2KM6NIPJF2EFVVA3UCACWJETN4O5VBG`.
- **Discovery beyond the one seed position is unproven.** Both live scans
  found exactly one position (the documented seed). The `getEvents`
  pagination logic never actually had a second page to paginate through,
  so that code path (the part of `discoverPositions` the brief specifically
  flagged as needing care) is only unit-tested with synthetic data, not
  proven against a real multi-page response.
- **The Fly worker design (`worker/`) is unbuilt and undeployed** - not
  even `docker build` was run against it. Treat it as a design sketch
  ready for a human to pick up, not working code.
- **No position in "warning" or "liquidatable" state was ever observed**,
  live or simulated-as-real - matches the brief's own note that the pool
  had very few positions, mostly healthy. The simulator (health-math only,
  no real transaction) is the only way this project demonstrates the
  "before liquidation" half of its value proposition right now.

## Commits (local, not yet pushed - see above)

```
8a295ca Refresh verified live scan snapshot
c1e7ec5 Add status page, GitHub Pages/Actions scheduler, and Fly worker fallback
ab3be91 Centinela: scanner + classifier + alerts for Writz liquidation monitoring
```

All three by `Giovanny Amador <219895655+Eras256@users.noreply.github.com>`
(local repo config only, confirmed with `git config --get user.name` /
`user.email` before the first commit - never `--global`).

## Contract IDs used

| Contract | ID | Source |
|---|---|---|
| `writz-lend` | `CABF7VK7F25ZGDLV6EWSAU3NYQYKDQNDSJIISDMDZAUASMSXUADSHZGG` | `@writz/sdk@0.1.2`'s generated testnet preset, read at runtime by `src/network.ts` - never hardcoded in logic |
| `bitcoin-spv` | `CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO` | same |

Switch handling: see "What was NOT verified" above and `README.md`
"Handling the 2026-10-26 18:37 UTC `writz-lend` switch."

## URLs

- Repo: **not yet live** - `github.com/Eras256/centinela` once you run the
  command at the top of this report.
- Page: **not yet live** - `eras256.github.io/centinela` once GitHub Pages
  is enabled (see above).
- Writz (for reference, not ours): `writz.xyz`,
  `github.com/WritzProtocol/writz`.
