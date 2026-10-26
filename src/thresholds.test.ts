import { describe, expect, it } from "vitest";
import {
  classifyStatus,
  isTimelockNear,
  simulateHealthAfterDrop,
  pctDropToLiquidation,
  liqPriceUsd,
  I128_MAX,
  LIQUIDATION_CUTOFF_BLOCKS,
} from "./thresholds.js";

describe("classifyStatus", () => {
  it("is 'liquidated' for a Liquidated contract position regardless of healthBp", () => {
    expect(classifyStatus({ contractStatus: "Liquidated", healthBp: 0n })).toBe("liquidated");
    expect(classifyStatus({ contractStatus: "Liquidated", healthBp: I128_MAX })).toBe("liquidated");
  });

  it("is 'closed' for a Closed contract position", () => {
    expect(classifyStatus({ contractStatus: "Closed", healthBp: I128_MAX })).toBe("closed");
  });

  it("is 'no-debt' when healthBp is i128::MAX (debt-free)", () => {
    expect(classifyStatus({ contractStatus: "Active", healthBp: I128_MAX })).toBe("no-debt");
  });

  it("is 'healthy' strictly above 150%", () => {
    expect(classifyStatus({ contractStatus: "Active", healthBp: 15_001n })).toBe("healthy");
    expect(classifyStatus({ contractStatus: "Active", healthBp: 20_000n })).toBe("healthy");
  });

  it("is 'cannot-borrow-more' at or below 150% but above 135%", () => {
    expect(classifyStatus({ contractStatus: "Active", healthBp: 15_000n })).toBe("cannot-borrow-more");
    expect(classifyStatus({ contractStatus: "Active", healthBp: 13_501n })).toBe("cannot-borrow-more");
  });

  it("is 'warning' at or below 135%, including exactly the 120% liquidation threshold", () => {
    expect(classifyStatus({ contractStatus: "Active", healthBp: 13_500n })).toBe("warning");
    expect(classifyStatus({ contractStatus: "Active", healthBp: 12_001n })).toBe("warning");
    // At exactly 12,000bp, `liquidate` refuses with PositionHealthy (health >= threshold) - still safe, not liquidatable.
    expect(classifyStatus({ contractStatus: "Active", healthBp: 12_000n })).toBe("warning");
  });

  it("is 'liquidatable' strictly below 120% (matches the contract's >= refusal check)", () => {
    expect(classifyStatus({ contractStatus: "Active", healthBp: 11_999n })).toBe("liquidatable");
    expect(classifyStatus({ contractStatus: "Active", healthBp: 1n })).toBe("liquidatable");
    expect(classifyStatus({ contractStatus: "Active", healthBp: 0n })).toBe("liquidatable");
  });
});

describe("isTimelockNear", () => {
  it("is true once blocks until the liquidation cutoff drop to the margin", () => {
    const tip = 100_000;
    const timelockHeight = tip + LIQUIDATION_CUTOFF_BLOCKS + 288; // exactly at the default margin
    expect(isTimelockNear(timelockHeight, tip)).toBe(true);
  });

  it("is false comfortably before the cutoff", () => {
    const tip = 100_000;
    const timelockHeight = tip + LIQUIDATION_CUTOFF_BLOCKS + 10_000;
    expect(isTimelockNear(timelockHeight, tip)).toBe(false);
  });

  it("is true (already past) when the cutoff window has closed", () => {
    const tip = 100_000;
    const timelockHeight = tip + 10; // well under the 288-block cutoff
    expect(isTimelockNear(timelockHeight, tip)).toBe(true);
  });
});

describe("simulateHealthAfterDrop", () => {
  it("scales health linearly with the price drop", () => {
    expect(simulateHealthAfterDrop(20_000n, 0)).toBe(20_000n);
    expect(simulateHealthAfterDrop(20_000n, 50)).toBe(10_000n);
    expect(simulateHealthAfterDrop(20_000n, 25)).toBe(15_000n);
  });

  it("returns null for a debt-free position (health undefined at any price)", () => {
    expect(simulateHealthAfterDrop(I128_MAX, 90)).toBeNull();
  });

  it("rejects an out-of-range drop percentage", () => {
    expect(() => simulateHealthAfterDrop(20_000n, -1)).toThrow(RangeError);
    expect(() => simulateHealthAfterDrop(20_000n, 100)).toThrow(RangeError);
  });
});

describe("pctDropToLiquidation", () => {
  it("is null for a debt-free position", () => {
    expect(pctDropToLiquidation(I128_MAX)).toBeNull();
  });

  it("is 0 when already at or below the liquidation threshold", () => {
    expect(pctDropToLiquidation(12_000n)).toBe(0);
    expect(pctDropToLiquidation(5_000n)).toBe(0);
  });

  it("computes the correct drop for a healthy position", () => {
    // health 24,000 (240%) -> liquidation at 12,000 (120%) needs exactly a 50% price drop.
    expect(pctDropToLiquidation(24_000n)).toBe(50);
  });
});

describe("liqPriceUsd", () => {
  it("is null without a current price", () => {
    expect(liqPriceUsd(20_000n, null)).toBeNull();
  });

  it("is null for a debt-free position even with a price", () => {
    expect(liqPriceUsd(I128_MAX, 65_000)).toBeNull();
  });

  it("computes price * 12000 / health_bp", () => {
    // At health 240% and price $65,000, liquidation price is $32,500.
    expect(liqPriceUsd(24_000n, 65_000)).toBeCloseTo(32_500, 5);
  });
});
