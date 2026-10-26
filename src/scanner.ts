import { reverseHex, type Position } from "@writz/sdk";
import {
  classifyStatus,
  isTimelockNear,
  pctDropToLiquidation,
  I128_MAX,
  type PositionStatus,
} from "./thresholds.js";
import { generateTopic } from "./alerts.js";
import type { PositionRecord, HistoryEntry } from "./types.js";

export interface LendReader {
  getPosition(txidInternal: string): Promise<Position | null>;
  getHealthRatioBp(txidInternal: string): Promise<bigint>;
}

export interface SpvReader {
  getBestTip(): Promise<{ height: number } | null>;
}

export function healthDisplay(healthBp: bigint): string {
  if (healthBp === I128_MAX) return "no debt";
  const pct = Number(healthBp) / 100;
  return `${pct.toFixed(1)}%`;
}

export interface ScanOnePositionArgs {
  txidInternal: string;
  tipHeight: number;
  lend: LendReader;
  existingTopics: Record<string, string>;
  now?: () => Date;
}

/** Reads one position, classifies it, and builds its `PositionRecord`. Returns null if the position is unknown on chain (e.g. a stale seed txid). */
export async function scanOnePosition(args: ScanOnePositionArgs): Promise<PositionRecord | null> {
  const pos = await args.lend.getPosition(args.txidInternal);
  if (!pos) return null;

  const healthBp = pos.status === "Active" ? await args.lend.getHealthRatioBp(args.txidInternal) : I128_MAX;
  const status = classifyStatus({ contractStatus: pos.status, healthBp });
  const topic = args.existingTopics[args.txidInternal] ?? generateTopic(args.txidInternal);
  const now = (args.now ?? (() => new Date()))();

  return {
    txidDisplay: reverseHex(args.txidInternal),
    txidInternal: args.txidInternal,
    depositor: pos.depositor,
    btcSatoshis: pos.btcSatoshis.toString(),
    usdcDebt: pos.usdcDebt.toString(),
    status,
    healthBp: healthBp === I128_MAX ? "max" : healthBp.toString(),
    healthDisplay: healthDisplay(healthBp),
    timelockHeight: pos.timelockHeight,
    tipHeight: args.tipHeight,
    blocksUntilLiquidationCutoff: pos.timelockHeight - args.tipHeight - 288,
    timelockNear: isTimelockNear(pos.timelockHeight, args.tipHeight),
    pctDropToLiquidation: pctDropToLiquidation(healthBp),
    lastUpdateLedger: pos.lastUpdateLedger,
    ntfyTopic: topic,
    updatedAt: now.toISOString(),
  };
}

/**
 * Diffs the previous snapshot against the new one and returns one
 * `HistoryEntry` per position whose status actually changed - "no repeats",
 * the same rule `shouldAlert` (alerts.ts) uses to decide whether to notify.
 */
export function diffForHistory(
  previous: Map<string, PositionStatus>,
  current: PositionRecord[],
  nowIso: string,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const pos of current) {
    const prevStatus = previous.get(pos.txidInternal) ?? null;
    if (prevStatus !== pos.status) {
      entries.push({ atIso: nowIso, txidDisplay: pos.txidDisplay, fromStatus: prevStatus, toStatus: pos.status });
    }
  }
  return entries;
}
