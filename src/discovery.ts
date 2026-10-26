/**
 * Position discovery. Writz's relayer has no "list all positions" endpoint
 * (checked: `relayer/src/routes/*.ts` only exposes per-txid routes -
 * `/deposit-status/:txid`, `/spv-proof/:txid`, `/timeline/:btcTxid`), and a
 * first `getEvents` pass with no topic filter returned zero events over a
 * ~2 day range. So: query Soroban RPC `getEvents` filtered to `writz-lend`'s
 * `deposit` topic, paginating with the response cursor, and always include
 * the one documented example txid as a floor - so a flaky or
 * retention-expired events backend never leaves the scanner with nothing.
 */
import { rpc, nativeToScVal, scValToNative, type xdr } from "@stellar/stellar-sdk";
import { bytesToHex } from "@writz/sdk";

/**
 * The first deposit on the current (2026-10-25) `writz-lend`/`bitcoin-spv`
 * pair, display order, from `contracts/deployments/testnet.md`:
 * https://mempool.space/signet/tx/eac0f95c531b4bd5307597f74bedd7379928539056b9a1467ea6d1159507e269
 * Documented as "the example transaction in the developer docs" - a
 * reasonable floor for discovery, not a claim that it is still open.
 */
export const SEED_TXID_DISPLAY = "eac0f95c531b4bd5307597f74bedd7379928539056b9a1467ea6d1159507e269";

const DEPOSIT_TOPIC = nativeToScVal("deposit", { type: "symbol" }).toXDR("base64");

export interface DiscoveryResult {
  /** Internal byte order (contract order), deduplicated. */
  txids: string[];
  /** How each txid was found. */
  sources: Record<string, "event" | "seed">;
  eventsScanned: number;
  warnings: string[];
}

export interface DiscoveryOptions {
  server: rpc.Server;
  writzLendContractId: string;
  /** How far back to look on the first attempt, in ledgers. Default ~6 days (17,280 ledgers/day). */
  lookbackLedgers?: number;
  /** Safety cap on getEvents pages, so a pagination bug can't loop forever. */
  maxPages?: number;
}

const LEDGERS_PER_DAY = 17_280;

export async function discoverPositions(opts: DiscoveryOptions): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  const sources: Record<string, "event" | "seed"> = {};
  const found = new Set<string>();
  let eventsScanned = 0;

  const seedInternal = reverseDisplayToInternal(SEED_TXID_DISPLAY);
  found.add(seedInternal);
  sources[seedInternal] = "seed";

  const latest = await opts.server.getLatestLedger().catch((err) => {
    warnings.push(`getLatestLedger failed: ${String(err)}`);
    return null;
  });

  if (latest) {
    const lookback = opts.lookbackLedgers ?? LEDGERS_PER_DAY * 6;
    const attempts = [lookback, LEDGERS_PER_DAY * 2, LEDGERS_PER_DAY, 1_000];
    let lastError: unknown = null;
    for (const window of attempts) {
      const startLedger = Math.max(1, latest.sequence - window);
      try {
        const pageWarnings = await scanDepositEvents({
          server: opts.server,
          contractId: opts.writzLendContractId,
          startLedger,
          maxPages: opts.maxPages ?? 20,
          onEvent: (txidInternal) => {
            eventsScanned++;
            found.add(txidInternal);
            if (!sources[txidInternal]) sources[txidInternal] = "event";
          },
        });
        warnings.push(...pageWarnings);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        continue;
      }
    }
    if (lastError) {
      warnings.push(
        `getEvents failed at every lookback window tried; falling back to the seed txid only. Last error: ${String(lastError)}`,
      );
    }
  }

  return { txids: [...found], sources, eventsScanned, warnings };
}

async function scanDepositEvents(args: {
  server: rpc.Server;
  contractId: string;
  startLedger: number;
  maxPages: number;
  onEvent: (txidInternal: string) => void;
}): Promise<string[]> {
  const warnings: string[] = [];
  let cursor: string | undefined;
  let pages = 0;

  while (pages < args.maxPages) {
    pages++;
    const request = cursor
      ? {
          filters: [{ type: "contract" as const, contractIds: [args.contractId], topics: [[DEPOSIT_TOPIC]] }],
          cursor,
          limit: 100,
        }
      : {
          filters: [{ type: "contract" as const, contractIds: [args.contractId], topics: [[DEPOSIT_TOPIC]] }],
          startLedger: args.startLedger,
          limit: 100,
        };

    const res = await args.server.getEvents(request);

    for (const event of res.events) {
      const topic1 = event.topic[1];
      if (!topic1) {
        warnings.push(`deposit event ${event.id} had no second topic (expected txid); skipped`);
        continue;
      }
      try {
        const txidBytes = scValToNative(topic1) as Uint8Array;
        args.onEvent(bytesToHex(txidBytes));
      } catch (err) {
        warnings.push(`deposit event ${event.id} topic decode failed: ${String(err)}`);
      }
    }

    if (res.events.length === 0 || !res.cursor || res.cursor === cursor) break;
    cursor = res.cursor;
  }

  return warnings;
}

function reverseDisplayToInternal(displayHex: string): string {
  const bytes = Buffer.from(displayHex, "hex");
  return Buffer.from(bytes.reverse()).toString("hex");
}

// Re-exported for the XDR type used in filters above, kept explicit for readability at call sites.
export type { xdr };
