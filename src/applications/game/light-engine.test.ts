import { describe, expect, test } from "bun:test";
import { BlockType, TRANSPARENT_BLOCKS, getBlockLightLevel } from "./blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "./config";
import { type LightChunkSource, relightAfterBlockChange } from "./light-engine";
import { calculateOffset } from "./utils";

// The sky is open above the top layer of the region. Edits stay below that layer: the
// engine cannot know what lies above a chunk that is not loaded.
const WORLD_CHUNKS_X = 2;
const WORLD_CHUNKS_Z = 2;
const BASE_CHUNK_Y = 10;
const WORLD_CHUNKS_Y = 2;
const BLOCKS_PER_CHUNK = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;

const NEIGHBOR_OFFSETS: [number, number, number][] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const name = (x: number, y: number, z: number) => `${x},${y},${z}`;

function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

class TestWorld implements LightChunkSource {
  blocks = new Map<string, Uint8Array>();
  light = new Map<string, Uint8Array>();

  getBlocks(x: number, y: number, z: number) {
    return this.blocks.get(name(x, y, z));
  }
  getLight(x: number, y: number, z: number) {
    return this.light.get(name(x, y, z));
  }

  coordinates() {
    const coordinates: [number, number, number][] = [];
    for (let x = 0; x < WORLD_CHUNKS_X; x++)
      for (let y = BASE_CHUNK_Y; y < BASE_CHUNK_Y + WORLD_CHUNKS_Y; y++)
        for (let z = 0; z < WORLD_CHUNKS_Z; z++) coordinates.push([x, y, z]);
    return coordinates;
  }

  setBlockAt(x: number, y: number, z: number, block: number) {
    const chunk = this.blocks.get(name(x >> 5, y >> 5, z >> 5))!;
    const index = calculateOffset(x & 31, y & 31, z & 31);
    const old = chunk[index];
    chunk[index] = block;
    return old;
  }
}

/**
 * Light from scratch by flooding the whole region at once. Written independently of
 * the engine (a global flood over dense arrays) so agreement means something. The
 * game's own load pass spreads one chunk hop at a time, so it is not exact enough
 * to compare against where chunks touch only at their corners.
 */
