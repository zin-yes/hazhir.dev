import { BlockType } from "../blocks";
import { lightChunkRegion } from "../workers/region-lighting";
import { CELLS_PER_CHUNK, CHUNK_MASK, CHUNK_SHIFT } from "./chunk-cluster";
import type { LightChunkSource } from "./chunk-cluster";
import { EMISSION, IS_TRANSPARENT, MAX_LIGHT } from "./light-tables";

const CHUNK_SIZE = CHUNK_MASK + 1;
const NEIGHBOR_STEPS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const chunkName = (chunkX: number, chunkY: number, chunkZ: number) =>
  `${chunkX},${chunkY},${chunkZ}`;

export function cellIndexOf(x: number, y: number, z: number): number {
  return (
    ((x & CHUNK_MASK) << (CHUNK_SHIFT * 2)) |
    ((y & CHUNK_MASK) << CHUNK_SHIFT) |
    (z & CHUNK_MASK)
  );
}

export function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** A small world of loaded chunks held in maps, usable as the source of a light update. */
export class LightTestWorld implements LightChunkSource {
  readonly blocks = new Map<string, Uint8Array>();
  readonly light = new Map<string, Uint8Array>();

  getBlocks(chunkX: number, chunkY: number, chunkZ: number) {
    return this.blocks.get(chunkName(chunkX, chunkY, chunkZ));
  }

  getLight(chunkX: number, chunkY: number, chunkZ: number) {
    return this.light.get(chunkName(chunkX, chunkY, chunkZ));
  }

  addEmptyChunk(chunkX: number, chunkY: number, chunkZ: number): Uint8Array {
    const chunk = new Uint8Array(CELLS_PER_CHUNK);
    this.blocks.set(chunkName(chunkX, chunkY, chunkZ), chunk);
    return chunk;
  }

  unloadChunk(chunkX: number, chunkY: number, chunkZ: number) {
    this.blocks.delete(chunkName(chunkX, chunkY, chunkZ));
    this.light.delete(chunkName(chunkX, chunkY, chunkZ));
  }

  blockAt(x: number, y: number, z: number): number {
    const chunk = this.getBlocks(
      x >> CHUNK_SHIFT,
      y >> CHUNK_SHIFT,
      z >> CHUNK_SHIFT,
    );
    return chunk ? chunk[cellIndexOf(x, y, z)] : -1;
  }

  setBlockAt(x: number, y: number, z: number, block: number): number {
    const chunk = this.getBlocks(
      x >> CHUNK_SHIFT,
      y >> CHUNK_SHIFT,
      z >> CHUNK_SHIFT,
    )!;
    const index = cellIndexOf(x, y, z);
    const oldBlock = chunk[index];
    chunk[index] = block;
    return oldBlock;
  }

  lightAt(x: number, y: number, z: number): number {
    const light = this.getLight(
      x >> CHUNK_SHIFT,
      y >> CHUNK_SHIFT,
      z >> CHUNK_SHIFT,
    );
    return light ? light[cellIndexOf(x, y, z)] : -1;
  }

  snapshotLight(): Map<string, Uint8Array> {
    return new Map(
      Array.from(this.light, ([name, light]) => [name, new Uint8Array(light)]),
    );
  }

  snapshotBlocks(): Map<string, Uint8Array> {
    return new Map(
      Array.from(this.blocks, ([name, blocks]) => [name, new Uint8Array(blocks)]),
    );
  }

  /** Replaces all light with the exact closure for the current blocks. */
  relightFromScratch() {
    this.light.clear();
    for (const [name, light] of floodLightFromScratch(this)) {
      this.light.set(name, light);
    }
  }
}

/**
 * The light of the whole loaded region from scratch, by a plain global flood
 * over dense arrays. It shares no code with the engines, so agreement means
 * something. Unloaded chunks are walls. Sky light enters at the top of the
 * highest loaded chunk of each column and falls undimmed through open cells.
 */
