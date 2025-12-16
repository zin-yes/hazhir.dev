import {
  BlockType,
  TRANSPARENT_BLOCKS,
  getBlockLightLevel,
} from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";
import { getSurfaceHeight } from "./generation";
// @ts-ignore
import FastNoiseLite from "fastnoise-lite";

// Helper to get block index
const getIndex = (x: number, y: number, z: number) =>
  x * CHUNK_WIDTH * CHUNK_HEIGHT + y * CHUNK_HEIGHT + z;

const isTransparent = (block: BlockType) => TRANSPARENT_BLOCKS.includes(block);

/**
 * Initializes the light map for a newly generated chunk.
 * Calculates initial sunlight (vertical raycast) and block light sources.
 */
export function initializeChunkLight(
  chunk: Uint8Array,
  seed: number,
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  topChunk?: Uint8Array,
  topChunkLight?: Uint8Array
): { light: Uint8Array; queue: number[] } {
  const light = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
  const queue: number[] = [];
  const noise = new FastNoiseLite(seed);

  // 1. Sunlight Initialization (Vertical Raycast)
  // We assume sunlight comes from the top.
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let z = 0; z < CHUNK_LENGTH; z++) {
      const worldX = chunkX * CHUNK_WIDTH + x;
      const worldZ = chunkZ * CHUNK_LENGTH + z;
      const surfaceY = getSurfaceHeight(noise, worldX, worldZ);

      let isExposed = true;

      // Check top neighbor if provided
      if (topChunkLight) {
        // If we have light info from above, use it!
        // We check the bottom-most layer of the top chunk (y=0)
        const tIndex = getIndex(x, 0, z);
        const tLight = topChunkLight[tIndex];
        const tSky = (tLight >> 4) & 0xf;
        if (tSky < 15) {
          isExposed = false;
        }
      } else if (topChunk) {
        for (let ty = 0; ty < CHUNK_HEIGHT; ty++) {
          const tIndex = getIndex(x, ty, z);
          if (!isTransparent(topChunk[tIndex])) {
            isExposed = false;
            break;
          }
        }
      }

      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const worldY = chunkY * CHUNK_HEIGHT + y;
        const index = getIndex(x, y, z);
        const block = chunk[index];

        // Check noise surface ONLY if we didn't have top chunk info
        // If we had topChunk/topChunkLight, we trust that instead of noise
        if (!topChunk && !topChunkLight) {
          if (worldY <= surfaceY) {
            isExposed = false;
          }
        }

        if (isTransparent(block)) {
          if (isExposed) {
            light[index] = (light[index] & 0x0f) | (15 << 4);
            queue.push(index);
          }
        } else {
          isExposed = false;
        }
      }
    }
  }

  // 2. Block Light Sources
  for (let i = 0; i < chunk.length; i++) {
    const block = chunk[i];
    const emission = getBlockLightLevel(block);
    if (emission > 0) {
      light[i] = (light[i] & 0xf0) | emission;
      queue.push(i);
    }
  }

  return { light, queue };
}

/**
 * Propagates light within a chunk and into/from its neighbors.
 * This is a BFS flood fill.
 */
