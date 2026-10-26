#!/usr/bin/env node
/**
 * Entry point for one scan: discover positions, read each one, classify,
 * persist `data/positions.json` + `data/history.json` + `data/topics.json`,
 * and fire ntfy alerts for any position whose status changed since the
 * last run. Designed to run every ~5 minutes from a scheduler (Fly worker
 * or the GitHub Actions cron fallback - see README).
 *
 * `node dist/cli.js --test-alert <topic>` sends a single labeled TEST ntfy
 * message and exits, for manually verifying alert delivery end to end.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rpc } from "@stellar/stellar-sdk";
import { createWritzClient } from "@writz/sdk";
import { loadNetwork, isPastDocumentedSwitch, WRITZ_LEND_PENDING_SWITCH } from "./network.js";
import { discoverPositions } from "./discovery.js";
import { scanOnePosition, diffForHistory } from "./scanner.js";
import { HttpNtfySender, buildStateChangeMessage, buildTestMessage, shouldAlert, type AlertStatus } from "./alerts.js";
import type { PositionRecord, ScanSummary, HistoryEntry } from "./types.js";
import type { PositionStatus } from "./thresholds.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.CENTINELA_DATA_DIR ?? path.resolve(__dirname, "..", "data");
const POSITIONS_PATH = path.join(DATA_DIR, "positions.json");
const HISTORY_PATH = path.join(DATA_DIR, "history.json");
const TOPICS_PATH = path.join(DATA_DIR, "topics.json");

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--test-alert") {
    const topic = args[1];
    if (!topic) {
      console.error("usage: cli.js --test-alert <ntfy-topic>");
      process.exitCode = 1;
      return;
    }
    await new HttpNtfySender().send(buildTestMessage(topic));
    console.log(`TEST alert sent to ntfy.sh/${topic}`);
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });

  const network = loadNetwork();
  const hasOverride = Boolean(process.env.WRITZ_LEND_CONTRACT_ID);
  const warnings: string[] = [];
  if (isPastDocumentedSwitch(new Date(), hasOverride)) {
    warnings.push(
      `Current time is past the documented writz-lend switch (${WRITZ_LEND_PENDING_SWITCH.switchAtUtc}) ` +
        `and no WRITZ_LEND_CONTRACT_ID override is set. Using the configured ID (${network.contracts.writzLend}); ` +
        `if reads start failing, set WRITZ_LEND_CONTRACT_ID=${WRITZ_LEND_PENDING_SWITCH.contractId} and rerun.`,
    );
  }

  const server = new rpc.Server(network.rpcUrl);
  const client = createWritzClient({ network, server });

  const bestTip = await client.spv.getBestTip();
  const tipHeight = bestTip?.height ?? 0;
  if (!bestTip) warnings.push("bitcoin-spv has no checkpoint/tip yet; timelock math will be unreliable.");

  const discovery = await discoverPositions({ server, writzLendContractId: network.contracts.writzLend });
  warnings.push(...discovery.warnings);

  const existingTopics = await readJson<Record<string, string>>(TOPICS_PATH, {});
  const previousSnapshot = await readJson<ScanSummary | null>(POSITIONS_PATH, null);
  const previousStatusByTxid = new Map<string, PositionStatus>(
    (previousSnapshot?.positions ?? []).map((p) => [p.txidInternal, p.status]),
  );

  const positions: PositionRecord[] = [];
  for (const txidInternal of discovery.txids) {
    try {
      const record = await scanOnePosition({
        txidInternal,
        tipHeight,
        lend: client.lend,
        existingTopics,
      });
      if (record) positions.push(record);
    } catch (err) {
      warnings.push(`reading position ${txidInternal} failed: ${String(err)}`);
    }
  }

  const nowIso = new Date().toISOString();
  const changes = diffForHistory(previousStatusByTxid, positions, nowIso);

  const sender = new HttpNtfySender();
  for (const change of changes) {
    const record = positions.find((p) => p.txidDisplay === change.txidDisplay);
    if (!record) continue;
    if (!shouldAlert(change.fromStatus, change.toStatus)) continue;
    try {
      const msg = buildStateChangeMessage({
        txidDisplay: record.txidDisplay,
        fromStatus: change.fromStatus as AlertStatus | null,
        toStatus: change.toStatus as AlertStatus,
        healthPct: record.healthDisplay,
      });
      await sender.send({ ...msg, topic: record.ntfyTopic });
    } catch (err) {
      warnings.push(`alert for ${record.txidDisplay} failed to send: ${String(err)}`);
    }
  }

  const summary: ScanSummary = {
    scannedAt: nowIso,
    network: "testnet",
    writzLendContractId: network.contracts.writzLend,
    bitcoinSpvContractId: network.contracts.bitcoinSpv,
    tipHeight,
    positions,
    discoverySources: discovery.sources,
    warnings,
  };

  const newTopics: Record<string, string> = { ...existingTopics };
  for (const p of positions) newTopics[p.txidInternal] = p.ntfyTopic;

  const existingHistory = await readJson<HistoryEntry[]>(HISTORY_PATH, []);
  const newHistory = [...existingHistory, ...changes];

  await writeFile(POSITIONS_PATH, JSON.stringify(summary, null, 2) + "\n");
  await writeFile(HISTORY_PATH, JSON.stringify(newHistory, null, 2) + "\n");
  await writeFile(TOPICS_PATH, JSON.stringify(newTopics, null, 2) + "\n");

  console.log(
    `scanned ${positions.length} position(s), ${changes.length} state change(s), ${warnings.length} warning(s)`,
  );
  for (const w of warnings) console.warn(`  warning: ${w}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