export function floodLightFromScratch(
  world: LightTestWorld,
): Map<string, Uint8Array> {
  const chunkCoordinates = Array.from(world.blocks.keys()).map(
    (name) => name.split(",").map(Number) as [number, number, number],
  );
  const minChunk = [0, 1, 2].map((axis) =>
    Math.min(...chunkCoordinates.map((coordinate) => coordinate[axis])),
  );
  const maxChunk = [0, 1, 2].map((axis) =>
    Math.max(...chunkCoordinates.map((coordinate) => coordinate[axis])),
  );
  const sizeX = (maxChunk[0] - minChunk[0] + 1) * CHUNK_SIZE;
  const sizeY = (maxChunk[1] - minChunk[1] + 1) * CHUNK_SIZE;
  const sizeZ = (maxChunk[2] - minChunk[2] + 1) * CHUNK_SIZE;
  const originX = minChunk[0] * CHUNK_SIZE;
  const originY = minChunk[1] * CHUNK_SIZE;
  const originZ = minChunk[2] * CHUNK_SIZE;
  const flat = (x: number, y: number, z: number) => (x * sizeY + y) * sizeZ + z;

  const blocks = new Uint8Array(sizeX * sizeY * sizeZ);
  const isLoaded = new Uint8Array(sizeX * sizeY * sizeZ);
  for (const [chunkX, chunkY, chunkZ] of chunkCoordinates) {
    const chunk = world.getBlocks(chunkX, chunkY, chunkZ)!;
    for (let localX = 0; localX < CHUNK_SIZE; localX++) {
      for (let localY = 0; localY < CHUNK_SIZE; localY++) {
        for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
          const position = flat(
            chunkX * CHUNK_SIZE + localX - originX,
            chunkY * CHUNK_SIZE + localY - originY,
            chunkZ * CHUNK_SIZE + localZ - originZ,
          );
          blocks[position] = chunk[cellIndexOf(localX, localY, localZ)];
          isLoaded[position] = 1;
        }
      }
    }
  }

  const sky = new Uint8Array(blocks.length);
  const emitted = new Uint8Array(blocks.length);
  const skyQueue: number[] = [];
  const blockQueue: number[] = [];
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      let y = sizeY - 1;
      while (y >= 0 && !isLoaded[flat(x, y, z)]) y--;
      for (; y >= 0 && isLoaded[flat(x, y, z)] && IS_TRANSPARENT[blocks[flat(x, y, z)]]; y--) {
        sky[flat(x, y, z)] = MAX_LIGHT;
        skyQueue.push(x, y, z);
      }
    }
  }
  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const emission = EMISSION[blocks[flat(x, y, z)]];
        if (emission > 0 && isLoaded[flat(x, y, z)]) {
          emitted[flat(x, y, z)] = emission;
          blockQueue.push(x, y, z);
        }
      }
    }
  }

  const flood = (levels: Uint8Array, queue: number[], isSky: boolean) => {
    for (let head = 0; head < queue.length; head += 3) {
      const x = queue[head];
      const y = queue[head + 1];
      const z = queue[head + 2];
      const value = levels[flat(x, y, z)];
      for (const [stepX, stepY, stepZ] of NEIGHBOR_STEPS) {
        const neighborX = x + stepX;
        const neighborY = y + stepY;
        const neighborZ = z + stepZ;
        if (
          neighborX < 0 ||
          neighborY < 0 ||
          neighborZ < 0 ||
          neighborX >= sizeX ||
          neighborY >= sizeY ||
          neighborZ >= sizeZ
        ) {
          continue;
        }
        const position = flat(neighborX, neighborY, neighborZ);
        if (!isLoaded[position] || !IS_TRANSPARENT[blocks[position]]) continue;
        const reached =
          isSky && stepY === -1 && value === MAX_LIGHT ? MAX_LIGHT : value - 1;
        if (reached > levels[position]) {
          levels[position] = reached;
          queue.push(neighborX, neighborY, neighborZ);
        }
      }
    }
  };
  flood(sky, skyQueue, true);
  flood(emitted, blockQueue, false);

  const lights = new Map<string, Uint8Array>();
  for (const [chunkX, chunkY, chunkZ] of chunkCoordinates) {
    const light = new Uint8Array(CELLS_PER_CHUNK);
    for (let localX = 0; localX < CHUNK_SIZE; localX++) {
      for (let localY = 0; localY < CHUNK_SIZE; localY++) {
        for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
          const position = flat(
            chunkX * CHUNK_SIZE + localX - originX,
            chunkY * CHUNK_SIZE + localY - originY,
            chunkZ * CHUNK_SIZE + localZ - originZ,
          );
          light[cellIndexOf(localX, localY, localZ)] =
            (sky[position] << 4) | emitted[position];
        }
      }
    }
    lights.set(chunkName(chunkX, chunkY, chunkZ), light);
  }
  return lights;
}

/** Lights every loaded chunk with the game's load pass (see lightChunkRegion). */
export function lightWorldLikeTheGame(
  world: LightTestWorld,
): Map<string, Uint8Array> {
  const chunks = Array.from(world.blocks, ([name, blocks]) => {
    const [chunkX, chunkY, chunkZ] = name.split(",").map(Number);
    return { chunkX, chunkY, chunkZ, blocks };
  });
  const lights = new Map<string, Uint8Array>();
  for (const entry of lightChunkRegion(chunks).chunkLights) {
    lights.set(chunkName(entry.chunkX, entry.chunkY, entry.chunkZ), entry.light);
  }
  return lights;
}