function lightFromScratch(world: TestWorld): Map<string, Uint8Array> {
  const coordinates = world.coordinates();
  const minChunkY = Math.min(...coordinates.map((coordinate) => coordinate[1]));
  const sizeX = WORLD_CHUNKS_X * CHUNK_WIDTH;
  const sizeY = WORLD_CHUNKS_Y * CHUNK_HEIGHT;
  const sizeZ = WORLD_CHUNKS_Z * CHUNK_LENGTH;
  const originY = minChunkY * CHUNK_HEIGHT;
  const flat = (x: number, y: number, z: number) => (x * sizeY + y) * sizeZ + z;

  const blocks = new Uint8Array(sizeX * sizeY * sizeZ);
  for (let x = 0; x < sizeX; x++)
    for (let y = 0; y < sizeY; y++)
      for (let z = 0; z < sizeZ; z++)
        blocks[flat(x, y, z)] = world.blocks.get(
          name(x >> 5, (y + originY) >> 5, z >> 5),
        )![calculateOffset(x & 31, (y + originY) & 31, z & 31)];

  const transparent = (block: number) => TRANSPARENT_BLOCKS.includes(block);
  const sky = new Uint8Array(blocks.length);
  const emitted = new Uint8Array(blocks.length);
  const skyQueue: number[] = [];
  const blockQueue: number[] = [];
  for (let x = 0; x < sizeX; x++)
    for (let z = 0; z < sizeZ; z++)
      for (
        let y = sizeY - 1;
        y >= 0 && transparent(blocks[flat(x, y, z)]);
        y--
      ) {
        sky[flat(x, y, z)] = 15;
        skyQueue.push(x, y, z);
      }
  for (let x = 0; x < sizeX; x++)
    for (let y = 0; y < sizeY; y++)
      for (let z = 0; z < sizeZ; z++) {
        const emission = getBlockLightLevel(blocks[flat(x, y, z)]);
        if (emission > 0) {
          emitted[flat(x, y, z)] = emission;
          blockQueue.push(x, y, z);
        }
      }

  const flood = (levels: Uint8Array, queue: number[], isSky: boolean) => {
    for (let head = 0; head < queue.length; head += 3) {
      const x = queue[head];
      const y = queue[head + 1];
      const z = queue[head + 2];
      const value = levels[flat(x, y, z)];
      for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (
          nx < 0 ||
          ny < 0 ||
          nz < 0 ||
          nx >= sizeX ||
          ny >= sizeY ||
          nz >= sizeZ
        )
          continue;
        if (!transparent(blocks[flat(nx, ny, nz)])) continue;
        const reached = isSky && dy === -1 && value === 15 ? 15 : value - 1;
        if (reached > levels[flat(nx, ny, nz)]) {
          levels[flat(nx, ny, nz)] = reached;
          queue.push(nx, ny, nz);
        }
      }
    }
  };
  flood(sky, skyQueue, true);
  flood(emitted, blockQueue, false);

  const lights = new Map<string, Uint8Array>();
  for (const [chunkX, chunkY, chunkZ] of coordinates) {
    const light = new Uint8Array(BLOCKS_PER_CHUNK);
    for (let x = 0; x < CHUNK_WIDTH; x++)
      for (let y = 0; y < CHUNK_HEIGHT; y++)
        for (let z = 0; z < CHUNK_LENGTH; z++) {
          const index = flat(
            chunkX * CHUNK_WIDTH + x,
            chunkY * CHUNK_HEIGHT + y - originY,
            chunkZ * CHUNK_LENGTH + z,
          );
          light[calculateOffset(x, y, z)] = (sky[index] << 4) | emitted[index];
        }
    lights.set(name(chunkX, chunkY, chunkZ), light);
  }
  return lights;
}

function buildRandomWorld(seed: number): TestWorld {
  const random = createRandom(seed);
  const world = new TestWorld();
  for (const [x, y, z] of world.coordinates()) {
    const chunk = new Uint8Array(BLOCKS_PER_CHUNK);
    if (y === BASE_CHUNK_Y) {
      for (let localX = 0; localX < CHUNK_WIDTH; localX++)
        for (let localZ = 0; localZ < CHUNK_LENGTH; localZ++) {
          const height = 6 + Math.floor(random() * 6);
          for (let localY = 0; localY < height; localY++)
            chunk[calculateOffset(localX, localY, localZ)] = BlockType.STONE;
        }
    }
    const scatter = [
      BlockType.STONE,
      BlockType.LEAVES,
      BlockType.WATER,
      BlockType.GLOWSTONE,
      BlockType.GLASS,
    ];
    for (let index = 0; index < 400; index++) {
      const localX = Math.floor(random() * CHUNK_WIDTH);
      const localY = Math.floor(random() * CHUNK_HEIGHT);
      const localZ = Math.floor(random() * CHUNK_LENGTH);
      const choice = random();
      chunk[calculateOffset(localX, localY, localZ)] =
        choice < 0.6
          ? BlockType.STONE
          : scatter[Math.floor(random() * scatter.length)];
    }
    world.blocks.set(name(x, y, z), chunk);
  }
  world.light = lightFromScratch(world);
  return world;
}

function expectLightEquals(
  actual: TestWorld,
  expected: Map<string, Uint8Array>,
) {
  for (const [chunkName, expectedLight] of expected) {
    const actualLight = actual.light.get(chunkName)!;
    for (let index = 0; index < expectedLight.length; index++) {
      if (actualLight[index] !== expectedLight[index]) {
        const x = Math.floor(index / 1024);
        const y = Math.floor(index / 32) % 32;
        const z = index % 32;
        throw new Error(
          `light differs in chunk ${chunkName} at ${x},${y},${z}: incremental ${actualLight[index].toString(16)} expected ${expectedLight[index].toString(16)}`,
        );
      }
    }
  }
}

