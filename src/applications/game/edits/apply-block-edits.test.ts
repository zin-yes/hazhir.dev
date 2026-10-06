import { describe, expect, test } from "bun:test";
import { BlockType } from "../blocks";
import { DIMENSIONS } from "../profiler/dimensions";
import {
  breakdownUnits,
  counterTotal,
  gaugeMax,
  withEnabledProfiler,
} from "../world/profiler-readings.test-helper";
import {
  beginWorkerTask,
  finishWorkerTask,
} from "../profiler/worker-recorder";
import {
  applyBlockEdits,
  relightAfterBlocksWritten,
  type BulkEditResult,
} from "./apply-block-edits";
import {
  BlockEditBatch,
  boxEdits,
  sphereEdits,
  type BrushMode,
} from "./block-edit-batch";
import {
  BOUNDARY_FACES,
  CELLS_PER_CHUNK,
  CHUNK_MASK,
  CHUNK_SHIFT,
  DIRECTION_OFFSET_X,
  DIRECTION_OFFSET_Y,
  DIRECTION_OFFSET_Z,
} from "./chunk-cluster";
import {
  LightTestWorld,
  chunkName,
  createSeededRandom,
  createTerrainWorld,
  expectLightMatches,
  floodLightFromScratch,
} from "./light-test-world.test-helper";

const CHUNK_SIZE = CHUNK_MASK + 1;

const PAINT_BLOCKS = [
  BlockType.STONE,
  BlockType.GLOWSTONE,
  BlockType.WATER,
  BlockType.GLASS,
  BlockType.LEAVES,
  BlockType.TORCH,
  BlockType.LAVA,
  BlockType.MAGMA,
];

const BRUSH_MODES: BrushMode[] = [
  "fill",
  "erase",
  "erase",
  "fillAirOnly",
  "replaceNonAirOnly",
];

function smallWorld(seed: number) {
  return createTerrainWorld({
    seed,
    chunkXRange: [-1, 0],
    chunkYRange: [3, 4],
    chunkZRange: [-1, 0],
  });
}

function chunkNames(chunks: { x: number; y: number; z: number }[]) {
  return new Set(chunks.map((chunk) => chunkName(chunk.x, chunk.y, chunk.z)));
}

/**
 * Every chunk whose mesh inputs differ between the two snapshots: the chunk
 * itself, and the neighbor across each face where a border layer cell differs.
 */
function chunksWithChangedMeshInputs(
  world: LightTestWorld,
  lightBefore: Map<string, Uint8Array>,
  blocksBefore: Map<string, Uint8Array>,
): Set<string> {
  const required = new Set<string>();
  for (const [name, light] of world.light) {
    const blocks = world.blocks.get(name)!;
    const previousLight = lightBefore.get(name)!;
    const previousBlocks = blocksBefore.get(name)!;
    const [chunkX, chunkY, chunkZ] = name.split(",").map(Number);
    for (let index = 0; index < CELLS_PER_CHUNK; index++) {
      if (light[index] === previousLight[index] && blocks[index] === previousBlocks[index]) {
        continue;
      }
      required.add(name);
      const faces = BOUNDARY_FACES[index];
      for (let direction = 0; direction < 6; direction++) {
        if ((faces & (1 << direction)) === 0) continue;
        const neighborName = chunkName(
          chunkX + DIRECTION_OFFSET_X[direction],
          chunkY + DIRECTION_OFFSET_Y[direction],
          chunkZ + DIRECTION_OFFSET_Z[direction],
        );
        if (world.light.has(neighborName)) required.add(neighborName);
      }
    }
  }
  return required;
}

