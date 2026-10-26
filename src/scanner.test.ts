import { describe, expect, it } from "vitest";
import { scanOnePosition, diffForHistory, healthDisplay } from "./scanner.js";
import { I128_MAX } from "./thresholds.js";
import type { Position } from "@writz/sdk";
import type { PositionRecord } from "./types.js";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    btcTxid: "aa".repeat(32),
    btcSatoshis: 100_000n,
    usdcDebt: 1_000_0000000n,
    p2wshScriptPubkey: "00" + "bb".repeat(21),
    timelockHeight: 400_000,
    lastUpdateLedger: 12345,
    debtIndex: 1_000_000_000_000_000_000n,
    depositor: "GDEPOSITOR",
    status: "Active",
    userPubkey: "02" + "cc".repeat(32),
    ...overrides,
  };
}

describe("healthDisplay", () => {
  it("shows 'no debt' for i128::MAX", () => {
    expect(healthDisplay(I128_MAX)).toBe("no debt");
  });

  it("shows a percentage otherwise", () => {
    expect(healthDisplay(15_000n)).toBe("150.0%");
    expect(healthDisplay(13_457n)).toBe("134.6%");
  });
});

describe("scanOnePosition", () => {
  it("returns null for an unknown position", async () => {
    const result = await scanOnePosition({
      txidInternal: "ff".repeat(32),
      tipHeight: 100,
      existingTopics: {},
      lend: {
        getPosition: async () => null,
        getHealthRatioBp: async () => 0n,
      },
    });
    expect(result).toBeNull();
  });

  it("classifies an Active, healthy position and reuses an existing topic", async () => {
    const txidInternal = "aa".repeat(32);
    const result = await scanOnePosition({
      txidInternal,
      tipHeight: 100_000,
      existingTopics: { [txidInternal]: "centinela-testnet-aabbccdd-existing" },
      lend: {
        getPosition: async () => makePosition({ timelockHeight: 500_000 }),
        getHealthRatioBp: async () => 20_000n,
      },
    });
    expect(result).not.toBeNull();
    expect(result!.status).toBe("healthy");
    expect(result!.ntfyTopic).toBe("centinela-testnet-aabbccdd-existing");
    expect(result!.blocksUntilLiquidationCutoff).toBe(500_000 - 100_000 - 288);
    expect(result!.pctDropToLiquidation).toBe(40); // health 200% -> 120% is a 40% drop
  });

  it("does not call getHealthRatioBp for a Liquidated position (contract status is authoritative)", async () => {
    let healthCalled = false;
    const result = await scanOnePosition({
      txidInternal: "bb".repeat(32),
      tipHeight: 100,
      existingTopics: {},
      lend: {
        getPosition: async () => makePosition({ status: "Liquidated", usdcDebt: 0n }),
        getHealthRatioBp: async () => {
          healthCalled = true;
          return 0n;
        },
      },
    });
    expect(result!.status).toBe("liquidated");
    expect(healthCalled).toBe(false);
  });
});

describe("diffForHistory", () => {
  function record(overrides: Partial<PositionRecord>): PositionRecord {
    return {
      txidDisplay: "disp",
      txidInternal: "int",
      depositor: "G...",
      btcSatoshis: "100000",
      usdcDebt: "0",
      status: "healthy",
      healthBp: "20000",
      healthDisplay: "200.0%",
      timelockHeight: 1,
      tipHeight: 1,
      blocksUntilLiquidationCutoff: 1,
      timelockNear: false,
      pctDropToLiquidation: 40,
      lastUpdateLedger: 1,
      ntfyTopic: "t",
      updatedAt: "now",
      ...overrides,
    };
  }

  it("emits one entry per changed status and none for unchanged ones", () => {
    const previous = new Map([
      ["int-a", "healthy" as const],
      ["int-b", "warning" as const],
    ]);
    const current = [
      record({ txidInternal: "int-a", txidDisplay: "a", status: "healthy" }), // unchanged
      record({ txidInternal: "int-b", txidDisplay: "b", status: "liquidatable" }), // changed
      record({ txidInternal: "int-c", txidDisplay: "c", status: "no-debt" }), // new position
    ];
    const entries = diffForHistory(previous, current, "2026-10-26T10:00:00Z");
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.txidDisplay === "b")).toMatchObject({ fromStatus: "warning", toStatus: "liquidatable" });
    expect(entries.find((e) => e.txidDisplay === "c")).toMatchObject({ fromStatus: null, toStatus: "no-debt" });
  });
});
