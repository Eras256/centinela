import { describe, expect, it } from "vitest";
import { reverseHex, isHash } from "@writz/sdk";

/**
 * The gotcha this project was built to not re-trip on: `writz-lend` expects
 * txids in *internal* (contract) byte order, the reverse of what every
 * Bitcoin explorer displays. Confirmed by hand during research for this
 * project: calling `get_position` with the display-order txid from
 * mempool.space failed with `Error(Contract, #8)` (PositionNotFound);
 * reversing the bytes first returned the position. `@writz/sdk`'s
 * `reverseHex` is what both `discovery.ts` and `scanner.ts` use to convert
 * between the two orders - this test pins its behavior against the actual
 * documented example txid so a future SDK bump can't silently change it.
 */
const DISPLAY_ORDER_TXID = "eac0f95c531b4bd5307597f74bedd7379928539056b9a1467ea6d1159507e269";

describe("txid byte order", () => {
  it("is a valid 64-character hash", () => {
    expect(isHash(DISPLAY_ORDER_TXID)).toBe(true);
  });

  it("reverseHex actually changes the bytes (it is not a no-op)", () => {
    const internal = reverseHex(DISPLAY_ORDER_TXID);
    expect(internal).not.toBe(DISPLAY_ORDER_TXID);
    expect(isHash(internal)).toBe(true);
  });

  it("reverseHex is its own inverse: reversing twice returns the original", () => {
    const internal = reverseHex(DISPLAY_ORDER_TXID);
    expect(reverseHex(internal)).toBe(DISPLAY_ORDER_TXID);
  });

  it("matches an independently-computed byte-reversed value for the documented example txid", () => {
    expect(reverseHex(DISPLAY_ORDER_TXID)).toBe(reverseBytesHexReference(DISPLAY_ORDER_TXID));
  });
});

/** Independent reference implementation (byte-pair reversal), so the test doesn't just call the function under test on both sides. */
function reverseBytesHexReference(hex: string): string {
  const pairs: string[] = [];
  for (let i = 0; i < hex.length; i += 2) pairs.push(hex.slice(i, i + 2));
  return pairs.reverse().join("");
}
