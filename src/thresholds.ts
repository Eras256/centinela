/**
 * Position health classification and liquidation-simulator math.
 *
 * Thresholds are read from Writz's `writz-lend` contract source
 * (`contracts/contracts/writz-lend/src/lib.rs`, `Config` defaults set in
 * `__constructor`), not guessed:
 *   - min_collateral_ratio_bp = 15_000  (150%) - floor to borrow/top-up
 *   - liquidation_threshold_bp = 12_000 (120%) - below this, liquidatable
 *   - liquidation_bonus_bp     = 1_000  (10%)  - keeper discount
 *   - LIQUIDATION_CUTOFF_BLOCKS = 288 - `liquidate` is refused once the
 *     position's timelock height is less than 288 blocks above the
 *     bitcoin-spv tip (the borrower's unilateral exit window)
 *
 * `health_ratio_bp` itself (`oracle.rs`) is `collateral * 10_000 / debt`,
 * and returns i128::MAX when debt is zero. We mirror that: a zero-debt
 * position has no meaningful health ratio, so it gets its own status.
 */

export const MIN_COLLATERAL_RATIO_BP = 15_000n;
export const LIQUIDATION_THRESHOLD_BP = 12_000n;
export const WARNING_THRESHOLD_BP = 13_500n;
export const LIQUIDATION_BONUS_BP = 1_000n;
export const LIQUIDATION_CUTOFF_BLOCKS = 288;
/** How close to the liquidation cutoff before we flag "timelock-near". Same order of magnitude as the cutoff itself. */
export const TIMELOCK_NEAR_MARGIN_BLOCKS = 288;

/** i128::MAX, exactly as the Soroban host represents it. `get_health_ratio_bp` returns this for a debt-free position. */
export const I128_MAX = (1n << 127n) - 1n;

export type PositionStatus =
  | "no-debt"
  | "healthy"
  | "cannot-borrow-more"
  | "warning"
  | "liquidatable"
  | "liquidated"
  | "closed";

/** `writz-lend`'s own `Position.status` enum (`types.ts` in `@writz/sdk`), the ground truth for the terminal states. */
export type ContractPositionStatus = "Active" | "Closed" | "Liquidated";

export interface ClassifyInput {
  /** `Position.status`, read directly from `get_position` - authoritative for Liquidated/Closed, no event replay needed. */
  contractStatus: ContractPositionStatus;
  /** Raw return of `get_health_ratio_bp`. Ignored unless `contractStatus === "Active"`. */
  healthBp: bigint;
}

/**
 * Classifies a position into the status ladder, worst first. Liquidated and
 * Closed come straight from the contract's own `Position.status` (ground
 * truth - no need to replay `liquidate`/`mark_released` events to know
 * this).
 *
 * For an Active position, the two boundaries that the contract actually
 * enforces are matched exactly to its own comparisons, not to the prompt's
 * rounded "≤" shorthand, because getting this edge wrong would mean
 * labeling a position "liquidatable" when a keeper's `liquidate` call would
 * in fact be refused, or the reverse:
 *   - `liquidatable`: `liquidate` (lib.rs) refuses with `PositionHealthy`
 *     when `health >= liquidation_threshold_bp` - so a position is only
 *     really liquidatable when health is *strictly less than* 12,000bp.
 *     At exactly 12,000bp it is still safe; we bucket it as `warning`.
 *   - `cannot-borrow-more`: `borrow` refuses with `ExceedsCollateralRatio`
 *     when the *post-borrow* health would be `< min_collateral_ratio_bp`.
 *     Since any positive borrow strictly lowers health, a position already
 *     *at* 15,000bp fails any further borrow too - so this bucket is
 *     `<=` 15,000bp, matching the prompt's "≤150%" exactly.
 *   - `warning` (13,500bp) has no contract-enforced edge of its own - it is
 *     Centinela's own early-warning threshold, so we also use `<=` there,
 *     consistent with the other two.
 */
export function classifyStatus({ contractStatus, healthBp }: ClassifyInput): PositionStatus {
  if (contractStatus === "Liquidated") return "liquidated";
  if (contractStatus === "Closed") return "closed";
  if (healthBp === I128_MAX) return "no-debt";
  if (healthBp < LIQUIDATION_THRESHOLD_BP) return "liquidatable";
  if (healthBp <= WARNING_THRESHOLD_BP) return "warning";
  if (healthBp <= MIN_COLLATERAL_RATIO_BP) return "cannot-borrow-more";
  return "healthy";
}

/**
 * True when the position's unilateral-exit timelock is close enough to the
 * bitcoin-spv tip that `liquidate` will soon be refused with
 * `LiquidationWindowClosed`, regardless of health. Mirrors `timelock_clears`
 * in `lib.rs`: liquidation needs `timelockHeight >= tipHeight + LIQUIDATION_CUTOFF_BLOCKS`.
 */
export function isTimelockNear(
  timelockHeight: number,
  tipHeight: number,
  marginBlocks: number = TIMELOCK_NEAR_MARGIN_BLOCKS,
): boolean {
  const blocksUntilCutoff = timelockHeight - tipHeight - LIQUIDATION_CUTOFF_BLOCKS;
  return blocksUntilCutoff <= marginBlocks;
}

/**
 * Projects the health ratio after a hypothetical BTC price drop of
 * `dropPct` percent (0-100). Valid because health scales linearly with
 * price: collateral = satoshis * price / 1e8, and health = collateral *
 * 10_000 / debt, so a price drop of x% scales health by exactly (1 - x/100)
 * with no need to know the absolute USD price. Returns null for a
 * debt-free position: health is undefined (infinite) at any price.
 */
export function simulateHealthAfterDrop(healthBpNow: bigint, dropPct: number): bigint | null {
  if (healthBpNow === I128_MAX) return null;
  if (!Number.isFinite(dropPct) || dropPct < 0 || dropPct >= 100) {
    throw new RangeError("dropPct must be a finite number in [0, 100)");
  }
  // Integer-safe: scale by (100 - dropPct) out of 100, truncating like the contract's own integer division.
  const remainingBp = BigInt(Math.round((100 - dropPct) * 100)); // two decimal places of precision
  return (healthBpNow * remainingBp) / 10_000n;
}

/**
 * The BTC price drop (percent, 0-100) that would push this position exactly
 * to the liquidation threshold, or null if it is debt-free (never
 * liquidatable regardless of price) or already at/below the threshold
 * (0% - it's already there).
 */
export function pctDropToLiquidation(healthBpNow: bigint): number | null {
  if (healthBpNow === I128_MAX) return null;
  if (healthBpNow <= LIQUIDATION_THRESHOLD_BP) return 0;
  const ratio = Number(LIQUIDATION_THRESHOLD_BP) / Number(healthBpNow);
  return Math.round((1 - ratio) * 1000) / 10; // one decimal place
}

/**
 * Optional: converts a health-ratio projection into a USD liquidation price,
 * given a *current* USD price from an external source (Centinela does not
 * read the Reflector oracle itself - see README "honest limits"). Returns
 * null without a price or without debt.
 */
export function liqPriceUsd(healthBpNow: bigint, currentPriceUsd: number | null): number | null {
  if (currentPriceUsd === null || healthBpNow === I128_MAX) return null;
  return (currentPriceUsd * Number(LIQUIDATION_THRESHOLD_BP)) / Number(healthBpNow);
}
