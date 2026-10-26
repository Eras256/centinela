// Same math as the root project's src/thresholds.ts, duplicated for this
// standalone static build (no bundler link between the two - see
// web/src/types.ts for why). Thresholds are read from writz-lend's contract
// source (contracts/contracts/writz-lend/src/{lib,oracle}.rs): see the root
// README "Verified facts" section for citations.

export const LIQUIDATION_THRESHOLD_BP = 12_000;
export const WARNING_THRESHOLD_BP = 13_500;
export const MIN_COLLATERAL_RATIO_BP = 15_000;

import type { PositionStatus } from "./types";

export function classifyFromHealthBp(healthBp: number | "max"): PositionStatus {
  if (healthBp === "max") return "no-debt";
  if (healthBp < LIQUIDATION_THRESHOLD_BP) return "liquidatable";
  if (healthBp <= WARNING_THRESHOLD_BP) return "warning";
  if (healthBp <= MIN_COLLATERAL_RATIO_BP) return "cannot-borrow-more";
  return "healthy";
}

/** Health scales linearly with price - see root README for why this needs no absolute USD price. */
export function simulateHealthAfterDrop(healthBp: number, dropPct: number): number {
  return Math.round(healthBp * ((100 - dropPct) / 100));
}
