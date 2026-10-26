// Mirrors the root project's src/types.ts (PositionRecord / ScanSummary / HistoryEntry).
// Kept as a separate, lightweight copy here on purpose: web/ is a standalone static
// build (no Node runtime, no @stellar/stellar-sdk - see README "don't put stellar-sdk
// in a Vercel serverless function"), so it only needs the JSON *shape*, not the scanner.

export type PositionStatus =
  | "no-debt"
  | "healthy"
  | "cannot-borrow-more"
  | "warning"
  | "liquidatable"
  | "liquidated"
  | "closed";

export interface PositionRecord {
  txidDisplay: string;
  txidInternal: string;
  depositor: string;
  btcSatoshis: string;
  usdcDebt: string;
  status: PositionStatus;
  healthBp: string;
  healthDisplay: string;
  timelockHeight: number;
  tipHeight: number;
  blocksUntilLiquidationCutoff: number;
  timelockNear: boolean;
  pctDropToLiquidation: number | null;
  lastUpdateLedger: number;
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
