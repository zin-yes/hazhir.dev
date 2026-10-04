import { describe, expect, test } from "bun:test";
import { generateChunkColumn } from "@/applications/game/workers/generation";
import { getFullWorld } from "./overworld-world";

const SEED = 4242;
const AREA_SIDE_IN_GAME_COLUMNS = 5;
const MINECRAFT_COLUMNS_PER_GAME_COLUMN_SIDE = 2;
// A decorated column reads base terrain up to two Minecraft columns away on every side.
const BASE_COLUMN_READ_RADIUS = 2;
const ALLOWED_REBUILD_FACTOR = 1.1;
const SURFACE_CHUNK_YS = [1, 2, 3];

describe("base column reuse", () => {
  test("generating an area of game columns in raster order builds each base column about once", () => {
    const startedAtMs = performance.now();
    const generator = getFullWorld(SEED).generator;
    const buildsBefore = generator.baseColumnBuildCount;
    for (let gameX = 0; gameX < AREA_SIDE_IN_GAME_COLUMNS; gameX++) {
      for (let gameZ = 0; gameZ < AREA_SIDE_IN_GAME_COLUMNS; gameZ++) generateChunkColumn(SEED, gameX, gameZ, SURFACE_CHUNK_YS);
    }
    const builds = generator.baseColumnBuildCount - buildsBefore;
    const baseColumnsSide = AREA_SIDE_IN_GAME_COLUMNS * MINECRAFT_COLUMNS_PER_GAME_COLUMN_SIDE + 2 * BASE_COLUMN_READ_RADIUS;
    const distinctBaseColumns = baseColumnsSide * baseColumnsSide;
    console.log(`base column reuse took ${(performance.now() - startedAtMs).toFixed(0)} ms: ${builds} builds for ${distinctBaseColumns} columns`);
    expect(builds).toBeGreaterThanOrEqual(distinctBaseColumns);
    expect(builds).toBeLessThanOrEqual(distinctBaseColumns * ALLOWED_REBUILD_FACTOR);
  }, 300_000);
});
