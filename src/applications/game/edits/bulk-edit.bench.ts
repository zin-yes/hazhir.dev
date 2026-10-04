/**
 * Microbenchmark of bulk block edits on generated terrain. Run it with:
 *
 *   bun run src/applications/game/edits/bulk-edit.bench.ts [--radii=4,8,16,32] [--repeats=15]
 *
 * Times only the CPU side: writing blocks and relighting (the remesh happens
 * elsewhere). The world is restored from a snapshot before every run, outside
 * the timer.
 */
import { BlockType } from "../blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";
import { relightAfterBlockChange } from "../light-engine";
import { generateChunkBlocks } from "../worldgen/chunk-generator";
import { findSpawnPoint } from "../worldgen/spawn-point";
import { applyBlockEdits, type BulkEditResult } from "./apply-block-edits";
import { sphereEdits } from "./block-edit-batch";
import {
  LightTestWorld,
  chunkName,
  lightWorldLikeTheGame,
} from "./light-test-world.test-helper";

const BENCH_SEED = 2024;
const DEFAULT_RADII = [4, 8, 16, 32];
const DEFAULT_REPEATS = 15;
const WARMUP_RUNS = 3;
const SINGLE_EDIT_COUNT = 400;
const FLOATING_HEIGHT = 12;

function readNumberListOption(name: string, fallback: number[]): number[] {
  const argument = process.argv.find((candidate) => candidate.startsWith(`--${name}=`));
  return argument
    ? argument.slice(name.length + 3).split(",").map(Number)
    : fallback;
}

