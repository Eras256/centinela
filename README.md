# Centinela

A read-only liquidation monitor for [Writz](https://writz.xyz) (testnet). It
watches BTC-collateralized USDC loans on Writz's `writz-lend` Soroban
contract and warns borrowers **before** they get liquidated and **after**,
if it happens. It never signs, moves, or holds funds.

Built during the Pura Vida Ideathon (Genesis track), 2026-10-26.

## The problem

Writz lets you lock native BTC on Bitcoin and borrow USDC on Stellar. If a
position's health drops below the liquidation threshold, a keeper repays the
debt and takes the BTC. Writz's own UX spec says this plainly
([`docs/design/liquidation-notification-spec.md`](https://github.com/WritzProtocol/writz/blob/main/docs/design/liquidation-notification-spec.md)
in `github.com/WritzProtocol/writz`):

> "Today, if a position is liquidated, the owner finds out only by noticing
> their BTC is gone - no notification, no explanation, no visible status
> change." Status: "Detection mechanism not yet implemented."

There is also no warning **before** liquidation today. Centinela closes both
gaps: it scans positions on a schedule, classifies their health, and pushes a
push notification the moment the status changes - before the position
becomes liquidatable, and after, if it's too late.

Centinela is **not affiliated with Writz**. It is built on Writz's public
testnet contracts and documentation, nothing more.

## How it works

```
                 every ~5 min
   ┌─────────────┐   discover   ┌──────────────────┐
   │  Scheduler   │ ───────────▶│  Soroban RPC      │
   │ (GH Actions  │             │  getEvents        │
   │  cron / Fly) │             │  ("deposit" topic)│
   └──────┬───────┘             └─────────┬─────────┘
          │                               │ txids
          ▼                               ▼
   ┌─────────────────────────────────────────────┐
   │  scanner (Node/TS, @stellar/stellar-sdk,     │
   │  @writz/sdk)                                 │
   │   - get_position(txid)                       │
   │   - get_health_ratio_bp(txid)                │
   │   - bitcoin-spv get_best_tip()                │
   │   - classify: no-debt / healthy /             │
   │     cannot-borrow-more / warning /            │
   │     liquidatable / liquidated / closed        │
   └──────────────────┬────────────────────────────┘
                       │ writes
                       ▼
       data/positions.json, data/history.json
                       │
          git commit + push to this repo
                       │
                       ▼
       ┌───────────────────────────────┐        state change?
       │  web/ (static page, Vite)     │◀───┐    push via
       │  fetches the JSON straight    │    └─── ntfy.sh topic
       │  from raw.githubusercontent   │         per position
       └───────────────────────────────┘
```

The page is **static** - it reads `data/positions.json` from
`raw.githubusercontent.com`, it never imports `@stellar/stellar-sdk` into a
serverless function (that failed with `ERR_REQUIRE_ESM` on Vercel the night
before this build), and it never talks to the chain itself.

## Stellar primitives used

- **Soroban contracts (read-only, simulated calls only, no signing):**
  `writz-lend.get_position`, `writz-lend.get_health_ratio_bp`,
  `bitcoin-spv.get_best_tip`. Every read is a `simulateTransaction` from a
  throwaway, unfunded account (`@writz/sdk`'s `ContractCaller.read`) - no
  Stellar account, secret key, or signature is ever needed by Centinela.
- **Soroban RPC `getEvents`**, filtered to the `deposit` topic, paginated by
  cursor, to discover position txids (see "Position discovery" below).
- **Stellar accounts** only appear as *data* (a position's `depositor`
  address) - Centinela never creates, funds, or signs for one.

Without these - specifically `get_position` and `get_health_ratio_bp` being
free, unauthenticated simulated reads - this project would not be possible
as a side service: there is nothing to "integrate" with on a chain that
required a transaction (and a fee, and a key) just to check a number.

## Setup

```bash
npm install
npm run build
npm test            # 36 unit tests: thresholds, byte order, alerts, diffing
npm run scan        # one scan against testnet, writes data/*.json
node dist/cli.js --test-alert <your-ntfy-topic>   # sends one labeled TEST push
```

Environment variables (all optional - see `.env.example`):

| Variable | Purpose |
|---|---|
| `WRITZ_LEND_CONTRACT_ID` | Override the `writz-lend` contract ID (see the 18:37 UTC switch below) |
| `BITCOIN_SPV_CONTRACT_ID` | Override the `bitcoin-spv` contract ID |
| `CENTINELA_DATA_DIR` | Where `positions.json`/`history.json`/`topics.json` are written (default `./data`) |

### Handling the 2026-10-26 18:37 UTC `writz-lend` switch

`contracts/deployments/testnet.md` in Writz's repo documents a new
`writz-lend` instance (`CDKXFBHU...O5VBG`) deployed but **not yet active**,
switching over at 2026-10-26 18:37 UTC. Centinela never hardcodes a single
contract ID in its logic (`src/network.ts`):

1. By default it reads the ID from `@writz/sdk`'s generated `testnet` preset
   (itself generated from Writz's own deployment record).
2. `WRITZ_LEND_CONTRACT_ID` / `BITCOIN_SPV_CONTRACT_ID` env vars override it
   without a code change.
3. `isPastDocumentedSwitch()` checks the wall clock against the documented
   switch time and logs an explicit warning (surfaced in
   `data/positions.json`'s `warnings` array) if the clock is past it and no
   override is set, naming the known fallback ID to set.

This project's own scans ran before 18:37 UTC on the pre-switch contract
(`CABF7VK7...SHZGG`). If you run this after the switch and reads start
failing, set `WRITZ_LEND_CONTRACT_ID=CDKXFBHUBIEUD2OXBSB44RJYZ2KM6NIPJF2EFVVA3UCACWJETN4O5VBG`.

### Position discovery

Writz's relayer (`api.testnet.writz.xyz`) has no "list all positions"
endpoint - checked directly against its route source
(`relayer/src/routes/*.ts`): every route takes a specific `txid`. So
Centinela discovers positions by querying Soroban RPC `getEvents`, filtered
to `writz-lend`'s `deposit` topic, paginating with the response cursor
(`src/discovery.ts`). As a floor against a flaky or retention-expired events
backend, it always also includes the one example txid documented in Writz's
own deployment record
([`eac0f95c...07e269`](https://mempool.space/signet/tx/eac0f95c531b4bd5307597f74bedd7379928539056b9a1467ea6d1159507e269)).

**The txid byte-order gotcha:** `writz-lend` expects txids in *internal*
(contract) byte order - the reverse of what every Bitcoin explorer shows.
Confirmed by hand: calling `get_position` with the display-order txid above
fails with `Error(Contract, #8)` (`PositionNotFound`); reversing the bytes
first returns the real position. `src/txid-byteorder.test.ts` pins this
against the documented example.

## What was built during the event (2026-10-26)

- `src/thresholds.ts` - status classification (`no-debt` / `healthy` /
  `cannot-borrow-more` / `warning` / `liquidatable` / `liquidated` /
  `closed`), matched to the *exact* comparisons `writz-lend`'s `borrow` and
  `liquidate` use (not just the rounded "≤" language of a spec) - see the
  comment above `classifyStatus` for the boundary reasoning - plus the
  "¿A qué precio me liquidan?" simulator math.
- `src/discovery.ts` - position discovery via `getEvents` + documented seed.
- `src/network.ts` - contract-ID wiring with the 18:37 UTC switch handling.
- `src/scanner.ts` / `src/cli.ts` - the scan loop: read, classify, diff
  against the last run, alert on change, persist.
- `src/alerts.ts` - ntfy.sh alert composition and per-position topic
  generation, state-change-only ("no repeats").
- 36 unit tests (`npm test`): txid byte order, health/threshold math
  including the i128::MAX no-debt case, the simulator, and the
  diff-and-alert-once logic.
- `web/` - the static status page (Spanish-first, English toggle), the
  liquidation simulator, the subscribe-to-alerts box, the liquidation log,
  FAQ, and honest-limits section.
- `.github/workflows/scan.yml` - the scheduled scanner (see "Honest limits"
  for why this replaced the originally-planned Fly worker).
- One verified live scan against testnet (see below) and one delivered TEST
  ntfy alert.

## Verified facts (checked 2026-10-26, re-verify before relying on them)

- `writz-lend` testnet contract: `CABF7VK7F25ZGDLV6EWSAU3NYQYKDQNDSJIISDMDZAUASMSXUADSHZGG`
  (active at the time of this build; switches 2026-10-26 18:37 UTC - see above).
- `bitcoin-spv` testnet contract: `CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO`.
- Thresholds, read from `contracts/contracts/writz-lend/src/{lib,oracle}.rs`
  on Writz's `main` branch: `min_collateral_ratio_bp = 15_000` (150%),
  `liquidation_threshold_bp = 12_000` (120%), `liquidation_bonus_bp = 1_000`
  (10%), `LIQUIDATION_CUTOFF_BLOCKS = 288`.
  `health_ratio_bp = collateral_stroops * 10_000 / debt_stroops`, returning
  `i128::MAX` when debt is zero.
- One real position read live from testnet:
  txid [`eac0f95c...07e269`](https://mempool.space/signet/tx/eac0f95c531b4bd5307597f74bedd7379928539056b9a1467ea6d1159507e269)
  (display order) - `6,000` satoshis, `0` USDC debt, status `Closed` (fully
  repaid and released already). `bitcoin-spv` best tip at scan time:
  height `328,100`.
- `getEvents` on `writz-lend`'s `deposit` topic found no txids beyond this
  seed at scan time - consistent with the documented pool size (1,000 USDC
  supplied, 3 USDC borrowed on 2026-10-26).

## Honest limits

- **Testnet only.** Bitcoin Signet + Stellar testnet. Nothing here touches
  mainnet or real funds.
- **Few positions.** At the time of this build, the pool had very few
  positions, most or all healthy. The liquidation simulator exists
  specifically so the "before liquidation" half of the product is
  demonstrable even when no real position is near trouble - **it is clearly
  labeled a simulation and never fakes a real alert or a real liquidation.**
- **No absolute USD liquidation price.** Writz prices collateral via the
  Reflector SEP-40 oracle (`CCYOZJ...`, the "external CEXs & DEXs" instance,
  14 decimals). Centinela does not read it directly - health scales linearly
  with price, so the simulator computes "% BTC price drop to liquidation"
  from the health ratio alone, with no need for (and no invented) absolute
  price. The page states this plainly rather than showing a number we
  didn't verify.
- **ntfy.sh topics are unguessable but public by design.** Anyone who knows
  a position's topic string can subscribe to its alerts (that's the point -
  no signup, no custody of a phone number). Topics are long random strings,
  not sequential IDs, but ntfy itself has no access control on free topics.
- **Fly worker became a GitHub Actions cron job.** The original plan was a
  small always-on Fly app polling every 5 minutes. This session's `fly`
  CLI had no stored login (`fly auth whoami` returned "no access token
  available") and this sandbox would not let the agent read or export a
  token to work around that, so the scheduler shipped instead as
  `.github/workflows/scan.yml`, a cron job on this same repo, using only the
  already-correctly-authenticated `gh` account. It is a direct substitute -
  same scan code, same ~5-minute-scale cadence (GitHub Actions cron has its
  own scheduling slack) - not a scope cut. The Fly `Dockerfile`/`fly.toml`
  are still included in `worker/` for whoever wants to run the original
  design; see `REPORT.md` for exactly what would need to happen to switch to it.
- **The status page's live deploy target changed for the same kind of
  reason.** `vercel whoami` returned an account (`vaiosx01`) other than the
  one specified for this build (`diximan4-1243`), and the build instructions
  are explicit: stop rather than deploy under the wrong account. GitHub
  Pages, served from this same correctly-authenticated repo, is the
  substitute; see `REPORT.md`.
- **Not financial advice.** Centinela only observes and notifies. It never
  signs, moves, or custodies funds, and a notification is not a guarantee -
  always check the position yourself before acting on an alert.

## AI tooling note

This project - code, tests, docs, and the pieces of the deploy pipeline this
session could actually authenticate for - was built by an AI coding agent
(Claude, via Claude Code) working from a prepared brief, during the event
window, with the human author asleep for the first part of the session. See
`REPORT.md` for exactly what was and wasn't independently verified, and what
still needs the human.

## License

MIT, see `LICENSE`.