function applyAndVerify(
  world: LightTestWorld,
  batch: BlockEditBatch,
  label: string,
): BulkEditResult {
  const lightBefore = world.snapshotLight();
  const blocksBefore = world.snapshotBlocks();
  const result = applyBlockEdits(world, batch);

  expectLightMatches(world, floodLightFromScratch(world), label);

  const remeshNames = chunkNames(result.chunksToRemesh);
  for (const required of chunksWithChangedMeshInputs(world, lightBefore, blocksBefore)) {
    if (!remeshNames.has(required)) {
      throw new Error(`${label} chunk ${required} changed but is not in chunksToRemesh`);
    }
  }
  return result;
}

function randomCenter(
  random: () => number,
  world: LightTestWorld,
): { x: number; y: number; z: number } {
  const names = Array.from(world.blocks.keys()).map((name) => name.split(",").map(Number));
  const low = [0, 1, 2].map((axis) => Math.min(...names.map((name) => name[axis])) * CHUNK_SIZE);
  const high = [0, 1, 2].map((axis) => (Math.max(...names.map((name) => name[axis])) + 1) * CHUNK_SIZE);
  // Half the centers sit on a chunk border so edits straddle it.
  const pick = (axis: number) => {
    const span = high[axis] - low[axis];
    if (random() < 0.5) return low[axis] + Math.floor(random() * span);
    const borderCount = span / CHUNK_SIZE - 1;
    return low[axis] + (1 + Math.floor(random() * borderCount)) * CHUNK_SIZE - 1 + Math.floor(random() * 2);
  };
  return { x: pick(0), y: pick(1), z: pick(2) };
}

