/**
 * Network wiring. Contract IDs are never hardcoded in the scan logic: they
 * come from `@writz/sdk`'s generated testnet preset (itself generated from
 * Writz's `contracts/deployments/testnet.md`), with environment overrides
 * so a redeploy - like the `writz-lend` switch scheduled for 2026-10-26
 * 18:37 UTC - doesn't require a code change, only a restart with new env
 * vars (or a dependency bump once `@writz/sdk` publishes a version that
 * points at the new ID).
 *
 * See README "Handling the 18:37 UTC contract switch" for the operational
 * procedure.
 */
import { networks, type NetworkPreset } from "@writz/sdk";

/**
 * `writz-lend`'s 2026-10-26 redeploy, built but not yet active as of this
 * writing (contracts/deployments/testnet.md). Used only as a documented,
 * explicit fallback - never silently.
 */
export const WRITZ_LEND_PENDING_SWITCH = {
  contractId: "CDKXFBHUBIEUD2OXBSB44RJYZ2KM6NIPJF2EFVVA3UCACWJETN4O5VBG",
  switchAtUtc: "2026-10-26T18:37:00Z",
} as const;

export function loadNetwork(env: Record<string, string | undefined> = process.env): NetworkPreset {
  const base = networks.testnet;
  const writzLendOverride = env.WRITZ_LEND_CONTRACT_ID;
  const bitcoinSpvOverride = env.BITCOIN_SPV_CONTRACT_ID;
  if (!writzLendOverride && !bitcoinSpvOverride) return base;
  return {
    ...base,
    contracts: {
      ...base.contracts,
      writzLend: writzLendOverride ?? base.contracts.writzLend,
      bitcoinSpv: bitcoinSpvOverride ?? base.contracts.bitcoinSpv,
    },
  };
}

/**
 * Pure helper (no network/env access) so it is directly unit-testable:
 * whether `nowUtc` is past the documented switch time and no override was
 * supplied, meaning the configured ID is about to be - or already is -
 * stale.
 */
export function isPastDocumentedSwitch(nowUtc: Date, hasOverride: boolean): boolean {
  if (hasOverride) return false;
  return nowUtc.getTime() >= Date.parse(WRITZ_LEND_PENDING_SWITCH.switchAtUtc);
}
