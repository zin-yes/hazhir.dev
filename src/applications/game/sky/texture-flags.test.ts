import { describe, expect, test } from "bun:test";
import { TEXTURE_FLAG_WORD_COUNT, buildTextureFlagBits } from "./texture-flags";

function isSet(words: Int32Array, textureIndex: number): boolean {
  return ((words[Math.floor(textureIndex / 30)]! >> textureIndex % 30) & 1) === 1;
}

describe("buildTextureFlagBits", () => {
  const names = Array.from({ length: 200 }, (_, index) => `STONE_${index}`);
  names[3] = "LEAVES";
  names[31] = "LEAVES_BIRCH";
  names[177] = "LEAVES_AZALEA";
  names[178] = "TALL_GRASS";
  names[40] = "GLOWSTONE";
  names[61] = "LAVA";
  names[90] = "GLASS";
  names[150] = "BLUE_ICE";
  names[151] = "SLICE_OF_STONE";
  names[160] = "TORCH";
  names[161] = "LILY_PAD";
  names[162] = "TALL_GRASS_TOP";

  test("marks only the leaf textures as foliage, wherever they sit in the array", () => {
    const words = buildTextureFlagBits(names, "foliage");
    expect(words.length).toBe(TEXTURE_FLAG_WORD_COUNT);
    expect([3, 31, 177].every((index) => isSet(words, index))).toBe(true);
    expect([0, 2, 4, 30, 32, 176, 178].some((index) => isSet(words, index))).toBe(false);
  });

  test("keeps emissive, glass and glossy textures apart and matches whole names only", () => {
    expect([40, 61].every((index) => isSet(buildTextureFlagBits(names, "emissive"), index))).toBe(true);
    expect(isSet(buildTextureFlagBits(names, "emissive"), 90)).toBe(false);
    expect(isSet(buildTextureFlagBits(names, "glass"), 90)).toBe(true);
    expect(isSet(buildTextureFlagBits(names, "glossy"), 150)).toBe(true);
    expect(isSet(buildTextureFlagBits(names, "glossy"), 151)).toBe(false);
  });

  test("marks stiff and floating plants as windless but lets grass and flowers sway", () => {
    const words = buildTextureFlagBits(names, "windless");
    expect([160, 161].every((index) => isSet(words, index))).toBe(true);
    expect([178, 162, 3].some((index) => isSet(words, index))).toBe(false);
  });
});
