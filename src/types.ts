import type { PositionStatus } from "./thresholds.js";

/** One row of `data/positions.json`. Also the data contract Monse's per-position page/simulator reads (see README "Data contract for web/"). */
export interface PositionRecord {
  /** Display byte order, as explorers (mempool.space) show it. */
  txidDisplay: string;
  /** Internal byte order, the contract's own key. */
  txidInternal: string;
  depositor: string;
  /** BTC collateral, satoshis, as a decimal string (safe for JSON; may exceed Number precision only in extreme cases, kept as string for consistency). */
  btcSatoshis: string;
  /** USDC debt, stroops (7 decimals), as a decimal string. */
  usdcDebt: string;
  status: PositionStatus;
  /** Raw `get_health_ratio_bp`, as a decimal string. `"max"` when debt-free (i128::MAX). */
  healthBp: string;
  /** Human display, e.g. "187.4%" or "no debt". */
  healthDisplay: string;
  timelockHeight: number;
  /** `bitcoin-spv` best tip height at scan time. */
  tipHeight: number;
  /** `timelockHeight - tipHeight - LIQUIDATION_CUTOFF_BLOCKS`; negative means `liquidate` would already be refused with `LiquidationWindowClosed`. */
  blocksUntilLiquidationCutoff: number;
  timelockNear: boolean;
  /** Percent BTC price drop that would push this position to the liquidation threshold; null if debt-free or N/A. */
  pctDropToLiquidation: number | null;
  lastUpdateLedger: number;
  /** This position's ntfy.sh topic, generated once and persisted (`data/topics.json`). */
  ntfyTopic: string;
  updatedAt: string;
}

export interface ScanSummary {
  scannedAt: string;
  network: "testnet";
  writzLendContractId: string;
  bitcoinSpvContractId: string;
  tipHeight: number;
  positions: PositionRecord[];
  discoverySources: Record<string, "event" | "seed">;
  warnings: string[];
}

export interface HistoryEntry {
  atIso: string;
  txidDisplay: string;
  fromStatus: PositionStatus | null;
  toStatus: PositionStatus;
}