const EDIT_BLOCKS = [
  BlockType.STONE,
  BlockType.AIR,
  BlockType.AIR,
  BlockType.GLOWSTONE,
  BlockType.GLASS,
  BlockType.WATER,
  BlockType.LEAVES,
  BlockType.TALL_GRASS,
];

describe("relightAfterBlockChange", () => {
  test(
    "matches a full recompute after every kind of edit, across chunk borders",
    { timeout: 60000 },
    () => {
      for (const worldSeed of [11, 29]) {
        const world = buildRandomWorld(worldSeed);
        const random = createRandom(worldSeed * 7);
        const maxX = WORLD_CHUNKS_X * CHUNK_WIDTH;
        const maxZ = WORLD_CHUNKS_Z * CHUNK_LENGTH;

        for (let edit = 0; edit < 30; edit++) {
          // Half the edits hug a chunk border so light has to cross it.
          const nearBorder = random() < 0.5;
          const pick = (limit: number, chunkSize: number) =>
            nearBorder
              ? Math.max(
                  0,
                  Math.min(
                    limit - 1,
                    (1 + Math.floor(random() * 2)) * chunkSize -
                      1 +
                      Math.floor(random() * 2),
                  ),
                )
              : Math.floor(random() * limit);
          const x = pick(maxX, CHUNK_WIDTH);
          const z = pick(maxZ, CHUNK_LENGTH);
          const y =
            BASE_CHUNK_Y * CHUNK_HEIGHT +
            Math.floor(random() * CHUNK_HEIGHT * WORLD_CHUNKS_Y);
          const block = EDIT_BLOCKS[Math.floor(random() * EDIT_BLOCKS.length)];

          const oldBlock = world.setBlockAt(x, y, z, block);
          relightAfterBlockChange(world, x, y, z, oldBlock);

          expectLightEquals(world, lightFromScratch(world));
        }
      }
    },
  );

  test("reports the chunk of the edit and the chunks whose light changed", () => {
    const world = buildRandomWorld(5);
    const x = 40;
    const z = 40;
    const y = BASE_CHUNK_Y * CHUNK_HEIGHT + 20;
    const oldBlock = world.setBlockAt(x, y, z, BlockType.GLOWSTONE);
    const { chunksToRemesh } = relightAfterBlockChange(
      world,
      x,
      y,
      z,
      oldBlock,
    );
    const names = chunksToRemesh.map((chunk) =>
      name(chunk.x, chunk.y, chunk.z),
    );
    expect(names).toContain(name(1, BASE_CHUNK_Y, 1));
    expect(names.length).toBeLessThan(28);
  });

  test("an edit that cannot change light does no light work", () => {
    const world = buildRandomWorld(3);
    const x = 5;
    const z = 5;
    const y = BASE_CHUNK_Y * CHUNK_HEIGHT + 25;
    world.setBlockAt(x, y, z, BlockType.AIR);
    const oldBlock = world.setBlockAt(x, y, z, BlockType.TALL_GRASS);
    const before = new Map(
      Array.from(world.light, ([chunkName, light]) => [
        chunkName,
        new Uint8Array(light),
      ]),
    );
    const { chunksToRemesh, stats } = relightAfterBlockChange(
      world,
      x,
      y,
      z,
      oldBlock,
    );
    expect(stats.cellsVisited).toBe(0);
    expect(chunksToRemesh).toHaveLength(1);
    expectLightEquals(world, before);
  });

  test("ignores chunks that are not loaded", () => {
    const world = buildRandomWorld(9);
    world.blocks.delete(name(1, BASE_CHUNK_Y + 1, 0));
    world.light.delete(name(1, BASE_CHUNK_Y + 1, 0));
    const x = 40;
    const z = 5;
    const y = BASE_CHUNK_Y * CHUNK_HEIGHT + 31;
    const oldBlock = world.setBlockAt(x, y, z, BlockType.GLOWSTONE);
    expect(() =>
      relightAfterBlockChange(world, x, y, z, oldBlock),
    ).not.toThrow();
  });
});
