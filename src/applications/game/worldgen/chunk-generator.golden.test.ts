// Golden-output regression test: worldgen must stay byte-identical for a given seed. Every game chunk of the listed
// columns, the decorated engine columns behind them (block state strings) and the surface height sampler are hashed and
// compared with `fixtures/golden-chunks.json`. The default run covers the `default` set; `GOLDEN_FULL=1` adds the
// `full` set. `GOLDEN_UPDATE=1` rewrites the fixture from the current code (only ever from a known-correct commit).

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { generateChunkBlocks } from "./chunk-generator";
import { CHUNK_COLUMN_SIZE } from "./engine/chunk";
import { getFullWorld } from "./overworld-world";
import { findSpawnPoint, type SpawnPoint } from "./spawn-point";
import { createSurfaceHeightSampler } from "./surface-height";

type GoldenSet = "default" | "full";

interface GoldenColumnRequest {
  set: GoldenSet;
  seed: number;
  chunkX: number;
  chunkZ: number;
  label: string;
}

interface GoldenColumn extends GoldenColumnRequest {
  /** xxHash64 of every vertical game chunk, from the lowest chunk y upwards. */
  gameChunkHashes: string[];
  /** xxHash64 of each decorated engine column (block state strings), in x-major order. */
  engineColumnHashes: string[];
  /** createSurfaceHeightSampler at the column's corners and centre. */
  surfaceHeights: number[];
}

interface GoldenFixture {
  lowestChunkY: number;
  highestChunkY: number;
  columns: GoldenColumn[];
  spawnPoints: Record<string, SpawnPoint>;
}

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "golden-chunks.json");
const LOWEST_CHUNK_Y = -2;
const HIGHEST_CHUNK_Y = 10;
const IS_FULL_RUN = process.env.GOLDEN_FULL === "1";
const IS_UPDATE_RUN = process.env.GOLDEN_UPDATE === "1";
const ENGINE_COLUMNS_PER_GAME_CHUNK_X = CHUNK_WIDTH / CHUNK_COLUMN_SIZE;
const ENGINE_COLUMNS_PER_GAME_CHUNK_Z = CHUNK_LENGTH / CHUNK_COLUMN_SIZE;
const SURFACE_SAMPLE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [CHUNK_WIDTH - 1, 0],
  [0, CHUNK_LENGTH - 1],
  [CHUNK_WIDTH - 1, CHUNK_LENGTH - 1],
  [CHUNK_WIDTH / 2, CHUNK_LENGTH / 2],
];

function clusterOf(set: GoldenSet, seed: number, cornerX: number, cornerZ: number, size: number, label: string): GoldenColumnRequest[] {
  const columns: GoldenColumnRequest[] = [];
  for (let offsetX = 0; offsetX < size; offsetX++) {
    for (let offsetZ = 0; offsetZ < size; offsetZ++) {
      columns.push({ set, seed, chunkX: cornerX + offsetX, chunkZ: cornerZ + offsetZ, label: `${label} ${offsetX},${offsetZ}` });
    }
  }
  return columns;
}

