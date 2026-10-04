// Headless worldgen probe: generates game columns per biome through the same entry the game worker uses
// (generateChunkBlocks), captures worker sections per column, and merges them into a Profiler so the standard
// snapshot, report and markdown pipeline applies. Per-column wall times are tracked independently of sections.

import { CHUNK_HEIGHT } from "@/applications/game/config";
import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import { Profiler } from "@/applications/game/profiler/profiler";
import type { ProfileSnapshot } from "@/applications/game/profiler/types";
import { ingestWorkerTask } from "@/applications/game/profiler/worker-task-ingest";
import { beginWorkerTask, finishWorkerTask, workerSection } from "@/applications/game/profiler/worker-recorder";
import { GAME_Y_OFFSET } from "../constants";
import { generateChunkBlocks } from "../chunk-generator";
import { getFullWorld } from "../overworld-world";
import {
  locateBiomes,
  type BiomeCoverage,
  type BiomeLocatorOptions,
  type BiomeLocatorResult,
  type BiomeRepresentative,
} from "./biome-locator";

export interface WorldgenProbeOptions {
  seed: number;
  /** Columns generated per biome, spread over that biome's representative spots. */
  columnsPerBiome: number;
  /** Throwaway columns generated before measuring so JIT compilation does not skew the first biome. */
  warmupColumns: number;
  /** Biome ids (`minecraft:plains`) or bare names (`plains`); defaults to an even spread over the located biomes. */
  biomes?: string[];
  /** Cap on biomes probed when `biomes` is not given; omit to probe every biome found. */
  maxBiomes?: number;
  /** Generate every vertical chunk of each game column (default). When false only the sea-level chunk is requested. */
  wholeGameChunks?: boolean;
  /** Evict the cached world before each biome so world construction is measured (reported as startup cost). */
  cold?: boolean;
  locator?: Pick<BiomeLocatorOptions, "radiusBlocks" | "stepBlocks" | "sampleMinecraftY" | "minimumSeparationBlocks">;
  onProgress?(event: WorldgenProbeProgress): void;
}

export type WorldgenProbeProgress =
  | { phase: "locate-done"; located: BiomeLocatorResult; locateMs: number }
  | { phase: "warmup-done"; warmupMs: number }
  | { phase: "biome-done"; biomeNumber: number; biomeCount: number; row: BiomeProbeRow };

export interface ProbedColumn {
  gameChunkX: number;
  gameChunkZ: number;
  wallMs: number;
  solidBlocks: number;
}

export interface BiomeProbeRow {
  rank: number;
  biome: string;
  coverageShare: number;
  columns: number;
  totalMs: number;
  meanMsPerColumn: number;
  p95MsPerColumn: number;
  msPerGameChunk: number;
  solidBlocksPerSecond: number;
  /** World construction time when cold, otherwise null. */
  startupMs: number | null;
  probedColumns: ProbedColumn[];
}

export interface WorldgenProbeResult {
  seed: number;
  cold: boolean;
  wholeGameChunks: boolean;
  rows: BiomeProbeRow[];
  locatedBiomeCount: number;
  missingBiomes: string[];
  unmatchedRequestedBiomes: string[];
  locateMs: number;
  warmupMs: number;
  wallClockMs: number;
  snapshot: ProfileSnapshot;
}

const PROBE_SECTION_NAME = "probe.column";
const PROBE_POOL_NAME = "generation";
const PROBE_METHOD_NAME = "generateChunk";
const CHUNKS_OUT_OF_WORLD_Y = 1000;
const WARMUP_AREA_CHUNK_OFFSET = 4000;
const CACHE_EVICTION_SEED_DISTANCE = 7919;
const REPRESENTATIVES_WANTED = 3;

