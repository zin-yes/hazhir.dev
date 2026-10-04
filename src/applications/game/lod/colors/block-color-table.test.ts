import { describe, expect, test } from "bun:test";
import { BlockType } from "../../blocks";
import { sideColorOfBlock, topColorOfBlock, WATER_SURFACE_COLOR } from "./block-color-table";
import { computeTextureAverageColors } from "./generate-block-colors";
import { TEXTURE_AVERAGE_COLORS } from "./texture-average-colors.generated";

const red = (color: number) => (color >> 16) & 0xff;
const green = (color: number) => (color >> 8) & 0xff;
const blue = (color: number) => color & 0xff;

describe("block colour table", () => {
  test("the committed table matches the textures in public/game", () => {
    const startedAt = performance.now();
    expect(computeTextureAverageColors()).toEqual({ ...TEXTURE_AVERAGE_COLORS });
    console.log(`texture table regeneration ${(performance.now() - startedAt).toFixed(1)} ms`);
  });

  test("grass uses its green top texture on top and the dirt-edged side texture on walls", () => {
    const grassTop = topColorOfBlock(BlockType.GRASS);
    const grassSide = sideColorOfBlock(BlockType.GRASS);
    expect(green(grassTop)).toBeGreaterThan(red(grassTop));
    expect(grassTop).not.toBe(grassSide);
    expect(topColorOfBlock(BlockType.GRASS_SNOWY)).not.toBe(grassTop);
  });

  test("water is blue and snow is near white", () => {
    expect(blue(WATER_SURFACE_COLOR)).toBeGreaterThan(red(WATER_SURFACE_COLOR));
    const snow = topColorOfBlock(BlockType.SNOW_BLOCK);
    expect(Math.min(red(snow), green(snow), blue(snow))).toBeGreaterThan(200);
  });
});
