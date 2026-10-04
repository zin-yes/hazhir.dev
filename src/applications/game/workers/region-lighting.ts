import type { LightChunkSource } from "../edits/chunk-cluster";
import { mergeLightUpdatesInPlace } from "../edits/merge-light";
import {
  addWorkerCounter,
  endWorkerSection,
  startWorkerSection,
} from "../profiler/worker-recorder";
import { initializeChunkLightFromAbove, propagateChunkLight } from "./lighting";

export interface RegionChunk {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  blocks: Uint8Array;
}

export interface RegionChunkLight {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  light: Uint8Array;
}

export interface RegionLightResult {
  /** The final light of every chunk handed in, in the same order. */
  chunkLights: RegionChunkLight[];
  /**
   * Chunks outside the region (from the surroundings) that light from the
   * region reached. Each holds only the brightened copy; the caller raises its
   * own light to this with mergeLightInPlace.
   */
  surroundingUpdates: RegionChunkLight[];
}

const FACE_NEIGHBORS: { key: string; dx: number; dy: number; dz: number }[] = [
  { key: "1,0,0", dx: 1, dy: 0, dz: 0 },
  { key: "-1,0,0", dx: -1, dy: 0, dz: 0 },
  { key: "0,1,0", dx: 0, dy: 1, dz: 0 },
  { key: "0,-1,0", dx: 0, dy: -1, dz: 0 },
  { key: "0,0,1", dx: 0, dy: 0, dz: 1 },
  { key: "0,0,-1", dx: 0, dy: 0, dz: -1 },
];

const chunkKey = (chunkX: number, chunkY: number, chunkZ: number) =>
  `${chunkX},${chunkY},${chunkZ}`;

/**
 * Lights a whole set of freshly generated chunks in one call, the way the
 * game's load pass does it chunk by chunk: each column top-down with the chunk
 * above as input, then every chunk spreads into and out of its face neighbors,
 * and the updates for each chunk are merged in place. Doing it here replaces
 * two worker round trips per chunk and the main-thread merge with one call.
 *
 * Chunks already lit that border the region (the surroundings) are read as
 * neighbors, and any light that reaches them comes back as surroundingUpdates.
 * Input arrays are never modified; the returned light arrays are new and can
 * be transferred.
 */