function readNumberOption(name: string, fallback: number): number {
  return readNumberListOption(name, [fallback])[0];
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile95(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

interface TerrainFixture {
  world: LightTestWorld;
  center: { x: number; z: number };
  groundY: number;
  blockSnapshot: Map<string, Uint8Array>;
  lightSnapshot: Map<string, Uint8Array>;
}

function buildTerrainFixture(): TerrainFixture {
  const spawn = findSpawnPoint(BENCH_SEED);
  const centerChunkX = Math.floor(spawn.x / CHUNK_WIDTH);
  const centerChunkZ = Math.floor(spawn.z / CHUNK_LENGTH);
  const surfaceChunkY = Math.floor(spawn.y / CHUNK_HEIGHT);
  const world = new LightTestWorld();
  const generationStartedAtMs = performance.now();
  for (let chunkX = centerChunkX - 1; chunkX <= centerChunkX + 1; chunkX++) {
    for (let chunkZ = centerChunkZ - 1; chunkZ <= centerChunkZ + 1; chunkZ++) {
      for (let chunkY = surfaceChunkY - 2; chunkY <= surfaceChunkY + 2; chunkY++) {
        world.blocks.set(
          chunkName(chunkX, chunkY, chunkZ),
          generateChunkBlocks(BENCH_SEED, chunkX, chunkY, chunkZ),
        );
      }
    }
  }
  const generatedMs = performance.now() - generationStartedAtMs;

  const lightingStartedAtMs = performance.now();
  for (const [name, light] of lightWorldLikeTheGame(world)) {
    world.light.set(name, light);
  }
  console.log(
    `terrain: ${world.blocks.size} chunks generated in ${generatedMs.toFixed(0)} ms, lit in ${(performance.now() - lightingStartedAtMs).toFixed(0)} ms`,
  );

  const center = {
    x: centerChunkX * CHUNK_WIDTH + CHUNK_WIDTH / 2,
    z: centerChunkZ * CHUNK_LENGTH + CHUNK_LENGTH / 2,
  };
  let groundY = (surfaceChunkY + 2) * CHUNK_HEIGHT - 1;
  while (world.blockAt(center.x, groundY, center.z) === BlockType.AIR) groundY--;
  return {
    world,
    center,
    groundY,
    blockSnapshot: world.snapshotBlocks(),
    lightSnapshot: world.snapshotLight(),
  };
}

function restoreWorld(fixture: TerrainFixture) {
  for (const [name, blocks] of fixture.blockSnapshot) {
    fixture.world.blocks.get(name)!.set(blocks);
  }
  for (const [name, light] of fixture.lightSnapshot) {
    fixture.world.light.get(name)!.set(light);
  }
}

interface Measurement {
  label: string;
  millisecondsMedian: number;
  millisecondsP95: number;
  millisecondsMin: number;
  result: BulkEditResult;
}

function measureBrush(
  fixture: TerrainFixture,
  label: string,
  repeats: number,
  makeEdit: () => ReturnType<typeof sphereEdits>,
): Measurement {
  const timings: number[] = [];
  let lastResult!: BulkEditResult;
  for (let run = -WARMUP_RUNS; run < repeats; run++) {
    restoreWorld(fixture);
    const batch = makeEdit();
    const startedAtMs = performance.now();
    lastResult = applyBlockEdits(fixture.world, batch, { recordChanges: false });
    const elapsedMs = performance.now() - startedAtMs;
    if (run >= 0) timings.push(elapsedMs);
  }
  return {
    label,
    millisecondsMedian: median(timings),
    millisecondsP95: percentile95(timings),
    millisecondsMin: Math.min(...timings),
    result: lastResult,
  };
}

function printMeasurement(measurement: Measurement) {
  const { stats } = measurement.result;
  console.log(
    [
      measurement.label.padEnd(26),
      `median ${measurement.millisecondsMedian.toFixed(2).padStart(7)} ms`,
      `p95 ${measurement.millisecondsP95.toFixed(2).padStart(7)} ms`,
      `min ${measurement.millisecondsMin.toFixed(2).padStart(7)} ms`,
      `blocks ${String(stats.blocksChanged).padStart(6)}`,
      `lit ${String(stats.cellsLit).padStart(7)}`,
      `removed ${String(stats.cellsRemoved).padStart(7)}`,
      `remesh ${String(measurement.result.chunksToRemesh.length).padStart(3)}`,
      `(write ${stats.millisecondsWritingBlocks.toFixed(2)} remove ${stats.millisecondsRemovingLight.toFixed(2)} refill ${stats.millisecondsRefillingLight.toFixed(2)} collect ${stats.millisecondsCollecting.toFixed(2)})`,
    ].join("  "),
  );
}

function measureSingleEdits(fixture: TerrainFixture) {
  const timings: number[] = [];
  const random = (() => {
    let state = 12345;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  })();
  restoreWorld(fixture);
  for (let edit = -50; edit < SINGLE_EDIT_COUNT; edit++) {
    const x = fixture.center.x + Math.floor(random() * 40) - 20;
    const z = fixture.center.z + Math.floor(random() * 40) - 20;
    const y = fixture.groundY + Math.floor(random() * 8) - 4;
    const newBlock = edit % 2 === 0 ? BlockType.STONE : BlockType.AIR;
    const oldBlock = fixture.world.setBlockAt(x, y, z, newBlock);
    const startedAtMs = performance.now();
    relightAfterBlockChange(fixture.world, x, y, z, oldBlock);
    if (edit >= 0) timings.push(performance.now() - startedAtMs);
  }
  console.log(
    `single block edit (relightAfterBlockChange) x${timings.length}: median ${(median(timings) * 1000).toFixed(1)} us, p95 ${(percentile95(timings) * 1000).toFixed(1)} us`,
  );
}

const radii = readNumberListOption("radii", DEFAULT_RADII);
const repeats = readNumberOption("repeats", DEFAULT_REPEATS);
const fixture = buildTerrainFixture();
console.log(
  `brush center column (${fixture.center.x}, ${fixture.center.z}), ground at y=${fixture.groundY}, ${repeats} runs each after ${WARMUP_RUNS} warmups\n`,
);

for (const radius of radii) {
  const runs = radius >= 32 ? Math.max(3, Math.floor(repeats / 2)) : repeats;
  printMeasurement(
    measureBrush(fixture, `r=${radius} place stone`, runs, () =>
      sphereEdits(
        { x: fixture.center.x, y: fixture.groundY + Math.floor(radius / 2), z: fixture.center.z },
        radius,
        BlockType.STONE,
        "fill",
      ),
    ),
  );
  printMeasurement(
    measureBrush(fixture, `r=${radius} place floating`, runs, () =>
      sphereEdits(
        { x: fixture.center.x, y: fixture.groundY + radius + FLOATING_HEIGHT, z: fixture.center.z },
        radius,
        BlockType.STONE,
        "fill",
      ),
    ),
  );
  printMeasurement(
    measureBrush(fixture, `r=${radius} erase (dig)`, runs, () =>
      sphereEdits(
        { x: fixture.center.x, y: fixture.groundY, z: fixture.center.z },
        radius,
        BlockType.AIR,
        "erase",
      ),
    ),
  );
}
console.log();
measureSingleEdits(fixture);