describe("applyBlockEdits against a from-scratch relight", () => {
  test("sphere brushes of every mode match, across chunk borders and the column top", () => {
    let totalBlocksChanged = 0;
    for (const worldSeed of [3, 17]) {
      const world = smallWorld(worldSeed);
      const random = createSeededRandom(worldSeed * 101);
      for (let trial = 0; trial < 14; trial++) {
        const radius = 1 + Math.floor(random() * 11);
        const mode = BRUSH_MODES[Math.floor(random() * BRUSH_MODES.length)];
        const block = PAINT_BLOCKS[Math.floor(random() * PAINT_BLOCKS.length)];
        const batch = sphereEdits(randomCenter(random, world), radius, block, mode);
        const result = applyAndVerify(world, batch, `seed ${worldSeed} trial ${trial} ${mode} r${radius}`);
        totalBlocksChanged += result.stats.blocksChanged;
      }
    }
    expect(totalBlocksChanged).toBeGreaterThan(2000);
  });

  test("cube brushes match", () => {
    const world = smallWorld(5);
    const random = createSeededRandom(77);
    let totalBlocksChanged = 0;
    for (let trial = 0; trial < 10; trial++) {
      const corner = randomCenter(random, world);
      const opposite = {
        x: corner.x + Math.floor(random() * 14) - 4,
        y: corner.y + Math.floor(random() * 14) - 4,
        z: corner.z + Math.floor(random() * 14) - 4,
      };
      const mode = BRUSH_MODES[Math.floor(random() * BRUSH_MODES.length)];
      const block = PAINT_BLOCKS[Math.floor(random() * PAINT_BLOCKS.length)];
      const result = applyAndVerify(world, boxEdits(corner, opposite, block, mode), `cube trial ${trial} ${mode}`);
      totalBlocksChanged += result.stats.blocksChanged;
    }
    expect(totalBlocksChanged).toBeGreaterThan(500);
  });

  test("random scattered edits, with cells edited more than once, match", () => {
    const world = smallWorld(9);
    const random = createSeededRandom(4242);
    const names = Array.from(world.blocks.keys());
    expect(names.length).toBe(8);
    const blockChoices = [...PAINT_BLOCKS, BlockType.AIR, BlockType.AIR, BlockType.AIR];
    for (let trial = 0; trial < 8; trial++) {
      const batch = new BlockEditBatch();
      const centerX = Math.floor(random() * 64) - 32;
      const centerY = 96 + Math.floor(random() * 64);
      const centerZ = Math.floor(random() * 64) - 32;
      for (let edit = 0; edit < 400; edit++) {
        batch.push(
          centerX + Math.floor(random() * 20) - 10,
          centerY + Math.floor(random() * 20) - 10,
          centerZ + Math.floor(random() * 20) - 10,
          blockChoices[Math.floor(random() * blockChoices.length)],
        );
      }
      // The same cell written twice in one batch must end as its last write.
      batch.push(centerX, centerY, centerZ, BlockType.STONE);
      batch.push(centerX, centerY, centerZ, BlockType.AIR);
      const result = applyAndVerify(world, batch, `scatter trial ${trial}`);
      expect(result.stats.blocksChanged).toBeGreaterThan(50);
    }
  });

  test("tunnels and glowstone: carving a shaft into a lit cave and sealing it again", () => {
    const world = smallWorld(21);
    const center = { x: -10, y: 120, z: -12 };
    applyAndVerify(world, boxEdits({ x: -12, y: 118, z: -14 }, { x: -8, y: 122, z: -10 }, BlockType.AIR, "erase"), "carve cave");
    applyAndVerify(world, boxEdits({ x: -11, y: 119, z: -13 }, { x: -9, y: 121, z: -11 }, BlockType.GLOWSTONE, "fill"), "lamp");
    applyAndVerify(world, sphereEdits(center, 6, BlockType.AIR, "erase"), "open up");
    applyAndVerify(world, sphereEdits(center, 9, BlockType.STONE, "fill"), "seal");
    applyAndVerify(world, sphereEdits(center, 9, BlockType.STONE, "erase"), "dig out");
  });

  test("a dimmer glowing block inside the light of a brighter one shines again when the brighter one is removed", () => {
    const world = smallWorld(30);
    const caveY = 4 * CHUNK_SIZE + 2;
    applyAndVerify(world, boxEdits({ x: -12, y: caveY - 1, z: -12 }, { x: 2, y: caveY + 3, z: 2 }, BlockType.AIR, "erase"), "carve");
    applyAndVerify(world, boxEdits({ x: -6, y: caveY, z: -6 }, { x: -6, y: caveY, z: -6 }, BlockType.GLOWSTONE, "fill"), "bright");
    applyAndVerify(world, boxEdits({ x: -4, y: caveY, z: -6 }, { x: -4, y: caveY, z: -6 }, BlockType.MAGMA, "fill"), "dim");
    expect(world.lightAt(-4, caveY, -6) & 0xf).toBe(8);

    applyAndVerify(world, boxEdits({ x: -6, y: caveY, z: -6 }, { x: -6, y: caveY, z: -6 }, BlockType.AIR, "erase"), "remove bright");
    expect(world.lightAt(-4, caveY, -6) & 0xf).toBe(8);
    expect(world.lightAt(-3, caveY, -6) & 0xf).toBe(7);
    expect(world.lightAt(-5, caveY, -6) & 0xf).toBe(7);
  });

  test("a sphere placed over open ground shades the sky light below it and erasing it brings it back", () => {
    const world = smallWorld(33);
    const skyLightAt = (x: number, y: number, z: number) => world.lightAt(x, y, z) >> 4;
    const topY = 5 * CHUNK_SIZE - 1;
    const airAboveGround = (x: number, z: number) => {
      for (let y = topY; y > 4 * CHUNK_SIZE; y--) {
        if (world.blockAt(x, y, z) !== BlockType.AIR) return y + 1;
      }
      return 4 * CHUNK_SIZE;
    };
    const groundY = airAboveGround(-8, -8);
    const litBefore = skyLightAt(-8, groundY, -8);
    expect(litBefore).toBe(15);

    applyAndVerify(world, sphereEdits({ x: -8, y: groundY + 6, z: -8 }, 8, BlockType.STONE, "fill"), "shade");
    expect(skyLightAt(-8, groundY, -8)).toBeLessThan(15);

    applyAndVerify(world, sphereEdits({ x: -8, y: groundY + 6, z: -8 }, 8, BlockType.STONE, "erase"), "unshade");
    expect(skyLightAt(-8, groundY, -8)).toBe(15);
  });

  test("edits in the top layer of the topmost chunk keep the sky above it open", () => {
    const world = createTerrainWorld({
      seed: 8,
      chunkXRange: [-1, 0],
      chunkYRange: [3, 4],
      chunkZRange: [-1, 0],
      mountainShare: 1,
    });
    const topLayerY = 5 * CHUNK_SIZE - 1;
    applyAndVerify(world, boxEdits({ x: -20, y: topLayerY - 3, z: -20 }, { x: -5, y: topLayerY, z: -5 }, BlockType.STONE, "fill"), "cap");
    applyAndVerify(world, sphereEdits({ x: -12, y: topLayerY, z: -12 }, 7, BlockType.AIR, "erase"), "open the cap");
    applyAndVerify(world, sphereEdits({ x: -3, y: topLayerY, z: -3 }, 5, BlockType.GLOWSTONE, "fill"), "lamp on top");
  });

  test("the lower chunk becomes the top of its column when the chunk above it is unloaded", () => {
    const world = smallWorld(12);
    world.unloadChunk(-1, 4, -1);
    world.relightFromScratch();
    applyAndVerify(world, sphereEdits({ x: -20, y: 4 * CHUNK_SIZE + 30, z: -20 }, 6, BlockType.STONE, "fill"), "cap below hole");
    applyAndVerify(world, sphereEdits({ x: -20, y: 4 * CHUNK_SIZE + 30, z: -20 }, 6, BlockType.STONE, "erase"), "dig below hole");
  });

  test("edits beside an unloaded chunk leave it alone and edits inside it are skipped and counted", () => {
    const world = smallWorld(14);
    world.unloadChunk(0, 3, 0);
    world.relightFromScratch();
    const blocksBefore = world.snapshotBlocks();
    const center = { x: 31, y: 3 * CHUNK_SIZE + 10, z: 31 };
    const result = applyAndVerify(world, sphereEdits(center, 7, BlockType.AIR, "erase"), "beside hole");

    expect(world.getBlocks(0, 3, 0)).toBeUndefined();
    expect(result.stats.editsInUnloadedChunks).toBeGreaterThan(100);
    expect(chunkNames(result.chunksToRemesh).has(chunkName(0, 3, 0))).toBe(false);
    expect(blocksBefore.size).toBe(world.blocks.size);
  });

  test("every position of the edit lands in the log with its old and new block", () => {
    const world = smallWorld(2);
    const batch = sphereEdits({ x: -1, y: 130, z: -1 }, 4, BlockType.GLOWSTONE, "fill");
    const before = world.snapshotBlocks();
    const result = applyBlockEdits(world, batch);

    expect(result.changes.count).toBe(result.stats.blocksChanged);
    expect(result.changes.count).toBeGreaterThan(100);
    for (let record = 0; record < result.changes.count; record++) {
      const x = result.changes.x[record];
      const y = result.changes.y[record];
      const z = result.changes.z[record];
      const index = ((x & CHUNK_MASK) << (CHUNK_SHIFT * 2)) | ((y & CHUNK_MASK) << CHUNK_SHIFT) | (z & CHUNK_MASK);
      const chunkBefore = before.get(chunkName(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT, z >> CHUNK_SHIFT))!;
      expect(result.changes.oldBlock[record]).toBe(chunkBefore[index]);
      expect(result.changes.newBlock[record]).toBe(BlockType.GLOWSTONE);
      expect(world.blockAt(x, y, z)).toBe(BlockType.GLOWSTONE);
    }
  });

  test("replace rules never overwrite what they should not", () => {
    const world = smallWorld(6);
    const center = { x: -16, y: 110, z: -16 };
    const solidBefore = world.snapshotBlocks();
    applyBlockEdits(world, sphereEdits(center, 9, BlockType.GLOWSTONE, "fillAirOnly"));
    for (const [name, blocksBefore] of solidBefore) {
      const blocksAfter = world.blocks.get(name)!;
      for (let index = 0; index < CELLS_PER_CHUNK; index++) {
        if (blocksBefore[index] !== BlockType.AIR) expect(blocksAfter[index]).toBe(blocksBefore[index]);
      }
    }
    const airCellsBefore = Array.from(solidBefore.values()).reduce(
      (total, blocks) => total + blocks.filter((block) => block === BlockType.AIR).length,
      0,
    );
    const airCellsAfter = Array.from(world.blocks.values()).reduce(
      (total, blocks) => total + blocks.filter((block) => block === BlockType.AIR).length,
      0,
    );
    expect(airCellsAfter).toBeLessThan(airCellsBefore);
  });

  test("a block edit buried in solid rock remeshes only its own chunk", () => {
    const world = smallWorld(40);
    const buriedY = 4 * CHUNK_SIZE + 15;
    for (let x = -18; x <= -16; x++) {
      for (let y = buriedY - 1; y <= buriedY + 1; y++) {
        for (let z = -18; z <= -16; z++) world.setBlockAt(x, y, z, BlockType.STONE);
      }
    }
    world.relightFromScratch();
    const result = applyAndVerify(
      world,
      boxEdits({ x: -17, y: buriedY, z: -17 }, { x: -17, y: buriedY, z: -17 }, BlockType.AIR, "erase"),
      "buried",
    );
    expect(result.stats.blocksChanged).toBe(1);
    expect(result.chunksToRemesh).toEqual([{ x: -1, y: 4, z: -1 }]);
  });

  test("a large sphere spanning many chunks of a bigger world matches", { timeout: 60000 }, () => {
    const world = createTerrainWorld({
      seed: 55,
      chunkXRange: [-1, 1],
      chunkYRange: [3, 5],
      chunkZRange: [-1, 1],
    });
    const center = { x: 16, y: 4 * CHUNK_SIZE + 12, z: 16 };
    const dug = applyAndVerify(world, sphereEdits(center, 26, BlockType.AIR, "erase"), "dig r26");
    expect(dug.chunksToRemesh.length).toBeGreaterThan(12);
    const filled = applyAndVerify(world, sphereEdits(center, 20, BlockType.GLOWSTONE, "fill"), "lamp r20");
    expect(filled.stats.blocksChanged).toBeGreaterThan(30000);
    applyAndVerify(world, sphereEdits({ x: 30, y: 5 * CHUNK_SIZE + 30, z: -20 }, 24, BlockType.STONE, "fill"), "roof r24");
  });

  test("a chunk with blocks but no light yet takes the block edit and no light work", () => {
    const world = smallWorld(4);
    world.light.delete(chunkName(0, 3, 0));
    const result = applyBlockEdits(
      world,
      sphereEdits({ x: 16, y: 3 * CHUNK_SIZE + 16, z: 16 }, 4, BlockType.GLASS, "fill"),
    );
    expect(result.stats.blocksChanged).toBeGreaterThan(100);
    expect(world.blockAt(16, 3 * CHUNK_SIZE + 16, 16)).toBe(BlockType.GLASS);
    expect(chunkNames(result.changedChunks).has(chunkName(0, 3, 0))).toBe(true);
    expect(chunkNames(result.chunksToRemesh).has(chunkName(0, 3, 0))).toBe(false);
    expect(world.getLight(0, 3, 0)).toBeUndefined();
  });

  test("relighting after blocks the caller wrote itself matches a full relight", () => {
    const world = smallWorld(19);
    const random = createSeededRandom(808);
    for (let round = 0; round < 6; round++) {
      const changes: { x: number; y: number; z: number; oldBlock: number }[] = [];
      for (let edit = 0; edit < 60; edit++) {
        const x = -30 + Math.floor(random() * 60);
        const y = 100 + Math.floor(random() * 50);
        const z = -30 + Math.floor(random() * 60);
        const block = [BlockType.AIR, BlockType.STONE, BlockType.GLOWSTONE, BlockType.WATER][Math.floor(random() * 4)];
        changes.push({ x, y, z, oldBlock: world.setBlockAt(x, y, z, block) });
      }
      relightAfterBlocksWritten(world, changes);
      expectLightMatches(world, floodLightFromScratch(world), `caller wrote round ${round}`);
    }
  });

  test("records a profile with a section per phase and counters when profiling", () => {
    const world = smallWorld(7);
    beginWorkerTask(true);
    applyBlockEdits(world, sphereEdits({ x: -16, y: 120, z: -16 }, 6, BlockType.STONE, "fill"));
    const profile = finishWorkerTask()!;
    const sectionNames = profile.callTree.map((node) => node.path);
    for (const phase of ["writeBlocks", "seedLightChanges", "removeSkyLight", "removeBlockLight", "refillLight", "collectChunks"]) {
      expect(sectionNames).toContain(phase);
    }
    expect(profile.counters.blocksChanged).toBeGreaterThan(100);
    expect(profile.counters.chunksToRemesh).toBeGreaterThan(0);
  });
});