export function lightChunkRegion(
  chunks: ArrayLike<RegionChunk>,
  surroundings?: LightChunkSource,
): RegionLightResult {
  const regionIndexByKey = new Map<string, number>();
  for (let position = 0; position < chunks.length; position++) {
    const { chunkX, chunkY, chunkZ } = chunks[position];
    regionIndexByKey.set(chunkKey(chunkX, chunkY, chunkZ), position);
  }

  const initialLights: Uint8Array[] = new Array(chunks.length);
  const seedQueues: Uint32Array[] = new Array(chunks.length);

  startWorkerSection("initializeRegionColumns");
  const topDownOrder = Array.from({ length: chunks.length }, (_, position) => position)
    .sort((first, second) => chunks[second].chunkY - chunks[first].chunkY);
  for (const position of topDownOrder) {
    const { chunkX, chunkY, chunkZ, blocks } = chunks[position];
    const aboveIndex = regionIndexByKey.get(chunkKey(chunkX, chunkY + 1, chunkZ));
    const topBlocks =
      aboveIndex !== undefined
        ? chunks[aboveIndex].blocks
        : surroundings?.getBlocks(chunkX, chunkY + 1, chunkZ);
    const topLight =
      aboveIndex !== undefined
        ? initialLights[aboveIndex]
        : surroundings?.getLight(chunkX, chunkY + 1, chunkZ);
    const { light, queue } = initializeChunkLightFromAbove(
      blocks,
      chunkY,
      topBlocks,
      topLight,
    );
    initialLights[position] = light;
    seedQueues[position] = queue;
  }
  endWorkerSection();

  const regionUpdates: Uint8Array[][] = Array.from(
    { length: chunks.length },
    () => [],
  );
  const surroundingUpdatesByKey = new Map<string, RegionChunkLight & { updates: Uint8Array[] }>();

  startWorkerSection("propagateRegionChunks");
  for (let position = 0; position < chunks.length; position++) {
    const { chunkX, chunkY, chunkZ, blocks } = chunks[position];
    const neighborBlocks: { [key: string]: Uint8Array } = {};
    const neighborLights: { [key: string]: Uint8Array } = {};
    for (const { key, dx, dy, dz } of FACE_NEIGHBORS) {
      const neighborIndex = regionIndexByKey.get(
        chunkKey(chunkX + dx, chunkY + dy, chunkZ + dz),
      );
      const neighborBlocksArray =
        neighborIndex !== undefined
          ? chunks[neighborIndex].blocks
          : surroundings?.getBlocks(chunkX + dx, chunkY + dy, chunkZ + dz);
      const neighborLightArray =
        neighborIndex !== undefined
          ? initialLights[neighborIndex]
          : surroundings?.getLight(chunkX + dx, chunkY + dy, chunkZ + dz);
      if (!neighborBlocksArray || !neighborLightArray) continue;
      neighborBlocks[key] = neighborBlocksArray;
      neighborLights[key] = neighborLightArray;
    }

    const { centerLight, neighborLightUpdates } = propagateChunkLight(
      blocks,
      initialLights[position].slice(),
      neighborBlocks,
      neighborLights,
      seedQueues[position],
    );
    regionUpdates[position].push(centerLight);

    for (const { key, dx, dy, dz } of FACE_NEIGHBORS) {
      const update = neighborLightUpdates[key];
      if (!update) continue;
      const neighborX = chunkX + dx;
      const neighborY = chunkY + dy;
      const neighborZ = chunkZ + dz;
      const neighborIndex = regionIndexByKey.get(chunkKey(neighborX, neighborY, neighborZ));
      if (neighborIndex !== undefined) {
        regionUpdates[neighborIndex].push(update);
        continue;
      }
      const surroundingKey = chunkKey(neighborX, neighborY, neighborZ);
      const existing = surroundingUpdatesByKey.get(surroundingKey);
      if (existing) existing.updates.push(update);
      else
        surroundingUpdatesByKey.set(surroundingKey, {
          chunkX: neighborX,
          chunkY: neighborY,
          chunkZ: neighborZ,
          light: update,
          updates: [update],
        });
    }
  }
  endWorkerSection();

  startWorkerSection("mergeRegionUpdates");
  const chunkLights: RegionChunkLight[] = [];
  for (let position = 0; position < chunks.length; position++) {
    const { chunkX, chunkY, chunkZ } = chunks[position];
    const updates = regionUpdates[position];
    chunkLights.push({
      chunkX,
      chunkY,
      chunkZ,
      light: mergeLightUpdatesInPlace(updates[0], updates.slice(1)),
    });
  }
  const surroundingUpdates: RegionChunkLight[] = [];
  for (const entry of surroundingUpdatesByKey.values()) {
    surroundingUpdates.push({
      chunkX: entry.chunkX,
      chunkY: entry.chunkY,
      chunkZ: entry.chunkZ,
      light: mergeLightUpdatesInPlace(entry.updates[0], entry.updates.slice(1)),
    });
  }
  endWorkerSection();

  addWorkerCounter("regionChunksLit", chunks.length);
  addWorkerCounter("surroundingChunksUpdated", surroundingUpdates.length);
  return { chunkLights, surroundingUpdates };
}

export interface LitSurroundingChunk extends RegionChunk {
  light: Uint8Array;
}

/** Wraps already lit chunks around a region as the source lightChunkRegion reads neighbors from. */
export function createSurroundingsSource(
  surroundingChunks: ArrayLike<LitSurroundingChunk>,
): LightChunkSource {
  const chunksByKey = new Map<string, LitSurroundingChunk>();
  for (let position = 0; position < surroundingChunks.length; position++) {
    const chunk = surroundingChunks[position];
    chunksByKey.set(chunkKey(chunk.chunkX, chunk.chunkY, chunk.chunkZ), chunk);
  }
  return {
    getBlocks: (chunkX, chunkY, chunkZ) =>
      chunksByKey.get(chunkKey(chunkX, chunkY, chunkZ))?.blocks,
    getLight: (chunkX, chunkY, chunkZ) =>
      chunksByKey.get(chunkKey(chunkX, chunkY, chunkZ))?.light,
  };
}

/** Every buffer in the result, for the transfer list of a worker reply. */
export function listRegionTransferables(result: RegionLightResult): Transferable[] {
  return [...result.chunkLights, ...result.surroundingUpdates].map(
    (entry) => entry.light.buffer,
  );
}
