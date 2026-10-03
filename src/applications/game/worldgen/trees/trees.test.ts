import { describe, expect, test } from "bun:test";
import { BlockType } from "@/applications/game/blocks";
import { MAX_TREE_FOOTPRINT_RADIUS, MAX_TREE_HEIGHT, TREE_SPECIES } from "./index";
import type { TreeSpeciesName } from "./index";
import type { TreeBlockWriter } from "./tree-types";

const SEED_COUNT = 40;
const HEIGHT_SCALES = [0.4, 1, 1.3];
const GROUND_BLOCKS = [BlockType.DIRT, BlockType.COARSE_DIRT, BlockType.PODZOL, BlockType.MOSS];

function createSeededRandom(seed: number): () => number {
  let state = (seed * 2654435761 + 12345) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const COORDINATE_OFFSET = 64;
const KEY_SPAN = 256;

function encodeKey(dx: number, dy: number, dz: number): number {
  return ((dx + COORDINATE_OFFSET) * KEY_SPAN + (dz + COORDINATE_OFFSET)) * KEY_SPAN + (dy + COORDINATE_OFFSET);
}

function decodeKey(key: number): [number, number, number] {
  const dy = (key % KEY_SPAN) - COORDINATE_OFFSET;
  const dz = (Math.floor(key / KEY_SPAN) % KEY_SPAN) - COORDINATE_OFFSET;
  const dx = Math.floor(key / (KEY_SPAN * KEY_SPAN)) - COORDINATE_OFFSET;
  return [dx, dy, dz];
}

function isLogLike(block: BlockType): boolean {
  return BlockType[block].startsWith("LOG") || block === BlockType.CACTUS;
}

function isLeaf(block: BlockType): boolean {
  return BlockType[block].startsWith("LEAVES");
}

/** Mimics the real writer: logs replace anything, leaves only fill empty cells and never replace logs. */
function createRecordingWriter() {
  const blocks = new Map<number, BlockType>();
  const ground = new Map<string, BlockType>();
  const writer: TreeBlockWriter = {
    placeLog: (dx, dy, dz, block) => {
      blocks.set(encodeKey(dx, dy, dz), block);
    },
    placeLeaf: (dx, dy, dz, block) => {
      const key = encodeKey(dx, dy, dz);
      if (!blocks.has(key)) blocks.set(key, block);
    },
    placeGround: (dx, dz, block) => {
      ground.set(`${dx},${dz}`, block);
    },
  };
  return { writer, blocks, ground };
}

function buildTree(name: TreeSpeciesName, seed: number, heightScale: number, leafVariant?: BlockType) {
  const recording = createRecordingWriter();
  TREE_SPECIES[name].build(recording.writer, { random: createSeededRandom(seed), heightScale, leafVariant });
  return recording;
}

function treeHeight(blocks: Map<number, BlockType>): number {
  let highest = -Infinity;
  for (const key of blocks.keys()) highest = Math.max(highest, decodeKey(key)[1]);
  return highest + 1;
}

function floodFill(startKeys: number[], isWalkable: (key: number) => boolean): Set<number> {
  const visited = new Set<number>(startKeys);
  const frontier = [...startKeys];
  while (frontier.length > 0) {
    const [dx, dy, dz] = decodeKey(frontier.pop() as number);
    for (let stepX = -1; stepX <= 1; stepX++) {
      for (let stepY = -1; stepY <= 1; stepY++) {
        for (let stepZ = -1; stepZ <= 1; stepZ++) {
          const neighborKey = encodeKey(dx + stepX, dy + stepY, dz + stepZ);
          if (visited.has(neighborKey) || !isWalkable(neighborKey)) continue;
          visited.add(neighborKey);
          frontier.push(neighborKey);
        }
      }
    }
  }
  return visited;
}

function hasSixNeighborLog(blocks: Map<number, BlockType>, dx: number, dy: number, dz: number): boolean {
  const neighborOffsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  return neighborOffsets.some(([stepX, stepY, stepZ]) => {
    const neighbor = blocks.get(encodeKey(dx + stepX, dy + stepY, dz + stepZ));
    return neighbor !== undefined && isLogLike(neighbor);
  });
}

function shapeSignature(blocks: Map<number, BlockType>): string {
  return [...blocks.entries()].sort((first, second) => first[0] - second[0]).map(([key, block]) => `${key}:${block}`).join("|");
}

interface SpeciesExpectation {
  hasLogs: boolean;
  hasLeaves: boolean;
  /** Lower bound at heightScale 0.4, the smallest scale tested. */
  minimumBlocks: number;
  heightAtScaleOne: [number, number];
  minimumDistinctShapes: number;
}

const EXPECTATIONS: Record<TreeSpeciesName, SpeciesExpectation> = {
  oak: { hasLogs: true, hasLeaves: true, minimumBlocks: 15, heightAtScaleOne: [6, 11], minimumDistinctShapes: 30 },
  tall_oak: { hasLogs: true, hasLeaves: true, minimumBlocks: 80, heightAtScaleOne: [10, 16], minimumDistinctShapes: 30 },
  big_oak: { hasLogs: true, hasLeaves: true, minimumBlocks: 130, heightAtScaleOne: [14, 20], minimumDistinctShapes: 30 },
  birch: { hasLogs: true, hasLeaves: true, minimumBlocks: 10, heightAtScaleOne: [8, 14], minimumDistinctShapes: 30 },
  spruce: { hasLogs: true, hasLeaves: true, minimumBlocks: 18, heightAtScaleOne: [12, 21], minimumDistinctShapes: 30 },
  pine: { hasLogs: true, hasLeaves: true, minimumBlocks: 10, heightAtScaleOne: [16, 25], minimumDistinctShapes: 30 },
  krummholz: { hasLogs: true, hasLeaves: true, minimumBlocks: 5, heightAtScaleOne: [3, 5], minimumDistinctShapes: 25 },
  acacia: { hasLogs: true, hasLeaves: true, minimumBlocks: 18, heightAtScaleOne: [6, 11], minimumDistinctShapes: 30 },
  baobab: { hasLogs: true, hasLeaves: true, minimumBlocks: 70, heightAtScaleOne: [11, 17], minimumDistinctShapes: 30 },
  jungle: { hasLogs: true, hasLeaves: true, minimumBlocks: 35, heightAtScaleOne: [9, 14], minimumDistinctShapes: 30 },
  jungle_giant: { hasLogs: true, hasLeaves: true, minimumBlocks: 200, heightAtScaleOne: [22, 32], minimumDistinctShapes: 30 },
  palm: { hasLogs: true, hasLeaves: true, minimumBlocks: 22, heightAtScaleOne: [8, 13], minimumDistinctShapes: 30 },
  mangrove: { hasLogs: true, hasLeaves: true, minimumBlocks: 35, heightAtScaleOne: [6, 10], minimumDistinctShapes: 30 },
  redwood: { hasLogs: true, hasLeaves: true, minimumBlocks: 70, heightAtScaleOne: [29, 48], minimumDistinctShapes: 30 },
  cherry: { hasLogs: true, hasLeaves: true, minimumBlocks: 20, heightAtScaleOne: [6, 10], minimumDistinctShapes: 30 },
  dead: { hasLogs: true, hasLeaves: false, minimumBlocks: 3, heightAtScaleOne: [4, 11], minimumDistinctShapes: 25 },
  bush_oak: { hasLogs: false, hasLeaves: true, minimumBlocks: 3, heightAtScaleOne: [2, 2], minimumDistinctShapes: 20 },
  bush_spruce: { hasLogs: false, hasLeaves: true, minimumBlocks: 2, heightAtScaleOne: [2, 3], minimumDistinctShapes: 10 },
  bush_autumn: { hasLogs: false, hasLeaves: true, minimumBlocks: 2, heightAtScaleOne: [2, 2], minimumDistinctShapes: 20 },
  heath_mat: { hasLogs: false, hasLeaves: true, minimumBlocks: 1, heightAtScaleOne: [1, 1], minimumDistinctShapes: 10 },
  saguaro: { hasLogs: true, hasLeaves: false, minimumBlocks: 2, heightAtScaleOne: [2, 6], minimumDistinctShapes: 10 },
  barrel_cactus: { hasLogs: true, hasLeaves: false, minimumBlocks: 1, heightAtScaleOne: [1, 2], minimumDistinctShapes: 4 },
};

const SPECIES_NAMES = Object.keys(TREE_SPECIES) as TreeSpeciesName[];

describe("registry", () => {
  test("every species is registered under its own name and has an expectation row", () => {
    for (const name of SPECIES_NAMES) {
      expect(TREE_SPECIES[name].name).toBe(name);
      expect(EXPECTATIONS[name]).toBeDefined();
    }
  });

  test("global maxima equal the largest species values", () => {
    expect(MAX_TREE_FOOTPRINT_RADIUS).toBe(Math.max(...SPECIES_NAMES.map((name) => TREE_SPECIES[name].footprintRadius)));
    expect(MAX_TREE_HEIGHT).toBe(Math.max(...SPECIES_NAMES.map((name) => TREE_SPECIES[name].maxHeight)));
    expect(MAX_TREE_FOOTPRINT_RADIUS).toBeGreaterThanOrEqual(10);
  });
});

for (const name of SPECIES_NAMES) {
  const species = TREE_SPECIES[name];
  const expectation = EXPECTATIONS[name];

  describe(name, () => {
    test("is deterministic for a given seed", () => {
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        for (const heightScale of HEIGHT_SCALES) {
          const first = buildTree(name, seed, heightScale);
          const second = buildTree(name, seed, heightScale);
          expect(shapeSignature(second.blocks)).toBe(shapeSignature(first.blocks));
          expect([...second.ground.entries()]).toEqual([...first.ground.entries()]);
        }
      }
    });

    test("stays inside its declared footprint and height", () => {
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        for (const heightScale of HEIGHT_SCALES) {
          const { blocks, ground } = buildTree(name, seed, heightScale);
          for (const key of blocks.keys()) {
            const [dx, dy, dz] = decodeKey(key);
            expect(Math.abs(dx)).toBeLessThanOrEqual(species.footprintRadius);
            expect(Math.abs(dz)).toBeLessThanOrEqual(species.footprintRadius);
            expect(dy).toBeLessThan(species.maxHeight);
          }
          for (const groundKey of ground.keys()) {
            const [dx, dz] = groundKey.split(",").map(Number);
            expect(Math.abs(dx)).toBeLessThanOrEqual(species.footprintRadius);
            expect(Math.abs(dz)).toBeLessThanOrEqual(species.footprintRadius);
          }
        }
      }
    });

    test("only goes below ground when it is a mangrove, and only to dy -2", () => {
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        const { blocks } = buildTree(name, seed, 1);
        const lowest = Math.min(...[...blocks.keys()].map((key) => decodeKey(key)[1]));
        expect(lowest).toBeGreaterThanOrEqual(name === "mangrove" ? -2 : 0);
      }
    });

    test("ground patches only use natural soil variants", () => {
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        for (const block of buildTree(name, seed, 1).ground.values()) expect(GROUND_BLOCKS).toContain(block);
      }
    });

    test("places the expected kinds of blocks, grounded at the trunk base", () => {
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        for (const heightScale of HEIGHT_SCALES) {
          const { blocks } = buildTree(name, seed, heightScale);
          const placed = [...blocks.values()];
          expect(placed.some(isLogLike)).toBe(expectation.hasLogs);
          expect(placed.some(isLeaf)).toBe(expectation.hasLeaves);
          expect(blocks.size).toBeGreaterThanOrEqual(expectation.minimumBlocks);
          const baseBlock = blocks.get(encodeKey(0, 0, 0));
          expect(baseBlock).toBeDefined();
          expect(isLogLike(baseBlock as BlockType)).toBe(expectation.hasLogs);
        }
      }
    });

    if (expectation.hasLogs) {
      test("logs form a single 26-connected component", () => {
        for (let seed = 1; seed <= SEED_COUNT; seed++) {
          for (const heightScale of HEIGHT_SCALES) {
            const { blocks } = buildTree(name, seed, heightScale);
            const logKeys = [...blocks.entries()].filter(([, block]) => isLogLike(block)).map(([key]) => key);
            const reachable = floodFill([logKeys[0]], (key) => {
              const block = blocks.get(key);
              return block !== undefined && isLogLike(block);
            });
            expect(reachable.size).toBe(logKeys.length);
          }
        }
      });
    }

    if (expectation.hasLogs && expectation.hasLeaves) {
      test("most of the canopy is attached to the wood", () => {
        for (let seed = 1; seed <= SEED_COUNT; seed++) {
          for (const heightScale of HEIGHT_SCALES) {
            const { blocks } = buildTree(name, seed, heightScale);
            const logKeys = [...blocks.entries()].filter(([, block]) => isLogLike(block)).map(([key]) => key);
            const leafKeys = [...blocks.entries()].filter(([, block]) => isLeaf(block)).map(([key]) => key);
            const touchingLogCount = leafKeys.filter((key) => {
              const [dx, dy, dz] = decodeKey(key);
              return hasSixNeighborLog(blocks, dx, dy, dz);
            }).length;
            expect(touchingLogCount).toBeGreaterThanOrEqual(1);
            const attached = floodFill(logKeys, (key) => blocks.has(key));
            const attachedLeafCount = leafKeys.filter((key) => attached.has(key)).length;
            expect(attachedLeafCount / leafKeys.length).toBeGreaterThanOrEqual(0.9);
          }
        }
      });
    }

    test("shapes differ from seed to seed", () => {
      const signatures = new Set<string>();
      for (let seed = 1; seed <= SEED_COUNT; seed++) signatures.add(shapeSignature(buildTree(name, seed, 1).blocks));
      expect(signatures.size).toBeGreaterThanOrEqual(expectation.minimumDistinctShapes);
    });

    test("measured height at scale 1 is inside the intended range and varies", () => {
      const heights = new Set<number>();
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        const height = treeHeight(buildTree(name, seed, 1).blocks);
        expect(height).toBeGreaterThanOrEqual(expectation.heightAtScaleOne[0]);
        expect(height).toBeLessThanOrEqual(expectation.heightAtScaleOne[1]);
        heights.add(height);
      }
      if (expectation.heightAtScaleOne[0] !== expectation.heightAtScaleOne[1]) expect(heights.size).toBeGreaterThanOrEqual(2);
    });

    test("heightScale shrinks and grows the tree", () => {
      let stuntedTotal = 0;
      let normalTotal = 0;
      let tallTotal = 0;
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        stuntedTotal += buildTree(name, seed, 0.4).blocks.size;
        normalTotal += buildTree(name, seed, 1).blocks.size;
        tallTotal += buildTree(name, seed, 1.3).blocks.size;
      }
      if (name === "barrel_cactus" || name === "heath_mat") {
        expect(tallTotal).toBeGreaterThanOrEqual(stuntedTotal);
        return;
      }
      expect(stuntedTotal).toBeLessThan(normalTotal);
      expect(normalTotal).toBeLessThan(tallTotal);
    });
  });
}