export function propagateChunkLight(
  centerChunk: Uint8Array,
  centerLight: Uint8Array,
  neighbors: {
    [key: string]: Uint8Array; // key is "dx,dy,dz" e.g. "1,0,0"
  },
  neighborLights: {
    [key: string]: Uint8Array;
  },
  queue: number[]
): {
  centerLight: Uint8Array;
  neighborLightUpdates: { [key: string]: Uint8Array };
} {
  // Clone lights to avoid mutating the input directly (though we return the modified versions)
  // Actually, for performance in workers, mutating the input buffer is fine if we own it.
  // But let's be safe and clone the center light if it's not a copy.
  // The caller should pass a copy if they want to keep the old one.

  // We need to track updates to neighbors
  const neighborUpdates: { [key: string]: Uint8Array } = {};

  // Helper to get/set light across boundaries
  const getLight = (x: number, y: number, z: number): number => {
    if (
      x >= 0 &&
      x < CHUNK_WIDTH &&
      y >= 0 &&
      y < CHUNK_HEIGHT &&
      z >= 0 &&
      z < CHUNK_LENGTH
    ) {
      return centerLight[getIndex(x, y, z)];
    }

    // Neighbor lookup
    let dx = 0,
      dy = 0,
      dz = 0;
    let nx = x,
      ny = y,
      nz = z;

    if (x < 0) {
      dx = -1;
      nx = x + CHUNK_WIDTH;
    } else if (x >= CHUNK_WIDTH) {
      dx = 1;
      nx = x - CHUNK_WIDTH;
    }

    if (y < 0) {
      dy = -1;
      ny = y + CHUNK_HEIGHT;
    } else if (y >= CHUNK_HEIGHT) {
      dy = 1;
      ny = y - CHUNK_HEIGHT;
    }

    if (z < 0) {
      dz = -1;
      nz = z + CHUNK_LENGTH;
    } else if (z >= CHUNK_LENGTH) {
      dz = 1;
      nz = z - CHUNK_LENGTH;
    }

    const key = `${dx},${dy},${dz}`;
    const nLight = neighborUpdates[key] || neighborLights[key];

    if (nLight) {
      return nLight[getIndex(nx, ny, nz)];
    }

    return 0; // Default to 0 if neighbor not loaded
  };

  const setLight = (x: number, y: number, z: number, val: number) => {
    if (
      x >= 0 &&
      x < CHUNK_WIDTH &&
      y >= 0 &&
      y < CHUNK_HEIGHT &&
      z >= 0 &&
      z < CHUNK_LENGTH
    ) {
      centerLight[getIndex(x, y, z)] = val;
      return;
    }

    // Neighbor set
    let dx = 0,
      dy = 0,
      dz = 0;
    let nx = x,
      ny = y,
      nz = z;

    if (x < 0) {
      dx = -1;
      nx = x + CHUNK_WIDTH;
    } else if (x >= CHUNK_WIDTH) {
      dx = 1;
      nx = x - CHUNK_WIDTH;
    }

    if (y < 0) {
      dy = -1;
      ny = y + CHUNK_HEIGHT;
    } else if (y >= CHUNK_HEIGHT) {
      dy = 1;
      ny = y - CHUNK_HEIGHT;
    }

    if (z < 0) {
      dz = -1;
      nz = z + CHUNK_LENGTH;
    } else if (z >= CHUNK_LENGTH) {
      dz = 1;
      nz = z - CHUNK_LENGTH;
    }

    const key = `${dx},${dy},${dz}`;

    // We need to update the neighbor light.
    // If we haven't cloned it yet for updates, do so.
    if (!neighborUpdates[key] && neighborLights[key]) {
      neighborUpdates[key] = new Uint8Array(neighborLights[key]);
    }

    if (neighborUpdates[key]) {
      neighborUpdates[key][getIndex(nx, ny, nz)] = val;
    }
  };

  const getBlock = (x: number, y: number, z: number): BlockType => {
    if (
      x >= 0 &&
      x < CHUNK_WIDTH &&
      y >= 0 &&
      y < CHUNK_HEIGHT &&
      z >= 0 &&
      z < CHUNK_LENGTH
    ) {
      return centerChunk[getIndex(x, y, z)];
    }

    let dx = 0,
      dy = 0,
      dz = 0;
    let nx = x,
      ny = y,
      nz = z;

    if (x < 0) {
      dx = -1;
      nx = x + CHUNK_WIDTH;
    } else if (x >= CHUNK_WIDTH) {
      dx = 1;
      nx = x - CHUNK_WIDTH;
    }

    if (y < 0) {
      dy = -1;
      ny = y + CHUNK_HEIGHT;
    } else if (y >= CHUNK_HEIGHT) {
      dy = 1;
      ny = y - CHUNK_HEIGHT;
    }

    if (z < 0) {
      dz = -1;
      nz = z + CHUNK_LENGTH;
    } else if (z >= CHUNK_LENGTH) {
      dz = 1;
      nz = z - CHUNK_LENGTH;
    }

    const key = `${dx},${dy},${dz}`;
    const nChunk = neighbors[key];

    if (nChunk) {
      return nChunk[getIndex(nx, ny, nz)];
    }

    return BlockType.AIR; // Treat unloaded as air (or opaque? Air is safer for light)
  };

  // BFS
  const directions = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];

  // Convert initial index queue to coordinate queue
  const coordQueue: number[] = []; // x, y, z, x, y, z...
  for (const idx of queue) {
    const z = idx % CHUNK_HEIGHT;
    const y = Math.floor(idx / CHUNK_HEIGHT) % CHUNK_HEIGHT;
    const x = Math.floor(idx / (CHUNK_WIDTH * CHUNK_HEIGHT));

    coordQueue.push(x, y, z);
  }

  // Seed queue with light from neighbors
  // We check the boundary layers of the center chunk.
  // If a neighbor has light that should flow in, we add it to the queue.

  // Left (-1, 0, 0) -> Check x=0 against x=-1
  if (neighbors["-1,0,0"] && neighborLights["-1,0,0"]) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        if (isTransparent(centerChunk[getIndex(0, y, z)])) {
          const nLight = getLight(-1, y, z);
          const nSky = (nLight >> 4) & 0xf;
          const nBlock = nLight & 0xf;
          if (nSky > 0 || nBlock > 0) {
            // Propagate into x=0
            // Horizontal propagation always decays sky light
            let newSky = nSky > 0 ? nSky - 1 : 0;
            let newBlock = nBlock > 0 ? nBlock - 1 : 0;

            const current = centerLight[getIndex(0, y, z)];
            const cSky = (current >> 4) & 0xf;
            const cBlock = current & 0xf;

            if (newSky > cSky || newBlock > cBlock) {
              centerLight[getIndex(0, y, z)] =
                (Math.max(newSky, cSky) << 4) | Math.max(newBlock, cBlock);
              coordQueue.push(0, y, z);
            }
          }
        }
      }
    }
  }

  // Right (1, 0, 0) -> Check x=31 against x=32
  if (neighbors["1,0,0"] && neighborLights["1,0,0"]) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        if (isTransparent(centerChunk[getIndex(CHUNK_WIDTH - 1, y, z)])) {
          const nLight = getLight(CHUNK_WIDTH, y, z);
          const nSky = (nLight >> 4) & 0xf;
          const nBlock = nLight & 0xf;
          if (nSky > 0 || nBlock > 0) {
            // Horizontal propagation always decays sky light
            let newSky = nSky > 0 ? nSky - 1 : 0;
            let newBlock = nBlock > 0 ? nBlock - 1 : 0;

            const current = centerLight[getIndex(CHUNK_WIDTH - 1, y, z)];
            const cSky = (current >> 4) & 0xf;
            const cBlock = current & 0xf;

            if (newSky > cSky || newBlock > cBlock) {
              centerLight[getIndex(CHUNK_WIDTH - 1, y, z)] =
                (Math.max(newSky, cSky) << 4) | Math.max(newBlock, cBlock);
              coordQueue.push(CHUNK_WIDTH - 1, y, z);
            }
          }
        }
      }
    }
  }

  // Bottom (0, -1, 0) -> Check y=0 against y=-1
  if (neighbors["0,-1,0"] && neighborLights["0,-1,0"]) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        if (isTransparent(centerChunk[getIndex(x, 0, z)])) {
          const nLight = getLight(x, -1, z);
          const nSky = (nLight >> 4) & 0xf;
          const nBlock = nLight & 0xf;
          if (nSky > 0 || nBlock > 0) {
            // Upwards propagation (from bottom) always decays sky light
            let newSky = nSky > 0 ? nSky - 1 : 0;
            let newBlock = nBlock > 0 ? nBlock - 1 : 0;

            const current = centerLight[getIndex(x, 0, z)];
            const cSky = (current >> 4) & 0xf;
            const cBlock = current & 0xf;

            if (newSky > cSky || newBlock > cBlock) {
              centerLight[getIndex(x, 0, z)] =
                (Math.max(newSky, cSky) << 4) | Math.max(newBlock, cBlock);
              coordQueue.push(x, 0, z);
            }
          }
        }
      }
    }
  }

  // Top (0, 1, 0) -> Check y=31 against y=32
  if (neighbors["0,1,0"] && neighborLights["0,1,0"]) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        if (isTransparent(centerChunk[getIndex(x, CHUNK_HEIGHT - 1, z)])) {
          const nLight = getLight(x, CHUNK_HEIGHT, z);
          const nSky = (nLight >> 4) & 0xf;
          const nBlock = nLight & 0xf;
          if (nSky > 0 || nBlock > 0) {
            // Downwards propagation from top neighbor
            // If nSky is 15, it stays 15 when moving down
            let newSky = nSky === 15 ? 15 : nSky > 0 ? nSky - 1 : 0;
            let newBlock = nBlock > 0 ? nBlock - 1 : 0;

            const current = centerLight[getIndex(x, CHUNK_HEIGHT - 1, z)];
            const cSky = (current >> 4) & 0xf;
            const cBlock = current & 0xf;

            if (newSky > cSky || newBlock > cBlock) {
              centerLight[getIndex(x, CHUNK_HEIGHT - 1, z)] =
                (Math.max(newSky, cSky) << 4) | Math.max(newBlock, cBlock);
              coordQueue.push(x, CHUNK_HEIGHT - 1, z);
            }
          }
        }
      }
    }
  }

  // Back (0, 0, -1) -> Check z=0 against z=-1
  if (neighbors["0,0,-1"] && neighborLights["0,0,-1"]) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        if (isTransparent(centerChunk[getIndex(x, y, 0)])) {
          const nLight = getLight(x, y, -1);
          const nSky = (nLight >> 4) & 0xf;
          const nBlock = nLight & 0xf;
          if (nSky > 0 || nBlock > 0) {
            // Horizontal propagation always decays sky light
            let newSky = nSky > 0 ? nSky - 1 : 0;
            let newBlock = nBlock > 0 ? nBlock - 1 : 0;

            const current = centerLight[getIndex(x, y, 0)];
            const cSky = (current >> 4) & 0xf;
            const cBlock = current & 0xf;

            if (newSky > cSky || newBlock > cBlock) {
              centerLight[getIndex(x, y, 0)] =
                (Math.max(newSky, cSky) << 4) | Math.max(newBlock, cBlock);
              coordQueue.push(x, y, 0);
            }
          }
        }
      }
    }
  }

  // Front (0, 0, 1) -> Check z=31 against z=32
  if (neighbors["0,0,1"] && neighborLights["0,0,1"]) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        if (isTransparent(centerChunk[getIndex(x, y, CHUNK_LENGTH - 1)])) {
          const nLight = getLight(x, y, CHUNK_LENGTH);
          const nSky = (nLight >> 4) & 0xf;
          const nBlock = nLight & 0xf;
          if (nSky > 0 || nBlock > 0) {
            // Horizontal propagation always decays sky light
            let newSky = nSky > 0 ? nSky - 1 : 0;
            let newBlock = nBlock > 0 ? nBlock - 1 : 0;

            const current = centerLight[getIndex(x, y, CHUNK_LENGTH - 1)];
            const cSky = (current >> 4) & 0xf;
            const cBlock = current & 0xf;

            if (newSky > cSky || newBlock > cBlock) {
              centerLight[getIndex(x, y, CHUNK_LENGTH - 1)] =
                (Math.max(newSky, cSky) << 4) | Math.max(newBlock, cBlock);
              coordQueue.push(x, y, CHUNK_LENGTH - 1);
            }
          }
        }
      }
    }
  }

  let head = 0;
  while (head < coordQueue.length) {
    const x = coordQueue[head++];
    const y = coordQueue[head++];
    const z = coordQueue[head++];

    const currentLight = getLight(x, y, z);
    const sky = (currentLight >> 4) & 0xf;
    const block = currentLight & 0xf;

    if (sky === 0 && block === 0) continue;

    for (const dir of directions) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      const nz = z + dir.z;

      // Check if neighbor is loaded (if it's outside bounds)
      if (
        nx < 0 ||
        nx >= CHUNK_WIDTH ||
        ny < 0 ||
        ny >= CHUNK_HEIGHT ||
        nz < 0 ||
        nz >= CHUNK_LENGTH
      ) {
        // It's a neighbor chunk
        let dx = 0,
          dy = 0,
          dz = 0;
        if (nx < 0) dx = -1;
        else if (nx >= CHUNK_WIDTH) dx = 1;
        if (ny < 0) dy = -1;
        else if (ny >= CHUNK_HEIGHT) dy = 1;
        if (nz < 0) dz = -1;
        else if (nz >= CHUNK_LENGTH) dz = 1;

        const key = `${dx},${dy},${dz}`;
        if (!neighbors[key] && !neighborLights[key]) continue; // Neighbor not loaded
      }

      const nBlock = getBlock(nx, ny, nz);
      if (!isTransparent(nBlock)) continue;

      const nLightVal = getLight(nx, ny, nz);
      const nSky = (nLightVal >> 4) & 0xf;
      const nBlockLight = nLightVal & 0xf;

      let newSky = nSky;
      let newBlockLight = nBlockLight;
      let changed = false;

      let targetSky = sky - 1;
      // Vertical propagation of full sky light downwards
      if (dir.y === -1 && sky === 15) {
        targetSky = 15;
      }

      if (targetSky > nSky) {
        newSky = targetSky;
        changed = true;
      }

      if (block - 1 > nBlockLight) {
        newBlockLight = block - 1;
        changed = true;
      }

      if (changed) {
        setLight(nx, ny, nz, (newSky << 4) | newBlockLight);
        coordQueue.push(nx, ny, nz);
      }
    }
  }

  return { centerLight, neighborLightUpdates: neighborUpdates };
}

