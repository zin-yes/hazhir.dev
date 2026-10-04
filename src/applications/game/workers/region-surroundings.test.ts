import { describe, expect, test } from "bun:test";
import { BlockType } from "../blocks";
import { CELLS_PER_CHUNK } from "../edits/chunk-cluster";
import { createSeededRandom } from "../edits/light-test-world.test-helper";
import { mergeLightInPlace } from "../edits/merge-light";
import { loadRealisticChunks } from "../world/realistic-chunk-fixture";
import {
  createSurroundingsSource,
  lightChunkRegion,
  type LitSurroundingChunk,
  type RegionChunk,
} from "./region-lighting";
import {
  SURROUNDING_SLAB_DEPTH,
  collectSurroundingSlabs,
  lightRegionFromSlabs,
  slabCellCount,
} from "./region-surroundings";

const COLUMNS_PER_SIDE = 3;
const nameOf = (chunkX: number, chunkY: number, chunkZ: number) => `${chunkX},${chunkY},${chunkZ}`;
const indexOf = (x: number, y: number, z: number) => (x << 10) | (y << 5) | z;

/** Real terrain of 3 x 3 columns, with tunnels, caves and lamps crossing the column borders. */
class TerrainWorld {
  readonly blocks = new Map<string, Uint8Array>();
  readonly light = new Map<string, Uint8Array>();
  readonly chunkYs: number[] = [];

  constructor() {
    for (const chunk of loadRealisticChunks(COLUMNS_PER_SIDE)) {
      this.blocks.set(nameOf(chunk.chunkX, chunk.chunkY, chunk.chunkZ), chunk.blocks.slice());
      if (!this.chunkYs.includes(chunk.chunkY)) this.chunkYs.push(chunk.chunkY);
    }
    this.chunkYs.sort((first, second) => first - second);
    this.carveFeaturesAcrossBorders();
  }

  setBlock(x: number, y: number, z: number, block: number) {
    const chunk = this.blocks.get(nameOf(x >> 5, y >> 5, z >> 5));
    if (chunk) chunk[indexOf(x & 31, y & 31, z & 31)] = block;
  }

  private carveFeaturesAcrossBorders() {
    const random = createSeededRandom(77);
    for (let tunnel = 0; tunnel < 40; tunnel++) {
      const startX = -40 + Math.floor(random() * 80);
      const startZ = -40 + Math.floor(random() * 80);
      const y = Math.floor(random() * 220) - 40;
      const alongX = random() < 0.5;
      for (let step = 0; step < 30; step++) {
        const x = alongX ? startX + step : startX;
        const z = alongX ? startZ : startZ + step;
        for (let offset = 0; offset < 3; offset++) this.setBlock(x, y + offset, z, BlockType.AIR);
      }
      this.setBlock(alongX ? startX + 15 : startX, y, alongX ? startZ : startZ + 15, BlockType.GLOWSTONE);
    }
    const borderCoordinates = [-33, -32, -31, -1, 0, 1, 30, 31, 32, 33];
    for (let lamp = 0; lamp < 60; lamp++) {
      const x = borderCoordinates[Math.floor(random() * borderCoordinates.length)]!;
      const z = -40 + Math.floor(random() * 80);
      const y = Math.floor(random() * 220) - 40;
      this.setBlock(x, y, z, BlockType.GLOWSTONE);
      this.setBlock(z, y + 1, x, BlockType.GLOWSTONE);
    }
  }

  column(chunkX: number, chunkZ: number, chunkYs = this.chunkYs): RegionChunk[] {
    return chunkYs.map((chunkY) => ({
      chunkX,
      chunkY,
      chunkZ,
      blocks: this.blocks.get(nameOf(chunkX, chunkY, chunkZ))!,
    }));
  }

