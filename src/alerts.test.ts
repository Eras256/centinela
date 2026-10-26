import { describe, expect, it } from "vitest";
import { shouldAlert, generateTopic, buildStateChangeMessage, buildTestMessage } from "./alerts.js";

describe("shouldAlert", () => {
  it("alerts on any status change", () => {
    expect(shouldAlert("healthy", "warning")).toBe(true);
    expect(shouldAlert(null, "healthy")).toBe(true);
  });

  it("never alerts when the status did not change (no repeats)", () => {
    expect(shouldAlert("healthy", "healthy")).toBe(false);
    expect(shouldAlert("liquidatable", "liquidatable")).toBe(false);
  });
});

describe("generateTopic", () => {
  it("is prefixed, labeled testnet, and includes part of the txid", () => {
    const topic = generateTopic("aabbccdd00112233");
    expect(topic.startsWith("centinela-testnet-aabbccdd-")).toBe(true);
  });

  it("is not deterministic across calls (unguessable)", () => {
    const a = generateTopic("aabbccdd00112233");
    const b = generateTopic("aabbccdd00112233");
    expect(a).not.toBe(b);
  });
});

describe("buildStateChangeMessage", () => {
  it("labels the message testnet and states both the new and previous status", () => {
    const msg = buildStateChangeMessage({
      txidDisplay: "eac0f95c531b4bd5307597f74bedd7379928539056b9a1467ea6d1159507e269",
      fromStatus: "healthy",
      toStatus: "warning",
      healthPct: "132.0%",
    });
    expect(msg.message).toContain("TESTNET");
    expect(msg.message).toContain("warning");
    expect(msg.message).toContain("was healthy");
    expect(msg.title.toUpperCase()).toContain("TESTNET");
  });

  it("never claims custody or signing", () => {
    const msg = buildStateChangeMessage({
      txidDisplay: "eac0f95c531b4bd5307597f74bedd7379928539056b9a1467ea6d1159507e269",
      fromStatus: null,
      toStatus: "liquidatable",
      healthPct: "110.0%",
    });
    expect(msg.message).toContain("never signs or moves funds");
  });
});

describe("buildTestMessage", () => {
  it("is clearly labeled TEST", () => {
    const msg = buildTestMessage("some-topic");
    expect(msg.title).toContain("TEST");
    expect(msg.message).toContain("TEST");
    expect(msg.topic).toBe("some-topic");
  });
});
