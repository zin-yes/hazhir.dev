import { describe, expect, test } from "bun:test";
import { BlockType } from "../blocks";
import { sphereEdits } from "./block-edit-batch";
import { splitBatchByChunk } from "./edit-slicing";

describe("edit slicing", () => {
  test("a radius 32 sphere splits into one piece per chunk, nearest first, keeping every edit and the replace rule", () => {
    const startedAt = performance.now();
    const center = { x: -40, y: 100, z: 15 };
    const sphere = sphereEdits(center, 32, BlockType.STONE, "fillAirOnly");
    const pieces = splitBatchByChunk(sphere, center);
    expect(pieces.length).toBeGreaterThanOrEqual(8);
    expect(pieces.reduce((total, piece) => total + piece.length, 0)).toBe(sphere.length);
    const seen = new Set<string>();
    for (const piece of pieces) {
      expect(piece.replaceRule).toBe("airOnly");
      const chunkKeys = new Set<string>();
      for (let position = 0; position < piece.length; position++) {
        chunkKeys.add(`${Math.floor(piece.xs[position] / 32)},${Math.floor(piece.ys[position] / 32)},${Math.floor(piece.zs[position] / 32)}`);
        seen.add(`${piece.xs[position]},${piece.ys[position]},${piece.zs[position]}`);
      }
      expect(chunkKeys.size).toBe(1);
    }
    expect(seen.size).toBe(sphere.length);
    const firstPiece = pieces[0]!;
    expect(Math.floor(firstPiece.xs[0]! / 32)).toBe(Math.floor(center.x / 32));
    expect(Math.floor(firstPiece.ys[0]! / 32)).toBe(Math.floor(center.y / 32));
    expect(Math.floor(firstPiece.zs[0]! / 32)).toBe(Math.floor(center.z / 32));
    console.log(`slicing test: ${pieces.length} pieces, ${(performance.now() - startedAt).toFixed(0)} ms`);
  });
});