describe("leaf variants", () => {
  test("an autumn oak mixes the override with natural leaves, and a plain oak uses no override", () => {
    let autumnCount = 0;
    let naturalCount = 0;
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      for (const block of buildTree("tall_oak", seed, 1, BlockType.LEAVES_AUTUMN_RED).blocks.values()) {
        if (block === BlockType.LEAVES_AUTUMN_RED) autumnCount++;
        if (block === BlockType.LEAVES) naturalCount++;
      }
      for (const block of buildTree("tall_oak", seed, 1).blocks.values()) {
        expect(block).not.toBe(BlockType.LEAVES_AUTUMN_RED);
      }
    }
    expect(autumnCount).toBeGreaterThan(naturalCount);
    expect(naturalCount).toBeGreaterThan(0);
  });

  test("the autumn bush picks only autumn leaves, and honours an explicit variant", () => {
    const autumnLeaves = [BlockType.LEAVES_AUTUMN_RED, BlockType.LEAVES_AUTUMN_ORANGE, BlockType.LEAVES_AUTUMN_YELLOW];
    const seenLeaves = new Set<BlockType>();
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      for (const block of buildTree("bush_autumn", seed, 1).blocks.values()) {
        expect(autumnLeaves).toContain(block);
        seenLeaves.add(block);
      }
      for (const block of buildTree("bush_autumn", seed, 1, BlockType.LEAVES_AUTUMN_YELLOW).blocks.values()) {
        expect(block).toBe(BlockType.LEAVES_AUTUMN_YELLOW);
      }
    }
    expect(seenLeaves.size).toBe(3);
  });
});

