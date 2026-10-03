// Fills one chunk: terrain layers and water, chamber caves, ground cover,
// then trees. Everything is a pure function of (seed, chunk coordinates).

import { BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import {
  addWorkerCounter,
  endWorkerSection,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import { getChunkColumnGrid } from "./column-grid";
import { SEA_LEVEL } from "./constants";
import { BiomeId } from "./biomes";
import { createCaveField } from "./caves";
import { solidBlockAt, surfaceTopBlock } from "./surface-layers";
import { chooseGroundCover, writeColumnPlant } from "./vegetation/ground-cover";
import { placeTrees } from "./vegetation/tree-placement";
import { MAX_TREE_FOOTPRINT_RADIUS, MAX_TREE_HEIGHT } from "./trees";
import { getTerrainModel } from "./column-grid";

const X_STRIDE = CHUNK_HEIGHT * CHUNK_LENGTH;
const Y_STRIDE = CHUNK_LENGTH;
const CAVE_MIN_DEPTH = 10;
const HEIGHT_SCAN_STRIDE = 6;
const HEIGHT_SCAN_SLACK = 8;

function chunkIsEntirelyAboveTerrain(seed: number, chunkX: number, chunkY: number, chunkZ: number): boolean {
  const chunkFloorY = chunkY * CHUNK_HEIGHT;
  if (chunkFloorY < SEA_LEVEL) return false;
  const terrain = getTerrainModel(seed);
  const reach = MAX_TREE_FOOTPRINT_RADIUS;
  let highest = SEA_LEVEL;
  for (let offsetX = -reach; offsetX <= CHUNK_WIDTH + reach; offsetX += HEIGHT_SCAN_STRIDE) {
    for (let offsetZ = -reach; offsetZ <= CHUNK_LENGTH + reach; offsetZ += HEIGHT_SCAN_STRIDE) {
      const sample = terrain.sample(chunkX * CHUNK_WIDTH + offsetX, chunkZ * CHUNK_LENGTH + offsetZ);
      highest = Math.max(highest, sample.height, sample.waterLevel);
    }
  }
  return chunkFloorY > highest + HEIGHT_SCAN_SLACK + MAX_TREE_HEIGHT;
}

export function generateChunkBlocks(seed: number, chunkX: number, chunkY: number, chunkZ: number): Uint8Array {
  const blocks = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);

  startWorkerSection("terrainNoise");
  if (chunkIsEntirelyAboveTerrain(seed, chunkX, chunkY, chunkZ)) {
    endWorkerSection();
    addWorkerCounter("skippedAirChunks", 1);
    return blocks;
  }

  const grid = getChunkColumnGrid(seed, chunkX, chunkZ);
  const caves = createCaveField(seed);
  const chunkFloorY = chunkY * CHUNK_HEIGHT;
  let solidBlocks = 0;

  for (let localX = 0; localX < CHUNK_WIDTH; localX++) {
    for (let localZ = 0; localZ < CHUNK_LENGTH; localZ++) {
      const column = grid.localColumn(localX, localZ);
      const { worldX, worldZ, groundTopY } = column;
      const topFilledY = column.isSubmerged ? column.waterLevel - 1 : groundTopY;
      const highestLocalY = Math.min(CHUNK_HEIGHT - 1, topFilledY - chunkFloorY);
      const isFrozen = column.biome.id === BiomeId.FrozenOcean || column.biome.id === BiomeId.FrozenRiver;
      const porousness = groundTopY - CAVE_MIN_DEPTH >= chunkFloorY ? caves.porousnessAt(worldX, worldZ) : 0;

      for (let localY = 0; localY <= highestLocalY; localY++) {
        const worldY = chunkFloorY + localY;
        let block: BlockType;
        if (worldY > groundTopY) {
          block = isFrozen && worldY === column.waterLevel - 1 ? BlockType.ICE : BlockType.WATER;
        } else {
          block = solidBlockAt(column, worldY, worldX, worldZ, seed);
          if (groundTopY - worldY > CAVE_MIN_DEPTH && caves.isCave(worldX, worldY, worldZ, porousness)) {
            block = BlockType.AIR;
          }
          if (block !== BlockType.AIR) solidBlocks++;
        }
        blocks[localX * X_STRIDE + localY * Y_STRIDE + localZ] = block;
      }
    }
  }
  endWorkerSection();

  startWorkerSection("floraPlacement");
  let plantsPlaced = 0;
  for (let localX = 0; localX < CHUNK_WIDTH; localX++) {
    for (let localZ = 0; localZ < CHUNK_LENGTH; localZ++) {
      const column = grid.localColumn(localX, localZ);
      const coverTopY = column.isSubmerged ? column.waterLevel : column.groundTopY + 1;
      if (coverTopY + 3 < chunkFloorY || column.groundTopY >= chunkFloorY + CHUNK_HEIGHT) continue;
      const groundBlock = surfaceTopBlock(column, column.worldX, column.worldZ, seed);
      const cover = chooseGroundCover({ column, groundBlock: column.isSubmerged ? BlockType.AIR : groundBlock, seed });
      if (cover && writeColumnPlant(blocks, localX, localZ, chunkFloorY, cover)) plantsPlaced++;
    }
  }
  endWorkerSection();

  startWorkerSection("treePlacement");
  const treesPlaced = placeTrees(blocks, seed, chunkX, chunkY, chunkZ, grid);
  endWorkerSection();

  addWorkerCounter("blocksGenerated", blocks.length);
  addWorkerCounter("solidBlocks", solidBlocks);
  addWorkerCounter("treesPlaced", treesPlaced);
  addWorkerCounter("floraPlaced", plantsPlaced);
  return blocks;
}
