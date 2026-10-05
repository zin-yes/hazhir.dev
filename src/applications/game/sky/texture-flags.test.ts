import { describe, expect, test } from "bun:test";
import { FOLIAGE_WORD_COUNT, buildFoliageTextureBits } from "./foliage-textures";

function isSet(words: Int32Array, textureIndex: number): boolean {
  return ((words[Math.floor(textureIndex / 30)]! >> textureIndex % 30) & 1) === 1;
}

describe("buildFoliageTextureBits", () => {
  test("marks only the leaf textures, wherever they sit in the array", () => {
    const names = Array.from({ length: 200 }, (_, index) => `STONE_${index}`);
    names[3] = "LEAVES";
    names[31] = "LEAVES_BIRCH";
    names[177] = "LEAVES_AZALEA";
    names[178] = "TALL_GRASS";
    const words = buildFoliageTextureBits(names);
    expect(words.length).toBe(FOLIAGE_WORD_COUNT);
    expect([3, 31, 177].every((index) => isSet(words, index))).toBe(true);
    expect([0, 2, 4, 30, 32, 176, 178].some((index) => isSet(words, index))).toBe(false);
  });
});