  litChunks(): LitSurroundingChunk[] {
    const lit: LitSurroundingChunk[] = [];
    for (const [name, light] of this.light) {
      const [chunkX, chunkY, chunkZ] = name.split(",").map(Number);
      lit.push({ chunkX, chunkY, chunkZ, blocks: this.blocks.get(name)!, light });
    }
    return lit;
  }

  /** Lights a region against every lit chunk passed whole, the reference way, and stores the result. */
  lightWithWholeSurroundings(region: RegionChunk[]) {
    const result = lightChunkRegion(region, createSurroundingsSource(this.litChunks()));
    this.store(result.chunkLights, result.surroundingUpdates);
  }

  store(
    chunkLights: { chunkX: number; chunkY: number; chunkZ: number; light: Uint8Array }[],
    surroundingUpdates: { chunkX: number; chunkY: number; chunkZ: number; light: Uint8Array }[],
  ) {
    for (const entry of chunkLights) this.light.set(nameOf(entry.chunkX, entry.chunkY, entry.chunkZ), entry.light);
    for (const update of surroundingUpdates) {
      mergeLightInPlace(this.light.get(nameOf(update.chunkX, update.chunkY, update.chunkZ))!, update.light);
    }
  }

  snapshotLight(): Map<string, Uint8Array> {
    return new Map([...this.light].map(([name, light]) => [name, light.slice()]));
  }

  restoreLight(snapshot: Map<string, Uint8Array>) {
    this.light.clear();
    for (const [name, light] of snapshot) this.light.set(name, light.slice());
  }

  getLitChunk = (chunkX: number, chunkY: number, chunkZ: number) => {
    const name = nameOf(chunkX, chunkY, chunkZ);
    const light = this.light.get(name);
    const blocks = this.blocks.get(name);
    return light && blocks ? { blocks, light, uniformBlock: -1 } : undefined;
  };
}

function countDifferentCells(first: Map<string, Uint8Array>, second: Map<string, Uint8Array>): number {
  expect([...first.keys()].sort()).toEqual([...second.keys()].sort());
  let different = 0;
  for (const [name, light] of first) {
    const other = second.get(name)!;
    for (let index = 0; index < CELLS_PER_CHUNK; index++) if (light[index] !== other[index]) different++;
  }
  return different;
}

/** Lights the region both ways from the same starting light and returns both resulting worlds' light. */
function lightBothWays(world: TerrainWorld, region: RegionChunk[]) {
  const before = world.snapshotLight();
  world.lightWithWholeSurroundings(region);
  const withWholeChunks = world.snapshotLight();

  world.restoreLight(before);
  const slabs = collectSurroundingSlabs(region, world.getLitChunk);
  const inputs = region.map(({ chunkX, chunkY, chunkZ, blocks }) => ({ chunkX, chunkY, chunkZ, blocks, uniformBlock: -1 }));
  const result = lightRegionFromSlabs(inputs, slabs);
  world.store(result.chunkLights, result.surroundingUpdates);
  const withSlabs = world.snapshotLight();
  const slabBytes = slabs.reduce((total, slab) => total + (slab.blocks?.byteLength ?? 1) + (slab.light?.byteLength ?? 1), 0);
  return { withWholeChunks, withSlabs, slabCount: slabs.length, slabBytes, surroundingUpdateCount: result.surroundingUpdates.length };
}