export function runWorldgenProbe(options: WorldgenProbeOptions): WorldgenProbeResult {
  const probeStartedAtMs = performance.now();
  const wholeGameChunks = options.wholeGameChunks ?? true;
  const cold = options.cold ?? false;

  const locateStartedAtMs = performance.now();
  const located = locateBiomes({
    seed: options.seed,
    representativesPerBiome: Math.min(REPRESENTATIVES_WANTED, Math.max(1, options.columnsPerBiome)),
    ...options.locator,
  });
  const locateMs = performance.now() - locateStartedAtMs;
  options.onProgress?.({ phase: "locate-done", located, locateMs });

  const { selectedBiomes, unmatchedRequestedBiomes } = selectBiomes(located, options);
  const chunkYs = verticalChunkYs(options.seed, wholeGameChunks);

  const warmupStartedAtMs = performance.now();
  for (let warmupIndex = 0; warmupIndex < options.warmupColumns; warmupIndex++) {
    generateColumnChunks(options.seed, WARMUP_AREA_CHUNK_OFFSET + warmupIndex * 3, WARMUP_AREA_CHUNK_OFFSET, chunkYs);
  }
  const warmupMs = performance.now() - warmupStartedAtMs;
  options.onProgress?.({ phase: "warmup-done", warmupMs });

  const profileLabel = `worldgen-probe seed=${options.seed}${cold ? " cold" : " warm"}`;
  const profiler = new Profiler();
  profiler.setEnabled(true);
  profiler.reset(profileLabel);
  profiler.setSessionInfo({
    game: { seed: options.seed, columnsPerBiome: options.columnsPerBiome, cold: String(cold), biomes: selectedBiomes.length },
  });

  const unrankedRows: Omit<BiomeProbeRow, "rank">[] = [];
  let snapshot: ProfileSnapshot;
  try {
    selectedBiomes.forEach((coverage, biomeIndex) => {
      let startupMs: number | null = null;
      if (cold) startupMs = restartWorld(options.seed);
      const probedColumns = patchColumnSpots(coverage.representatives, options.columnsPerBiome).map((spot) =>
        profileColumn(profiler, options.seed, spot.gameChunkX, spot.gameChunkZ, coverage.biome, chunkYs),
      );
      const row = summarizeBiome(coverage, probedColumns, chunkYs.length, startupMs);
      unrankedRows.push(row);
      options.onProgress?.({
        phase: "biome-done",
        biomeNumber: biomeIndex + 1,
        biomeCount: selectedBiomes.length,
        row: { ...row, rank: 0 },
      });
    });
    snapshot = profiler.snapshot(profileLabel);
  } finally {
    profiler.setEnabled(false);
  }

  const rows = [...unrankedRows]
    .sort((left, right) => right.meanMsPerColumn - left.meanMsPerColumn)
    .map<BiomeProbeRow>((row, rankIndex) => ({ rank: rankIndex + 1, ...row }));

  return {
    seed: options.seed,
    cold,
    wholeGameChunks,
    rows,
    locatedBiomeCount: located.biomes.length,
    missingBiomes: located.missingBiomes,
    unmatchedRequestedBiomes,
    locateMs,
    warmupMs,
    wallClockMs: performance.now() - probeStartedAtMs,
    snapshot,
  };
}

function selectBiomes(located: BiomeLocatorResult, options: WorldgenProbeOptions) {
  const probeable = located.biomes.filter((coverage) => coverage.representatives.length > 0);
  if (options.biomes === undefined || options.biomes.length === 0) {
    return { selectedBiomes: evenlySpacedSubset(probeable, options.maxBiomes), unmatchedRequestedBiomes: [] };
  }
  const selectedBiomes: BiomeCoverage[] = [];
  const unmatchedRequestedBiomes: string[] = [];
  for (const requested of options.biomes) {
    const matching = probeable.find((coverage) => coverage.biome === requested || coverage.biome.endsWith(`:${requested}`));
    if (matching === undefined) unmatchedRequestedBiomes.push(requested);
    else if (!selectedBiomes.includes(matching)) selectedBiomes.push(matching);
  }
  return { selectedBiomes, unmatchedRequestedBiomes };
}

/** Keeps the list order but spans common and rare biomes alike when only `maxCount` fit. */
function evenlySpacedSubset<Item>(items: Item[], maxCount: number | undefined): Item[] {
  if (maxCount === undefined || maxCount >= items.length) return items;
  return Array.from({ length: maxCount }, (_, index) => items[Math.floor((index * items.length) / maxCount)]!);
}

function verticalChunkYs(seed: number, wholeGameChunks: boolean): number[] {
  const { minY, height, seaLevel } = getFullWorld(seed).generator.settings;
  if (!wholeGameChunks) return [Math.floor((seaLevel + GAME_Y_OFFSET) / CHUNK_HEIGHT)];
  const lowestChunkY = Math.floor((minY + GAME_Y_OFFSET) / CHUNK_HEIGHT);
  const highestChunkY = Math.floor((minY + height - 1 + GAME_Y_OFFSET) / CHUNK_HEIGHT);
  return Array.from({ length: highestChunkY - lowestChunkY + 1 }, (_, index) => lowestChunkY + index);
}

/**
 * Evicts the seed's cached world and chunk source by filling both bounded per-seed caches with other seeds, then
 * times rebuilding it. A chunk far above the world builds the source without generating terrain.
 */
function restartWorld(seed: number): number {
  generateChunkBlocks(seed + CACHE_EVICTION_SEED_DISTANCE, 0, CHUNKS_OUT_OF_WORLD_Y, 0);
  generateChunkBlocks(seed + CACHE_EVICTION_SEED_DISTANCE * 2, 0, CHUNKS_OUT_OF_WORLD_Y, 0);
  const rebuildStartedAtMs = performance.now();
  generateChunkBlocks(seed, 0, CHUNKS_OUT_OF_WORLD_Y, 0);
  return performance.now() - rebuildStartedAtMs;
}

