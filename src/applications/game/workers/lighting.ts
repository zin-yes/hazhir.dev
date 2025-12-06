import { BlockType, TRANSPARENT_BLOCKS } from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";
import { getSurfaceHeight } from "./generation";
// @ts-ignore
import FastNoiseLite from "fastnoise-lite";

// Light levels are 0-15
// We can pack sky light (4 bits) and block light (4 bits) into a single byte if needed.
// For simplicity, let's use separate arrays or just one for now.
// Let's assume we just want "light" which is max(sky, block).
// But to propagate correctly, we need to track them separately.

// Let's use a Uint8Array where lower 4 bits are block light, upper 4 bits are sky light.
// 0xS B

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
  const getIndex = (x: number, y: number, z: number) =>
    x + y * CHUNK_WIDTH + z * CHUNK_WIDTH * CHUNK_HEIGHT;

  const getBlock = (x: number, y: number, z: number) => {
    if (x < 0 || x >= CHUNK_WIDTH || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_LENGTH) {
      return BlockType.AIR; // Treat out of bounds as air for now, or check borders
    }
    return chunk[getIndex(x, y, z)];
  };

  const isTransparent = (block: BlockType) => TRANSPARENT_BLOCKS.includes(block);

  // Queue for BFS
  const lightQueue: number[] = [];

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
        lightMap[index] = (lightMap[index] & 0x0F) | (sunlight << 4);
        
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
        const block = borders.left[y * CHUNK_LENGTH + z];
        if (isTransparent(block)) {
          const worldX = chunkX * CHUNK_WIDTH - 1;
          const worldY = chunkY * CHUNK_HEIGHT + y;
          const worldZ = chunkZ * CHUNK_LENGTH + z;
          const sY = getSurfaceHeight(noise, worldX, worldZ);
          if (worldY > sY) {
            // Neighbor is lit. Propagate to x=0
            const index = getIndex(0, y, z);
            if (isTransparent(chunk[index])) {
              const current = lightMap[index];
              const currentSky = (current >> 4) & 0xf;
              if (currentSky < 14) {
                lightMap[index] = (14 << 4) | (current & 0xf);
                lightQueue.push(index);
              }
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
        const block = borders.right[y * CHUNK_LENGTH + z];
        if (isTransparent(block)) {
          const worldX = chunkX * CHUNK_WIDTH + CHUNK_WIDTH;
          const worldY = chunkY * CHUNK_HEIGHT + y;
          const worldZ = chunkZ * CHUNK_LENGTH + z;
          const sY = getSurfaceHeight(noise, worldX, worldZ);
          if (worldY > sY) {
            // Neighbor is lit. Propagate to x=CHUNK_WIDTH-1
            const index = getIndex(CHUNK_WIDTH - 1, y, z);
            if (isTransparent(chunk[index])) {
              const current = lightMap[index];
              const currentSky = (current >> 4) & 0xf;
              if (currentSky < 14) {
                lightMap[index] = (14 << 4) | (current & 0xf);
                lightQueue.push(index);
              }
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
        const block = borders.front[x * CHUNK_HEIGHT + y];
        if (isTransparent(block)) {
          const worldX = chunkX * CHUNK_WIDTH + x;
          const worldY = chunkY * CHUNK_HEIGHT + y;
          const worldZ = chunkZ * CHUNK_LENGTH + CHUNK_LENGTH;
          const sY = getSurfaceHeight(noise, worldX, worldZ);
          if (worldY > sY) {
            // Neighbor is lit. Propagate to z=CHUNK_LENGTH-1
            const index = getIndex(x, y, CHUNK_LENGTH - 1);
            if (isTransparent(chunk[index])) {
              const current = lightMap[index];
              const currentSky = (current >> 4) & 0xf;
              if (currentSky < 14) {
                lightMap[index] = (14 << 4) | (current & 0xf);
                lightQueue.push(index);
              }
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
        const block = borders.back[x * CHUNK_HEIGHT + y];
        if (isTransparent(block)) {
          const worldX = chunkX * CHUNK_WIDTH + x;
          const worldY = chunkY * CHUNK_HEIGHT + y;
          const worldZ = chunkZ * CHUNK_LENGTH - 1;
          const sY = getSurfaceHeight(noise, worldX, worldZ);
          if (worldY > sY) {
            // Neighbor is lit. Propagate to z=0
            const index = getIndex(x, y, 0);
            if (isTransparent(chunk[index])) {
              const current = lightMap[index];
              const currentSky = (current >> 4) & 0xf;
              if (currentSky < 14) {
                lightMap[index] = (14 << 4) | (current & 0xf);
                lightQueue.push(index);
              }
            }
          }
        }
      }
    }
  }

  // 2. Propagate Light
  while (lightQueue.length > 0) {
    const index = lightQueue.shift()!;
    const x = index % CHUNK_WIDTH;
    const y = Math.floor(index / CHUNK_WIDTH) % CHUNK_HEIGHT;
    const z = Math.floor(index / (CHUNK_WIDTH * CHUNK_HEIGHT));
    
    const currentLight = lightMap[index];
    const skyLight = (currentLight >> 4) & 0xF;
    const blockLight = currentLight & 0xF;
    
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
      
      if (nx >= 0 && nx < CHUNK_WIDTH && ny >= 0 && ny < CHUNK_HEIGHT && nz >= 0 && nz < CHUNK_LENGTH) {
        const nIndex = getIndex(nx, ny, nz);
        const nBlock = chunk[nIndex];
        
        if (isTransparent(nBlock)) {
          const nLight = lightMap[nIndex];
          const nSkyLight = (nLight >> 4) & 0xF;
          const nBlockLight = nLight & 0xF;
          
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