/** Throws at the first cell where the world's light differs from the expected light. */
export function expectLightMatches(
  world: LightTestWorld,
  expected: Map<string, Uint8Array>,
  label = "",
) {
  for (const [name, expectedLight] of expected) {
    const actualLight = world.light.get(name);
    if (!actualLight) throw new Error(`${label} chunk ${name} has no light`);
    for (let index = 0; index < expectedLight.length; index++) {
      if (actualLight[index] === expectedLight[index]) continue;
      const x = index >> (CHUNK_SHIFT * 2);
      const y = (index >> CHUNK_SHIFT) & CHUNK_MASK;
      const z = index & CHUNK_MASK;
      throw new Error(
        `${label} light differs in chunk ${name} at ${x},${y},${z}: got sky ${actualLight[index] >> 4} block ${actualLight[index] & 15}, expected sky ${expectedLight[index] >> 4} block ${expectedLight[index] & 15}`,
      );
    }
  }
}

export interface TerrainWorldOptions {
  chunkXRange: [number, number];
  chunkYRange: [number, number];
  chunkZRange: [number, number];
  seed: number;
  /** Fraction of columns whose stone reaches the top layer of the region. */
  mountainShare?: number;
}

/**
 * Hills of stone with a dirt skin, carved tunnels, a water pool, glowstone
 * lamps, leaves and glass, filled with a seeded random generator so a failure
 * can be replayed.
 */
export function createTerrainWorld(options: TerrainWorldOptions): LightTestWorld {
  const random = createSeededRandom(options.seed);
  const world = new LightTestWorld();
  const [minChunkX, maxChunkX] = options.chunkXRange;
  const [minChunkY, maxChunkY] = options.chunkYRange;
  const [minChunkZ, maxChunkZ] = options.chunkZRange;
  const minX = minChunkX * CHUNK_SIZE;
  const maxX = (maxChunkX + 1) * CHUNK_SIZE;
  const minY = minChunkY * CHUNK_SIZE;
  const maxY = (maxChunkY + 1) * CHUNK_SIZE;
  const minZ = minChunkZ * CHUNK_SIZE;
  const maxZ = (maxChunkZ + 1) * CHUNK_SIZE;
  for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
      for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
        world.addEmptyChunk(chunkX, chunkY, chunkZ);
      }
    }
  }

  const baseHeight = minY + (maxY - minY) * 0.45;
  const waveX = 0.05 + random() * 0.08;
  const waveZ = 0.05 + random() * 0.08;
  const mountainShare = options.mountainShare ?? 0.08;
  for (let x = minX; x < maxX; x++) {
    for (let z = minZ; z < maxZ; z++) {
      const rolling = Math.sin(x * waveX) * 7 + Math.cos(z * waveZ) * 6;
      const isMountain = random() < mountainShare / 8;
      const height = isMountain
        ? maxY - 1 - Math.floor(random() * 3)
        : Math.floor(baseHeight + rolling);
      for (let y = minY; y <= height && y < maxY; y++) {
        world.setBlockAt(
          x,
          y,
          z,
          y === height ? BlockType.DIRT : BlockType.STONE,
        );
      }
    }
  }

  for (let tunnel = 0; tunnel < 6; tunnel++) {
    let x = minX + Math.floor(random() * (maxX - minX));
    let y = Math.floor(minY + (maxY - minY) * (0.15 + random() * 0.3));
    let z = minZ + Math.floor(random() * (maxZ - minZ));
    for (let step = 0; step < 90; step++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = 0; dy <= 2; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cellX = x + dx;
            const cellY = y + dy;
            const cellZ = z + dz;
            if (
              cellX >= minX && cellX < maxX &&
              cellY >= minY && cellY < maxY &&
              cellZ >= minZ && cellZ < maxZ
            ) {
              world.setBlockAt(cellX, cellY, cellZ, BlockType.AIR);
            }
          }
        }
      }
      const direction = Math.floor(random() * 3);
      const sign = random() < 0.5 ? -1 : 1;
      if (direction === 0) x += sign;
      else if (direction === 1) y += random() < 0.3 ? sign : 0;
      else z += sign;
      x = Math.max(minX + 2, Math.min(maxX - 3, x));
      y = Math.max(minY + 2, Math.min(maxY - 5, y));
      z = Math.max(minZ + 2, Math.min(maxZ - 3, z));
    }
  }

  const scatter = [BlockType.GLOWSTONE, BlockType.LEAVES, BlockType.GLASS, BlockType.WATER];
  for (let index = 0; index < 160; index++) {
    const x = minX + Math.floor(random() * (maxX - minX));
    const y = minY + Math.floor(random() * (maxY - minY));
    const z = minZ + Math.floor(random() * (maxZ - minZ));
    world.setBlockAt(x, y, z, scatter[Math.floor(random() * scatter.length)]);
  }
  for (let lamp = 0; lamp < 10; lamp++) {
    const x = minX + Math.floor(random() * (maxX - minX));
    const y = minY + Math.floor(random() * (maxY - minY));
    const z = minZ + Math.floor(random() * (maxZ - minZ));
    world.setBlockAt(x, y, z, BlockType.GLOWSTONE);
  }
  world.relightFromScratch();
  return world;
}
