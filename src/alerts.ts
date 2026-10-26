/**
 * Alerts via ntfy.sh (https://ntfy.sh): no signup, push to a phone that has
 * the ntfy app subscribed to a topic. Centinela never asks for a phone
 * number or email - a visitor picks an unguessable-but-public topic per
 * position from the status page and subscribes themselves.
 *
 * Every message is labeled "testnet" (this entire project only watches
 * Writz's Bitcoin Signet / Stellar testnet deployment) and every
 * manually-triggered test message is labeled "TEST" so it is never
 * confused with a real state change.
 */
import { randomBytes } from "node:crypto";

export const NTFY_BASE_URL = "https://ntfy.sh";

/** Deterministic-looking but unguessable topic for one position. Generated once, then persisted - never regenerated for the same txid. */
export function generateTopic(txidInternal: string): string {
  const shortTxid = txidInternal.slice(0, 8);
  const random = randomBytes(5).toString("hex");
  return `centinela-testnet-${shortTxid}-${random}`;
}

export interface NtfyMessage {
  topic: string;
  title: string;
  message: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
}

export interface NtfySender {
  send(msg: NtfyMessage): Promise<void>;
}

/** Real sender, backed by `fetch`. A fake implementing the same interface is used in tests. */
export class HttpNtfySender implements NtfySender {
  constructor(private readonly baseUrl: string = NTFY_BASE_URL) {}

  async send(msg: NtfyMessage): Promise<void> {
    const res = await fetch(`${this.baseUrl}/${msg.topic}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...(msg.title ? { Title: msg.title } : {}),
        ...(msg.priority ? { Priority: String(msg.priority) } : {}),
        ...(msg.tags?.length ? { Tags: msg.tags.join(",") } : {}),
      },
      body: msg.message,
    });
    if (!res.ok) {
      throw new Error(`ntfy POST to ${msg.topic} failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  }
}

export type AlertStatus =
  | "no-debt"
  | "healthy"
  | "cannot-borrow-more"
  | "warning"
  | "liquidatable"
  | "liquidated"
  | "closed";

const STATUS_COPY: Record<AlertStatus, { title: string; priority: 1 | 2 | 3 | 4 | 5; tags: string[] }> = {
  "no-debt": { title: "[TESTNET] Centinela: no debt", priority: 2, tags: ["white_check_mark"] },
  healthy: { title: "[TESTNET] Centinela: position healthy", priority: 2, tags: ["green_circle"] },
  "cannot-borrow-more": {
    title: "[TESTNET] Centinela: at the borrow limit",
    priority: 3,
    tags: ["large_orange_circle"],
  },
  warning: { title: "[TESTNET] Centinela: liquidation warning", priority: 4, tags: ["warning"] },
  liquidatable: { title: "[TESTNET] Centinela: LIQUIDATABLE NOW", priority: 5, tags: ["rotating_light"] },
  liquidated: { title: "[TESTNET] Centinela: position liquidated", priority: 5, tags: ["skull"] },
  closed: { title: "[TESTNET] Centinela: position closed", priority: 1, tags: ["lock"] },
};

export function buildStateChangeMessage(args: {
  txidDisplay: string;
  fromStatus: AlertStatus | null;
  toStatus: AlertStatus;
  healthPct: string;
}): NtfyMessage {
  const copy = STATUS_COPY[args.toStatus];
  const from = args.fromStatus ? ` (was ${args.fromStatus})` : "";
  return {
    topic: "", // caller fills in the position's topic
    title: copy.title,
    priority: copy.priority,
    tags: copy.tags,
    message:
      `[TESTNET - Writz / Stellar testnet. Not financial advice. Read-only, non-custodial.]\n` +
      `Position ${args.txidDisplay.slice(0, 10)}... is now ${args.toStatus}${from}.\n` +
      `Health: ${args.healthPct}.\n` +
      `Centinela never signs or moves funds. It only watches and notifies.`,
  };
}

export function buildTestMessage(topic: string): NtfyMessage {
  return {
    topic,
    title: "[TEST] Centinela testnet alert",
    priority: 3,
    tags: ["test_tube"],
    message:
      "[TEST] This is a test notification from Centinela (Writz testnet liquidation monitor). " +
      "If you see this, alert delivery works. No real position changed state.",
  };
}

/**
 * Decides whether a state transition should alert, given the previous and
 * current status. "No repeats": identical consecutive statuses never
 * alert, including across runs where nothing changed.
 */
export function shouldAlert(previous: AlertStatus | null, current: AlertStatus): boolean {
  return previous !== current;
}