const GOLDEN_COLUMN_REQUESTS: GoldenColumnRequest[] = [
  ...clusterOf("default", 20240607, 0, 0, 2, "origin cluster"),
  { set: "default", seed: 20240607, chunkX: -31, chunkZ: -99, label: "desert" },
  { set: "default", seed: 20240607, chunkX: -23, chunkZ: 41, label: "mangrove swamp" },
  { set: "default", seed: 20240607, chunkX: -59, chunkZ: 5, label: "windswept hills" },
  { set: "default", seed: 20240607, chunkX: -15, chunkZ: -15, label: "deep ocean" },
  { set: "default", seed: 20240607, chunkX: 1, chunkZ: 101, label: "savanna badlands" },
  { set: "default", seed: 2024, chunkX: 29, chunkZ: -31, label: "badlands" },
  { set: "default", seed: 2024, chunkX: -75, chunkZ: 41, label: "yellowstone" },
  { set: "default", seed: 777, chunkX: -11, chunkZ: 13, label: "frozen peaks" },
  { set: "default", seed: 777, chunkX: -75, chunkZ: -115, label: "mushroom fields" },
  { set: "full", seed: 20240607, chunkX: 45, chunkZ: 57, label: "lush caves" },
  { set: "full", seed: 20240607, chunkX: 41, chunkZ: -47, label: "ice spikes" },
  { set: "full", seed: 20240607, chunkX: -47, chunkZ: 93, label: "jungle" },
  { set: "full", seed: 20240607, chunkX: -115, chunkZ: 109, label: "swamp" },
  { set: "full", seed: 20240607, chunkX: 105, chunkZ: -103, label: "snowy taiga" },
  { set: "full", seed: 20240607, chunkX: 93, chunkZ: 53, label: "warm ocean" },
  { set: "full", seed: 20240607, chunkX: 81, chunkZ: -47, label: "frozen ocean" },
  { set: "full", seed: 20240607, chunkX: 65, chunkZ: -83, label: "dripstone caves" },
  { set: "full", seed: 20240607, chunkX: -59, chunkZ: 45, label: "alpha islands" },
  { set: "full", seed: 20240607, chunkX: 13, chunkZ: -95, label: "skylands spring" },
  { set: "full", seed: 20240607, chunkX: 117, chunkZ: 61, label: "bryce canyon" },
  { set: "full", seed: 20240607, chunkX: 65, chunkZ: 69, label: "tropical jungle" },
  { set: "full", seed: 20240607, chunkX: 57, chunkZ: 97, label: "dark forest" },
  { set: "full", seed: 2024, chunkX: -71, chunkZ: 17, label: "cherry grove" },
  { set: "full", seed: 2024, chunkX: -103, chunkZ: -119, label: "volcanic crater" },
  { set: "full", seed: 2024, chunkX: 49, chunkZ: 49, label: "granite caves" },
  { set: "full", seed: 2024, chunkX: 1, chunkZ: 1, label: "mangrove swamp" },
  ...clusterOf("full", 2024, 8, -8, 3, "desert cluster"),
  { set: "full", seed: 777, chunkX: -103, chunkZ: 33, label: "stony peaks" },
  { set: "full", seed: 777, chunkX: 89, chunkZ: -63, label: "volcanic peaks" },
  { set: "full", seed: 777, chunkX: 113, chunkZ: 89, label: "amethyst canyon" },
  { set: "full", seed: 777, chunkX: -47, chunkZ: 61, label: "dark forest" },
  { set: "full", seed: 777, chunkX: 53, chunkZ: -11, label: "warped mesa" },
];
const GOLDEN_SEEDS = [...new Set(GOLDEN_COLUMN_REQUESTS.map((request) => request.seed))];

function hashBytes(bytes: Uint8Array | Uint32Array): string {
  return Bun.hash.xxHash64(bytes).toString(16).padStart(16, "0");
}

function hashGameChunks(request: GoldenColumnRequest): string[] {
  const hashes: string[] = [];
  for (let chunkY = LOWEST_CHUNK_Y; chunkY <= HIGHEST_CHUNK_Y; chunkY++) {
    hashes.push(hashBytes(generateChunkBlocks(request.seed, request.chunkX, chunkY, request.chunkZ)));
  }
  return hashes;
}

function hashEngineColumns(request: GoldenColumnRequest): string[] {
  const world = getFullWorld(request.seed);
  const hashes: string[] = [];
  for (let offsetX = 0; offsetX < ENGINE_COLUMNS_PER_GAME_CHUNK_X; offsetX++) {
    for (let offsetZ = 0; offsetZ < ENGINE_COLUMNS_PER_GAME_CHUNK_Z; offsetZ++) {
      const column = world.generateDecoratedColumn(
        request.chunkX * ENGINE_COLUMNS_PER_GAME_CHUNK_X + offsetX,
        request.chunkZ * ENGINE_COLUMNS_PER_GAME_CHUNK_Z + offsetZ,
      );
      const stateHashByPaletteId = new Uint32Array(column.palette.size);
      for (let paletteId = 0; paletteId < column.palette.size; paletteId++) {
        stateHashByPaletteId[paletteId] = Bun.hash.crc32(column.palette.stateOf(paletteId));
      }
      const stateHashes = new Uint32Array(column.blocks.length);
      for (let index = 0; index < column.blocks.length; index++) stateHashes[index] = stateHashByPaletteId[column.blocks[index]!]!;
      hashes.push(hashBytes(stateHashes));
    }
  }
  return hashes;
}

