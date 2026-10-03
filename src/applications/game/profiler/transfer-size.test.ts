import { describe, expect, test } from "bun:test";
import { estimateTransferBytes } from "./transfer-size";

describe("estimateTransferBytes", () => {
  test("counts a shared ArrayBuffer once because structured clone keeps identity", () => {
    const chunk = new Uint8Array(32 * 32 * 32);
    const params = [chunk.buffer, { center: chunk.buffer }, 1, 2, 3];
    expect(estimateTransferBytes(params)).toBe(32768 + "center".length + 3 * 8);
  });

  test("a view over a large buffer costs the whole backing buffer", () => {
    const backing = new ArrayBuffer(1000);
    const view = new Uint8Array(backing, 10, 5);
    expect(estimateTransferBytes(view)).toBe(1000);
  });

  test("sums nested neighbour maps and skips missing neighbours", () => {
    const neighbors = {
      "-1,0,0": new Uint8Array(100).buffer,
      "1,0,0": undefined,
      "0,1,0": new Uint8Array(50).buffer,
    };
    const keyBytes = Object.keys(neighbors).join("").length;
    expect(estimateTransferBytes(neighbors)).toBe(150 + keyBytes);
  });

  test("survives cyclic structures", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(estimateTransferBytes(cyclic)).toBe("self".length);
  });
});
