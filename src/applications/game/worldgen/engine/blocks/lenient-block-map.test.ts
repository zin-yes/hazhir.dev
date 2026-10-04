import { afterAll, describe, expect, test } from "bun:test";
import { BlockType } from "../../../blocks";
import { getUnknownBlockStates, toGameBlockOrAir } from "./lenient-block-map";

const startedAtMs = performance.now();

describe("toGameBlockOrAir", () => {
  test("known states map like toGameBlock and are not reported", () => {
    expect(toGameBlockOrAir("minecraft:grass_block[snowy=true]")).toEqual({ gameBlock: BlockType.GRASS_SNOWY, isUnknown: false });
    expect(getUnknownBlockStates().has("minecraft:grass_block[snowy=true]")).toBe(false);
  });

  test("unknown and foreign names become air, are flagged and are remembered without throwing", () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      expect(toGameBlockOrAir("minecraft:definitely_not_a_block")).toEqual({ gameBlock: BlockType.AIR, isUnknown: true });
      expect(toGameBlockOrAir("terralith:volcanic_rock[lit=true]").isUnknown).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
    expect(getUnknownBlockStates().has("minecraft:definitely_not_a_block")).toBe(true);
    expect(getUnknownBlockStates().has("terralith:volcanic_rock[lit=true]")).toBe(true);
  });
});

afterAll(() => {
  console.log(`lenient-block-map.test.ts wall-clock: ${(performance.now() - startedAtMs).toFixed(0)} ms`);
});