describe("applyBlockEdits profiling", () => {
  test("flood and edit counters match the stats of the result for a sphere of glowstone and a sphere of stone", () => {
    const world = smallWorld(11);
    withEnabledProfiler(() => {
      const glow = applyBlockEdits(world, sphereEdits({ x: -10, y: 4 * CHUNK_SIZE + 6, z: -8 }, 5, BlockType.GLOWSTONE, "fill"));
      const stone = applyBlockEdits(world, sphereEdits({ x: -12, y: 4 * CHUNK_SIZE + 20, z: -9 }, 6, BlockType.STONE, "fill"));
      const stats = [glow.stats, stone.stats];
      const sum = (pick: (entry: BulkEditResult["stats"]) => number) => stats.reduce((total, entry) => total + pick(entry), 0);

      expect(sum((entry) => entry.blocksChanged)).toBeGreaterThan(200);
      expect(counterTotal("game.edit.sessions")).toBe(2);
      expect(counterTotal("game.edit.blocksChanged")).toBe(sum((entry) => entry.blocksChanged));
      expect(counterTotal("game.edit.light.cellsLit")).toBe(sum((entry) => entry.cellsLit));
      expect(counterTotal("game.edit.light.cellsRemoved")).toBe(sum((entry) => entry.cellsRemoved));
      expect(counterTotal("game.edit.light.cellsVisited")).toBe(sum((entry) => entry.cellsVisited));
      expect(counterTotal("game.edit.light.skyCellsRemoved") + counterTotal("game.edit.light.blockCellsRemoved")).toBe(
        sum((entry) => entry.cellsRemoved),
      );
      expect(counterTotal("game.edit.light.cellsLit")).toBeGreaterThan(1000);
      expect(counterTotal("game.edit.light.neighborsExamined")).toBe(
        6 * (counterTotal("game.edit.light.cellsVisited") - counterTotal("game.edit.light.deadCellsSkipped")),
      );
      expect(breakdownUnits(DIMENSIONS.editBlock, "GLOWSTONE")).toBe(glow.stats.blocksChanged);
      expect(breakdownUnits(DIMENSIONS.editBlock, "STONE")).toBe(stone.stats.blocksChanged);
      expect(counterTotal("game.edit.seed.emitterRefills")).toBeGreaterThan(0);
      expect(counterTotal("game.edit.cluster.slotsCreated")).toBeGreaterThanOrEqual(4);
      expect(gaugeMax("game.edit.light.queuePeakRefill")).toBeGreaterThan(1);
    });
  });
});