export function computeChunkLighting(
  chunk: Uint8Array,
  borders: {
    top?: Uint8Array;
    bottom?: Uint8Array;
    left?: Uint8Array;
    right?: Uint8Array;
    front?: Uint8Array;
    back?: Uint8Array;
  } = {},
  borderLights: {
    top?: Uint8Array;
    bottom?: Uint8Array;
    left?: Uint8Array;
    right?: Uint8Array;
    front?: Uint8Array;
    back?: Uint8Array;
  } = {},
  seed: number = 0,
  chunkX: number = 0,
  chunkY: number = 0,
  chunkZ: number = 0
): Uint8Array {
  const lightMap = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);

  const noise = new FastNoiseLite(seed);

  // Initialize light map
  // If we had block light sources, we would init them here.
  // For sky light, we need to know if we are at the surface.
  // Since we don't have global world info here, we might need to rely on assumptions or inputs.

  // For this implementation, let's assume:
  // 1. If there is no top neighbor, we are at the top -> sunlight enters from top.
  // 2. If there is a top neighbor, we need to know its bottom layer light. (Not provided in borders usually, borders are just blocks)

  // Actually, to do this properly, we need the light data of neighbors.
  // But if we only have block data of neighbors, we can't propagate light *from* them correctly unless we calculate it.

  // Let's try a simplified approach:
  // Calculate local lighting.
  // Sunlight:
  // Iterate x, z.
  // Raycast from top.
  // If block is transparent, set sky light to 15.
  // If opaque, stop.
  // Then propagate.

  // Helper to get block index
  // Must match calculateOffset in utils.ts: x * WIDTH * HEIGHT + y * HEIGHT + z
  // Note: This means z is the fastest changing index, then y, then x.
  const getIndex = (x: number, y: number, z: number) =>
    x * CHUNK_WIDTH * CHUNK_HEIGHT + y * CHUNK_HEIGHT + z;

  const getBlock = (x: number, y: number, z: number) => {
    if (
      x < 0 ||
      x >= CHUNK_WIDTH ||
      y < 0 ||
      y >= CHUNK_HEIGHT ||
      z < 0 ||
      z >= CHUNK_LENGTH
    ) {
      return BlockType.AIR; // Treat out of bounds as air for now, or check borders
    }
    return chunk[getIndex(x, y, z)];
  };

  const isTransparent = (block: BlockType) =>
    TRANSPARENT_BLOCKS.includes(block);

  // Queue for BFS
  const lightQueue: number[] = [];

  // 0. Initialize Block Light Sources (e.g., glowstone, torches)
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const index = getIndex(x, y, z);
        const block = chunk[index];
        const blockLight = getBlockLightLevel(block);
        if (blockLight > 0) {
          // Set block light (lower 4 bits)
          lightMap[index] = (lightMap[index] & 0xf0) | blockLight;
          lightQueue.push(index);
        }
      }
    }
  }

  // 1. Initialize Sunlight
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let z = 0; z < CHUNK_LENGTH; z++) {
      // Start from top
      let sunlight = 15;

      // Check if we are underground based on surface height
      const worldX = chunkX * CHUNK_WIDTH + x;
      const worldZ = chunkZ * CHUNK_LENGTH + z;
      const surfaceY = getSurfaceHeight(noise, worldX, worldZ);
      const topWorldY = chunkY * CHUNK_HEIGHT + CHUNK_HEIGHT - 1;

      // Determine initial sunlight entering from top
      // We check if the block ABOVE the top of the chunk is above the surface.
      if (topWorldY + 1 > surfaceY) {
        sunlight = 15;
      } else {
        sunlight = 0;
      }

      let hasHitObstruction = false;

      // Also check top border if available
      // if (borders.top) {
      //   const topBlock = borders.top[x * CHUNK_LENGTH + z];
      //   if (!isTransparent(topBlock)) {
      //     sunlight = 0;
      //     hasHitObstruction = true;
      //   }
      // }

      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const worldY = chunkY * CHUNK_HEIGHT + y;
        const index = getIndex(x, y, z);
        const block = chunk[index];

        if (!isTransparent(block)) {
          sunlight = 0;
          hasHitObstruction = true;
        }

        // If we are above surface and haven't hit an obstruction, force sunlight
        // Use a small epsilon or strict inequality to ensure surface blocks are lit if they are the top solid block
        if (worldY > surfaceY && !hasHitObstruction) {
          sunlight = 15;
        }

        // Set sky light (upper 4 bits)
        lightMap[index] = (lightMap[index] & 0x0f) | (sunlight << 4);

        if (sunlight > 0) {
          lightQueue.push(index);
        }
      }
    }
  }

  // 1.5 Propagate from borders (Simulate neighbor light)
  // Left Border (x = -1)
  if (borders.left) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        let neighborSky = 0;
        if (borderLights.left) {
          neighborSky = (borderLights.left[y * CHUNK_LENGTH + z] >> 4) & 0xf;
        } else {
          const block = borders.left[y * CHUNK_LENGTH + z];
          if (isTransparent(block)) {
            const worldX = chunkX * CHUNK_WIDTH - 1;
            const worldY = chunkY * CHUNK_HEIGHT + y;
            const worldZ = chunkZ * CHUNK_LENGTH + z;
            const sY = getSurfaceHeight(noise, worldX, worldZ);
            if (worldY > sY) neighborSky = 15;
          }
        }

        if (neighborSky > 0) {
          const index = getIndex(0, y, z);
          if (isTransparent(chunk[index])) {
            const current = lightMap[index];
            const currentSky = (current >> 4) & 0xf;
            const newSky = neighborSky - 1;
            if (newSky > currentSky) {
              lightMap[index] = (newSky << 4) | (current & 0xf);
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // Right Border (x = CHUNK_WIDTH)
  if (borders.right) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        let neighborSky = 0;
        if (borderLights.right) {
          neighborSky = (borderLights.right[y * CHUNK_LENGTH + z] >> 4) & 0xf;
        } else {
          const block = borders.right[y * CHUNK_LENGTH + z];
          if (isTransparent(block)) {
            const worldX = chunkX * CHUNK_WIDTH + CHUNK_WIDTH;
            const worldY = chunkY * CHUNK_HEIGHT + y;
            const worldZ = chunkZ * CHUNK_LENGTH + z;
            const sY = getSurfaceHeight(noise, worldX, worldZ);
            if (worldY > sY) neighborSky = 15;
          }
        }

        if (neighborSky > 0) {
          const index = getIndex(CHUNK_WIDTH - 1, y, z);
          if (isTransparent(chunk[index])) {
            const current = lightMap[index];
            const currentSky = (current >> 4) & 0xf;
            const newSky = neighborSky - 1;
            if (newSky > currentSky) {
              lightMap[index] = (newSky << 4) | (current & 0xf);
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // Front Border (z = CHUNK_LENGTH)
  if (borders.front) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        let neighborSky = 0;
        if (borderLights.front) {
          neighborSky = (borderLights.front[x * CHUNK_HEIGHT + y] >> 4) & 0xf;
        } else {
          const block = borders.front[x * CHUNK_HEIGHT + y];
          if (isTransparent(block)) {
            const worldX = chunkX * CHUNK_WIDTH + x;
            const worldY = chunkY * CHUNK_HEIGHT + y;
            const worldZ = chunkZ * CHUNK_LENGTH + CHUNK_LENGTH;
            const sY = getSurfaceHeight(noise, worldX, worldZ);
            if (worldY > sY) neighborSky = 15;
          }
        }

        if (neighborSky > 0) {
          const index = getIndex(x, y, CHUNK_LENGTH - 1);
          if (isTransparent(chunk[index])) {
            const current = lightMap[index];
            const currentSky = (current >> 4) & 0xf;
            const newSky = neighborSky - 1;
            if (newSky > currentSky) {
              lightMap[index] = (newSky << 4) | (current & 0xf);
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // Back Border (z = -1)
  if (borders.back) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        let neighborSky = 0;
        if (borderLights.back) {
          neighborSky = (borderLights.back[x * CHUNK_HEIGHT + y] >> 4) & 0xf;
        } else {
          const block = borders.back[x * CHUNK_HEIGHT + y];
          if (isTransparent(block)) {
            const worldX = chunkX * CHUNK_WIDTH + x;
            const worldY = chunkY * CHUNK_HEIGHT + y;
            const worldZ = chunkZ * CHUNK_LENGTH - 1;
            const sY = getSurfaceHeight(noise, worldX, worldZ);
            if (worldY > sY) neighborSky = 15;
          }
        }

        if (neighborSky > 0) {
          const index = getIndex(x, y, 0);
          if (isTransparent(chunk[index])) {
            const current = lightMap[index];
            const currentSky = (current >> 4) & 0xf;
            const newSky = neighborSky - 1;
            if (newSky > currentSky) {
              lightMap[index] = (newSky << 4) | (current & 0xf);
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // 1.6 Propagate Block Light from border light sources
  // Check if any border blocks emit light or if light reaches the border from deeper in the chunk

  // Left Border (x = -1) - propagate to x=0
  if (borders.left) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const borderBlock = borders.left[y * CHUNK_LENGTH + z];
        let borderLight = getBlockLightLevel(borderBlock);

        // Also check pre-calculated border light from neighbor
        if (borderLights.left) {
          const preCalcLight = borderLights.left[y * CHUNK_LENGTH + z];
          const preCalcBlockLight = preCalcLight & 0xf;
          if (preCalcBlockLight > borderLight) {
            borderLight = preCalcBlockLight;
          }
        }

        if (borderLight > 1) {
          const index = getIndex(0, y, z);
          const targetBlock = chunk[index];
          if (isTransparent(targetBlock)) {
            const current = lightMap[index];
            const currentBlockLight = current & 0xf;
            const newLight = borderLight - 1;
            if (newLight > currentBlockLight) {
              lightMap[index] = (current & 0xf0) | newLight;
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // Right Border (x = CHUNK_WIDTH) - propagate to x=CHUNK_WIDTH-1
  if (borders.right) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const borderBlock = borders.right[y * CHUNK_LENGTH + z];
        let borderLight = getBlockLightLevel(borderBlock);

        // Also check pre-calculated border light from neighbor
        if (borderLights.right) {
          const preCalcLight = borderLights.right[y * CHUNK_LENGTH + z];
          const preCalcBlockLight = preCalcLight & 0xf;
          if (preCalcBlockLight > borderLight) {
            borderLight = preCalcBlockLight;
          }
        }

        if (borderLight > 1) {
          const index = getIndex(CHUNK_WIDTH - 1, y, z);
          const targetBlock = chunk[index];
          if (isTransparent(targetBlock)) {
            const current = lightMap[index];
            const currentBlockLight = current & 0xf;
            const newLight = borderLight - 1;
            if (newLight > currentBlockLight) {
              lightMap[index] = (current & 0xf0) | newLight;
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // Front Border (z = CHUNK_LENGTH) - propagate to z=CHUNK_LENGTH-1
  if (borders.front) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        const borderBlock = borders.front[x * CHUNK_HEIGHT + y];
        let borderLight = getBlockLightLevel(borderBlock);

        // Also check pre-calculated border light from neighbor
        if (borderLights.front) {
          const preCalcLight = borderLights.front[x * CHUNK_HEIGHT + y];
          const preCalcBlockLight = preCalcLight & 0xf;
          if (preCalcBlockLight > borderLight) {
            borderLight = preCalcBlockLight;
          }
        }

        if (borderLight > 1) {
          const index = getIndex(x, y, CHUNK_LENGTH - 1);
          const targetBlock = chunk[index];
          if (isTransparent(targetBlock)) {
            const current = lightMap[index];
            const currentBlockLight = current & 0xf;
            const newLight = borderLight - 1;
            if (newLight > currentBlockLight) {
              lightMap[index] = (current & 0xf0) | newLight;
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // Back Border (z = -1) - propagate to z=0
  if (borders.back) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        const borderBlock = borders.back[x * CHUNK_HEIGHT + y];
        let borderLight = getBlockLightLevel(borderBlock);

        // Also check pre-calculated border light from neighbor
        if (borderLights.back) {
          const preCalcLight = borderLights.back[x * CHUNK_HEIGHT + y];
          const preCalcBlockLight = preCalcLight & 0xf;
          if (preCalcBlockLight > borderLight) {
            borderLight = preCalcBlockLight;
          }
        }

        if (borderLight > 1) {
          const index = getIndex(x, y, 0);
          const targetBlock = chunk[index];
          if (isTransparent(targetBlock)) {
            const current = lightMap[index];
            const currentBlockLight = current & 0xf;
            const newLight = borderLight - 1;
            if (newLight > currentBlockLight) {
              lightMap[index] = (current & 0xf0) | newLight;
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // Top Border (y = CHUNK_HEIGHT) - propagate to y=CHUNK_HEIGHT-1
  if (borders.top) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const borderBlock = borders.top[x * CHUNK_LENGTH + z];
        let borderLight = getBlockLightLevel(borderBlock);

        // Also check pre-calculated border light from neighbor
        if (borderLights.top) {
          const preCalcLight = borderLights.top[x * CHUNK_LENGTH + z];
          const preCalcBlockLight = preCalcLight & 0xf;
          if (preCalcBlockLight > borderLight) {
            borderLight = preCalcBlockLight;
          }
        }

        if (borderLight > 1) {
          const index = getIndex(x, CHUNK_HEIGHT - 1, z);
          const targetBlock = chunk[index];
          if (isTransparent(targetBlock)) {
            const current = lightMap[index];
            const currentBlockLight = current & 0xf;
            const newLight = borderLight - 1;
            if (newLight > currentBlockLight) {
              lightMap[index] = (current & 0xf0) | newLight;
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // Bottom Border (y = -1) - propagate to y=0
  if (borders.bottom) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const borderBlock = borders.bottom[x * CHUNK_LENGTH + z];
        let borderLight = getBlockLightLevel(borderBlock);

        // Also check pre-calculated border light from neighbor
        if (borderLights.bottom) {
          const preCalcLight = borderLights.bottom[x * CHUNK_LENGTH + z];
          const preCalcBlockLight = preCalcLight & 0xf;
          if (preCalcBlockLight > borderLight) {
            borderLight = preCalcBlockLight;
          }
        }

        if (borderLight > 1) {
          const index = getIndex(x, 0, z);
          const targetBlock = chunk[index];
          if (isTransparent(targetBlock)) {
            const current = lightMap[index];
            const currentBlockLight = current & 0xf;
            const newLight = borderLight - 1;
            if (newLight > currentBlockLight) {
              lightMap[index] = (current & 0xf0) | newLight;
              lightQueue.push(index);
            }
          }
        }
      }
    }
  }

  // 2. Propagate Light
  while (lightQueue.length > 0) {
    const index = lightQueue.shift()!;
    // Reverse of getIndex: x * WIDTH * HEIGHT + y * HEIGHT + z
    // z is fastest, then y, then x
    const z = index % CHUNK_HEIGHT;
    const y = Math.floor(index / CHUNK_HEIGHT) % CHUNK_HEIGHT;
    const x = Math.floor(index / (CHUNK_WIDTH * CHUNK_HEIGHT));

    const currentLight = lightMap[index];
    const skyLight = (currentLight >> 4) & 0xf;
    const blockLight = currentLight & 0xf;

    if (skyLight <= 0 && blockLight <= 0) continue;

    const neighbors = [
      { dx: 1, dy: 0, dz: 0 },
      { dx: -1, dy: 0, dz: 0 },
      { dx: 0, dy: 1, dz: 0 },
      { dx: 0, dy: -1, dz: 0 },
      { dx: 0, dy: 0, dz: 1 },
      { dx: 0, dy: 0, dz: -1 },
    ];

    for (const { dx, dy, dz } of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;

      if (
        nx >= 0 &&
        nx < CHUNK_WIDTH &&
        ny >= 0 &&
        ny < CHUNK_HEIGHT &&
        nz >= 0 &&
        nz < CHUNK_LENGTH
      ) {
        const nIndex = getIndex(nx, ny, nz);
        const nBlock = chunk[nIndex];

        if (isTransparent(nBlock)) {
          const nLight = lightMap[nIndex];
          const nSkyLight = (nLight >> 4) & 0xf;
          const nBlockLight = nLight & 0xf;

          let newSkyLight = nSkyLight;
          let newBlockLight = nBlockLight;
          let changed = false;

          if (skyLight > nSkyLight + 1) {
            newSkyLight = skyLight - 1;
            changed = true;
          }

          if (blockLight > nBlockLight + 1) {
            newBlockLight = blockLight - 1;
            changed = true;
          }

          if (changed) {
            lightMap[nIndex] = (newSkyLight << 4) | newBlockLight;
            lightQueue.push(nIndex);
          }
        }
      }
    }
  }

  return lightMap;
}