function sampleSurfaceHeights(request: GoldenColumnRequest): number[] {
  const sampleHeight = createSurfaceHeightSampler(request.seed);
  return SURFACE_SAMPLE_OFFSETS.map(([offsetX, offsetZ]) =>
    sampleHeight(request.chunkX * CHUNK_WIDTH + offsetX, request.chunkZ * CHUNK_LENGTH + offsetZ),
  );
}

function computeGoldenColumn(request: GoldenColumnRequest): GoldenColumn {
  return {
    ...request,
    gameChunkHashes: hashGameChunks(request),
    engineColumnHashes: hashEngineColumns(request),
    surfaceHeights: sampleSurfaceHeights(request),
  };
}

function readFixture(): GoldenFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as GoldenFixture;
}

function writeFixture(): void {
  const columns = GOLDEN_COLUMN_REQUESTS.map(computeGoldenColumn);
  const spawnPoints = Object.fromEntries(GOLDEN_SEEDS.map((seed) => [String(seed), findSpawnPoint(seed)]));
  const fixture: GoldenFixture = { lowestChunkY: LOWEST_CHUNK_Y, highestChunkY: HIGHEST_CHUNK_Y, columns, spawnPoints };
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 1)}\n`);
}

const testStartedAtMs = performance.now();

describe("worldgen golden output", () => {
  if (IS_UPDATE_RUN) {
    test("rewrites the golden fixture", () => {
      writeFixture();
      expect(existsSync(FIXTURE_PATH)).toBe(true);
    }, 3_600_000);
    return;
  }

  const fixture = readFixture();
  const expectedColumns = fixture.columns.filter((column) => IS_FULL_RUN || column.set === "default");

  test("the fixture covers every requested column", () => {
    expect(fixture.columns.map((column) => `${column.seed}:${column.chunkX},${column.chunkZ}`)).toEqual(
      GOLDEN_COLUMN_REQUESTS.map((request) => `${request.seed}:${request.chunkX},${request.chunkZ}`),
    );
  });

  for (const expected of expectedColumns) {
    test(`seed ${expected.seed} column ${expected.chunkX},${expected.chunkZ} (${expected.label}) is unchanged`, () => {
      const columnStartedAtMs = performance.now();
      const actual = computeGoldenColumn(expected);
      expect(actual.gameChunkHashes).toEqual(expected.gameChunkHashes);
      expect(actual.engineColumnHashes).toEqual(expected.engineColumnHashes);
      expect(actual.surfaceHeights).toEqual(expected.surfaceHeights);
      console.log(`golden ${expected.label} took ${(performance.now() - columnStartedAtMs).toFixed(0)} ms`);
    }, 600_000);
  }

  test("chunks above and below the world are empty", () => {
    const [firstColumn] = expectedColumns;
    for (const chunkY of [fixture.lowestChunkY - 1, fixture.highestChunkY + 1]) {
      const blocks = generateChunkBlocks(firstColumn!.seed, firstColumn!.chunkX, chunkY, firstColumn!.chunkZ);
      expect(blocks.some((block) => block !== 0)).toBe(false);
    }
  });

  test("spawn points are unchanged", () => {
    for (const seed of GOLDEN_SEEDS) expect(findSpawnPoint(seed)).toEqual(fixture.spawnPoints[String(seed)]!);
  }, 600_000);
});

afterAll(() => {
  console.log(`chunk-generator.golden.test.ts took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
});