describe("species silhouettes", () => {
  function leafLayerExtents(name: TreeSpeciesName, seed: number) {
    const { blocks } = buildTree(name, seed, 1);
    const widthByLayer = new Map<number, number>();
    for (const [key, block] of blocks) {
      if (!isLeaf(block)) continue;
      const [dx, dy, dz] = decodeKey(key);
      widthByLayer.set(dy, Math.max(widthByLayer.get(dy) ?? 0, Math.abs(dx), Math.abs(dz)));
    }
    return widthByLayer;
  }

  test("spruce is conical: lower layers are clearly wider than the top layers", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const widthByLayer = leafLayerExtents("spruce", seed);
      const layers = [...widthByLayer.keys()].sort((first, second) => first - second);
      const bottomWidth = Math.max(...layers.slice(0, 4).map((layer) => widthByLayer.get(layer) as number));
      const topWidth = Math.max(...layers.slice(-3).map((layer) => widthByLayer.get(layer) as number));
      expect(bottomWidth).toBeGreaterThanOrEqual(topWidth + 2);
    }
  });

  test("acacia canopy is flat: most leaves sit in two thin layers and spread wide", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const { blocks } = buildTree("acacia", seed, 1);
      const leafCountByLayer = new Map<number, number>();
      for (const [key, block] of blocks) {
        if (!isLeaf(block)) continue;
        const layer = decodeKey(key)[1];
        leafCountByLayer.set(layer, (leafCountByLayer.get(layer) ?? 0) + 1);
      }
      const layerCounts = [...leafCountByLayer.values()].sort((first, second) => second - first);
      const totalLeaves = layerCounts.reduce((sum, count) => sum + count, 0);
      expect((layerCounts[0] + layerCounts[1]) / totalLeaves).toBeGreaterThanOrEqual(0.6);
      expect(Math.max(...leafLayerExtents("acacia", seed).values())).toBeGreaterThanOrEqual(3);
    }
  });

  test("palm fronds droop: leaves reach below the crown knobs and well away from the trunk", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const { blocks } = buildTree("palm", seed, 1);
      let highestLog = -1;
      let lowestLeaf = Infinity;
      let widestLeaf = 0;
      for (const [key, block] of blocks) {
        const [dx, dy, dz] = decodeKey(key);
        if (isLogLike(block)) highestLog = Math.max(highestLog, dy);
        if (isLeaf(block)) {
          lowestLeaf = Math.min(lowestLeaf, dy);
          widestLeaf = Math.max(widestLeaf, Math.abs(dx), Math.abs(dz));
        }
      }
      expect(lowestLeaf).toBeLessThan(highestLog - 1);
      expect(widestLeaf).toBeGreaterThanOrEqual(4);
    }
  });

  test("mangrove roots descend from the trunk into dy -2", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const { blocks } = buildTree("mangrove", seed, 1);
      const rootTips = [...blocks.entries()].filter(([key, block]) => block === BlockType.LOG_MANGROVE && decodeKey(key)[1] === -2);
      expect(rootTips.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("redwood trunk thins from a 3x3 base to a single column", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const { blocks } = buildTree("redwood", seed, 1);
      const logCountAtHeight = (dy: number) => [...blocks.entries()].filter(([key, block]) => block === BlockType.LOG_REDWOOD && decodeKey(key)[1] === dy).length;
      const height = treeHeight(blocks);
      expect(logCountAtHeight(3)).toBeGreaterThanOrEqual(9);
      let singleColumnLayers = 0;
      let inspectedLayers = 0;
      for (let dy = Math.ceil(height * 0.62); dy <= Math.floor(height * 0.9); dy++) {
        inspectedLayers++;
        if (logCountAtHeight(dy) === 1) singleColumnLayers++;
        expect(logCountAtHeight(dy)).toBeLessThanOrEqual(5);
      }
      expect(singleColumnLayers / inspectedLayers).toBeGreaterThanOrEqual(0.6);
    }
  });

  test("giant jungle tree has a 2x2 trunk high up and big buttress roots", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const { blocks } = buildTree("jungle_giant", seed, 1);
      const logsAtLayer = (dy: number) => [...blocks.entries()].filter(([key, block]) => block === BlockType.LOG_JUNGLE && decodeKey(key)[1] === dy).length;
      expect(logsAtLayer(0)).toBeGreaterThanOrEqual(10);
      expect(logsAtLayer(10)).toBe(4);
    }
  });

  test("dead trees place only dead logs", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      for (const block of buildTree("dead", seed, 1).blocks.values()) expect(block).toBe(BlockType.LOG_DEAD);
    }
  });
});

describe("build cost", () => {
  test("a typical tree builds in well under a millisecond on average", () => {
    const counts = { placements: 0 };
    const countingWriter: TreeBlockWriter = {
      placeLog: () => void counts.placements++,
      placeLeaf: () => void counts.placements++,
      placeGround: () => void counts.placements++,
    };
    const typicalSpecies: TreeSpeciesName[] = ["oak", "birch", "spruce", "acacia", "palm", "cherry", "bush_oak"];
    const buildsPerSpecies = 400;
    for (const name of typicalSpecies) {
      for (let warmup = 0; warmup < 50; warmup++) TREE_SPECIES[name].build(countingWriter, { random: createSeededRandom(warmup), heightScale: 1 });
    }
    const startedAt = performance.now();
    for (const name of typicalSpecies) {
      for (let seed = 0; seed < buildsPerSpecies; seed++) TREE_SPECIES[name].build(countingWriter, { random: createSeededRandom(seed), heightScale: 1 });
    }
    const averageMilliseconds = (performance.now() - startedAt) / (typicalSpecies.length * buildsPerSpecies);
    expect(counts.placements).toBeGreaterThan(0);
    expect(averageMilliseconds).toBeLessThan(0.5);
  });
});