describe("region lighting with slab surroundings", () => {
  const world = new TerrainWorld();
  const lowestChunkY = world.chunkYs[0]!;
  const highestChunkY = world.chunkYs[world.chunkYs.length - 1]!;
  const columnOrder: [number, number][] = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1],
  ];
  for (const [chunkX, chunkZ] of columnOrder) world.lightWithWholeSurroundings(world.column(chunkX, chunkZ));

  test("a column between lit columns gets the same light as with whole neighbor chunks", () => {
    const outcome = lightBothWays(world, world.column(1, 1));
    expect(outcome.slabCount).toBeGreaterThan(0);
    expect(outcome.surroundingUpdateCount).toBeGreaterThan(0);
    expect(countDifferentCells(outcome.withWholeChunks, outcome.withSlabs)).toBe(0);
    world.restoreLight(outcome.withWholeChunks);
  });

  test("the center column, lit last and touching lit columns on all four sides, matches too", () => {
    const outcome = lightBothWays(world, world.column(0, 0));
    expect(outcome.slabCount).toBeGreaterThanOrEqual(4 * world.chunkYs.length);
    expect(countDifferentCells(outcome.withWholeChunks, outcome.withSlabs)).toBe(0);
    const wholeNeighborBytes = outcome.slabCount * CELLS_PER_CHUNK * 2;
    expect(outcome.slabBytes).toBeLessThan(wholeNeighborBytes / 2);
  });

  test("chunks added on top of, below and in a gap of lit columns match", () => {
    for (const [chunkX, chunkZ] of [[0, 0], [1, 0], [0, 1]] as const) {
      for (const chunkY of [highestChunkY, lowestChunkY, lowestChunkY + 4]) world.light.delete(nameOf(chunkX, chunkY, chunkZ));
    }
    const topOnly = lightBothWays(world, world.column(0, 0, [highestChunkY]));
    expect(countDifferentCells(topOnly.withWholeChunks, topOnly.withSlabs)).toBe(0);
    world.restoreLight(topOnly.withWholeChunks);

    const bottomAndGap = lightBothWays(world, world.column(0, 0, [lowestChunkY, lowestChunkY + 4]));
    expect(countDifferentCells(bottomAndGap.withWholeChunks, bottomAndGap.withSlabs)).toBe(0);
    world.restoreLight(bottomAndGap.withWholeChunks);

    const twoColumns = lightBothWays(world, [
      ...world.column(1, 0, [highestChunkY, lowestChunkY, lowestChunkY + 4]),
      ...world.column(0, 1, [highestChunkY, lowestChunkY, lowestChunkY + 4]),
    ]);
    expect(countDifferentCells(twoColumns.withWholeChunks, twoColumns.withSlabs)).toBe(0);
  });

  test("light from a lamp at the border reaches 13 cells into a lit neighbor, inside the slab", () => {
    const neighborBlocks = new Uint8Array(CELLS_PER_CHUNK).fill(BlockType.STONE);
    for (let x = 0; x < 32; x++) neighborBlocks[indexOf(x, 10, 10)] = BlockType.AIR;
    const neighbor = { chunkX: 1, chunkY: 4, chunkZ: 0, blocks: neighborBlocks, light: new Uint8Array(CELLS_PER_CHUNK) };
    const regionBlocks = new Uint8Array(CELLS_PER_CHUNK).fill(BlockType.STONE);
    regionBlocks[indexOf(31, 10, 10)] = BlockType.GLOWSTONE;
    const region = [{ chunkX: 0, chunkY: 4, chunkZ: 0, blocks: regionBlocks }];

    const reference = lightChunkRegion(region, createSurroundingsSource([neighbor]));
    const slabs = collectSurroundingSlabs(region, (chunkX) =>
      chunkX === 1 ? { blocks: neighbor.blocks, light: neighbor.light, uniformBlock: -1 } : undefined,
    );
    expect(slabs).toHaveLength(1);
    expect(slabCellCount(slabs[0]!)).toBe(SURROUNDING_SLAB_DEPTH * 32 * 32);
    const fromSlabs = lightRegionFromSlabs([{ ...region[0]!, uniformBlock: -1 }], slabs);

    const litDepths = (update: Uint8Array) => [...Array(32).keys()].filter((x) => (update[indexOf(x, 10, 10)]! & 0xf) > 0);
    expect(litDepths(reference.surroundingUpdates[0]!.light)).toEqual([...Array(14).keys()]);
    expect(litDepths(fromSlabs.surroundingUpdates[0]!.light)).toEqual([...Array(14).keys()]);
  });
});