function generateColumnChunks(seed: number, gameChunkX: number, gameChunkZ: number, chunkYs: number[]): Uint8Array[] {
  return chunkYs.map((chunkY) => generateChunkBlocks(seed, gameChunkX, chunkY, gameChunkZ));
}

function countSolidBlocks(chunks: Uint8Array[]): number {
  let solidBlocks = 0;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index++) if (chunk[index] !== 0) solidBlocks++;
  }
  return solidBlocks;
}

function profileColumn(
  profiler: Profiler,
  seed: number,
  gameChunkX: number,
  gameChunkZ: number,
  biome: string,
  chunkYs: number[],
): ProbedColumn {
  beginWorkerTask(true);
  const startedAtMs = performance.now();
  const chunks = workerSection(
    PROBE_SECTION_NAME,
    () => generateColumnChunks(seed, gameChunkX, gameChunkZ, chunkYs),
    DIMENSIONS.worldgenBiome,
    biome,
  );
  const completedAtMs = performance.now();
  const workerProfile = finishWorkerTask();
  const wallMs = completedAtMs - startedAtMs;
  const epochNowMs = performance.timeOrigin + completedAtMs;
  ingestWorkerTask(profiler, {
    poolName: PROBE_POOL_NAME,
    method: PROBE_METHOD_NAME,
    enqueuedAtMs: startedAtMs,
    dispatchedAtMs: startedAtMs,
    completedAtMs,
    postedToWorkerAtEpochMs: epochNowMs - wallMs,
    receivedFromWorkerAtEpochMs: epochNowMs,
    paramBytes: 0,
    resultBytes: chunks.reduce((byteTotal, chunk) => byteTotal + chunk.byteLength, 0),
    failed: false,
    queueDepthAtEnqueue: 0,
    workerProfile,
    workerResultPostMs: null,
  });
  return { gameChunkX, gameChunkZ, wallMs, solidBlocks: countSolidBlocks(chunks) };
}

/** Spreads the wanted column count over the representatives, each getting a compact patch around its spot. */
function patchColumnSpots(representatives: BiomeRepresentative[], columnCount: number) {
  const spots: { gameChunkX: number; gameChunkZ: number }[] = [];
  const usedRepresentatives = representatives.slice(0, Math.max(1, columnCount));
  usedRepresentatives.forEach((representative, representativeIndex) => {
    const columnsHere =
      Math.floor(columnCount / usedRepresentatives.length) +
      (representativeIndex < columnCount % usedRepresentatives.length ? 1 : 0);
    for (const [offsetX, offsetZ] of compactPatchOffsets(columnsHere)) {
      spots.push({ gameChunkX: representative.gameChunkX + offsetX, gameChunkZ: representative.gameChunkZ + offsetZ });
    }
  });
  return spots;
}

function compactPatchOffsets(count: number): [number, number][] {
  const reach = Math.ceil(Math.sqrt(count));
  const offsets: [number, number][] = [];
  for (let offsetX = -reach; offsetX <= reach; offsetX++) {
    for (let offsetZ = -reach; offsetZ <= reach; offsetZ++) offsets.push([offsetX, offsetZ]);
  }
  offsets.sort(
    ([leftX, leftZ], [rightX, rightZ]) =>
      Math.max(Math.abs(leftX), Math.abs(leftZ)) - Math.max(Math.abs(rightX), Math.abs(rightZ)) ||
      Math.abs(leftX) + Math.abs(leftZ) - (Math.abs(rightX) + Math.abs(rightZ)) ||
      leftX - rightX ||
      leftZ - rightZ,
  );
  return offsets.slice(0, count);
}

function nearestRankPercentile(sortedValues: number[], percentile: number): number {
  const rankIndex = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(percentile * sortedValues.length) - 1));
  return sortedValues[rankIndex]!;
}

function summarizeBiome(
  coverage: BiomeCoverage,
  probedColumns: ProbedColumn[],
  chunksPerColumn: number,
  startupMs: number | null,
): Omit<BiomeProbeRow, "rank"> {
  const wallTimes = probedColumns.map((column) => column.wallMs).sort((left, right) => left - right);
  const totalMs = wallTimes.reduce((sum, wallMs) => sum + wallMs, 0);
  const solidBlocks = probedColumns.reduce((sum, column) => sum + column.solidBlocks, 0);
  return {
    biome: coverage.biome,
    coverageShare: coverage.coverageShare,
    columns: probedColumns.length,
    totalMs,
    meanMsPerColumn: totalMs / probedColumns.length,
    p95MsPerColumn: nearestRankPercentile(wallTimes, 0.95),
    msPerGameChunk: totalMs / (probedColumns.length * chunksPerColumn),
    solidBlocksPerSecond: totalMs > 0 ? solidBlocks / (totalMs / 1000) : 0,
    startupMs,
    probedColumns,
  };
}
