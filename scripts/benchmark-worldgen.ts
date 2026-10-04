// Steady-state world generation benchmark: every vertical chunk of a square area of game columns (through the
// worker's generateChunkColumn), generated in a fresh process (cold: includes world construction and JIT warmup) and
// then over a second, disjoint area (warm). `--profile` records every column as a profiled worker task, as the game's
// benchmark mode does. Also times the surface height sampler over a coarse grid. Usage:
//   bun scripts/benchmark-worldgen.ts [--seed N] [--size COLUMNS] [--height-samples N] [--profile]
// The game runs on V8, so also measure there (JavaScriptCore numbers differ a lot):
//   bun build scripts/benchmark-worldgen.ts --target=node --outfile <dir>/benchmark-worldgen.js
//   node <dir>/benchmark-worldgen.js [flags]      (add --cpu-prof --cpu-prof-dir=<dir> before the script to profile)

import { parseArgs } from "node:util";
import { CHUNK_HEIGHT } from "@/applications/game/config";
import { beginWorkerTask, finishWorkerTask } from "@/applications/game/profiler/worker-recorder";
import { generateChunkColumn } from "@/applications/game/workers/generation";
import { GAME_Y_OFFSET } from "@/applications/game/worldgen/constants";
import { createSurfaceHeightSampler } from "@/applications/game/worldgen/surface-height";

const MINECRAFT_MIN_Y = -64;
const MINECRAFT_MAX_Y = 319;
const LOWEST_CHUNK_Y = Math.floor((MINECRAFT_MIN_Y + GAME_Y_OFFSET) / CHUNK_HEIGHT);
const HIGHEST_CHUNK_Y = Math.floor((MINECRAFT_MAX_Y + GAME_Y_OFFSET) / CHUNK_HEIGHT);
const VERTICAL_CHUNKS_PER_COLUMN = HIGHEST_CHUNK_Y - LOWEST_CHUNK_Y + 1;
const WARM_AREA_DISTANCE_IN_COLUMNS = 64;
const HEIGHT_SAMPLE_SPACING_BLOCKS = 32;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const { values: flags } = parseArgs({
  options: {
    seed: { type: "string", default: "20240607" },
    size: { type: "string", default: "9" },
    "height-samples": { type: "string", default: "1024" },
    profile: { type: "boolean", default: false },
  },
});
const seed = Number(flags.seed);
const areaSize = Number(flags.size);
const heightSampleCount = Number(flags["height-samples"]);
const isProfiling = flags.profile === true;
const columnChunkYs = Array.from({ length: VERTICAL_CHUNKS_PER_COLUMN }, (_, index) => LOWEST_CHUNK_Y + index);

interface AreaTiming {
  totalMs: number;
  cpuMsPerChunk: number;
  msPerChunk: number;
  msPerColumn: number;
  slowestColumnMs: number;
}

function generateArea(cornerChunkX: number, cornerChunkZ: number): AreaTiming {
  const areaStartedAtMs = performance.now();
  const cpuAtStart = process.cpuUsage();
  let slowestColumnMs = 0;
  for (let offsetX = 0; offsetX < areaSize; offsetX++) {
    for (let offsetZ = 0; offsetZ < areaSize; offsetZ++) {
      const columnStartedAtMs = performance.now();
      beginWorkerTask(isProfiling);
      generateChunkColumn(seed, cornerChunkX + offsetX, cornerChunkZ + offsetZ, columnChunkYs);
      finishWorkerTask();
      slowestColumnMs = Math.max(slowestColumnMs, performance.now() - columnStartedAtMs);
    }
  }
  const totalMs = performance.now() - areaStartedAtMs;
  const cpuUsage = process.cpuUsage(cpuAtStart);
  const cpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
  const columnCount = areaSize * areaSize;
  return {
    totalMs,
    cpuMsPerChunk: cpuMs / (columnCount * VERTICAL_CHUNKS_PER_COLUMN),
    msPerChunk: totalMs / (columnCount * VERTICAL_CHUNKS_PER_COLUMN),
    msPerColumn: totalMs / columnCount,
    slowestColumnMs,
  };
}

function timeHeightSampler(cornerBlockX: number, cornerBlockZ: number): { totalMs: number; microsecondsPerSample: number } {
  const startedAtMs = performance.now();
  const sampleHeight = createSurfaceHeightSampler(seed);
  const samplesPerSide = Math.max(1, Math.round(Math.sqrt(heightSampleCount)));
  let checksum = 0;
  for (let sampleX = 0; sampleX < samplesPerSide; sampleX++) {
    for (let sampleZ = 0; sampleZ < samplesPerSide; sampleZ++) {
      checksum += sampleHeight(
        cornerBlockX + sampleX * HEIGHT_SAMPLE_SPACING_BLOCKS,
        cornerBlockZ + sampleZ * HEIGHT_SAMPLE_SPACING_BLOCKS,
      );
    }
  }
  const totalMs = performance.now() - startedAtMs;
  if (Number.isNaN(checksum)) throw new Error("Height sampler returned NaN");
  return { totalMs, microsecondsPerSample: (totalMs * 1000) / (samplesPerSide * samplesPerSide) };
}

function describeArea(name: string, timing: AreaTiming): string {
  return `${name}: ${timing.msPerChunk.toFixed(2)} ms/chunk (cpu ${timing.cpuMsPerChunk.toFixed(2)}), ${timing.msPerColumn.toFixed(0)} ms/column, slowest column ${timing.slowestColumnMs.toFixed(0)} ms, total ${(timing.totalMs / 1000).toFixed(1)} s`;
}

function describeMemory(): string {
  const usage = process.memoryUsage();
  return `heap ${(usage.heapUsed / BYTES_PER_MEGABYTE).toFixed(0)} MB, rss ${(usage.rss / BYTES_PER_MEGABYTE).toFixed(0)} MB`;
}

console.log(
  `Seed ${seed}, ${areaSize}x${areaSize} game columns, ${VERTICAL_CHUNKS_PER_COLUMN} vertical chunks each, profiling ${isProfiling ? "on" : "off"}`,
);
console.log(describeArea("cold", generateArea(0, 0)));
console.log(describeArea("warm", generateArea(WARM_AREA_DISTANCE_IN_COLUMNS, WARM_AREA_DISTANCE_IN_COLUMNS)));
console.log(describeMemory());
const coldHeights = timeHeightSampler(-50_000, -50_000);
const warmHeights = timeHeightSampler(50_000, 50_000);
console.log(
  `height sampler: cold ${coldHeights.microsecondsPerSample.toFixed(0)} us/sample, warm ${warmHeights.microsecondsPerSample.toFixed(0)} us/sample (${heightSampleCount} samples ${HEIGHT_SAMPLE_SPACING_BLOCKS} blocks apart)`,
);
console.log(describeMemory());
