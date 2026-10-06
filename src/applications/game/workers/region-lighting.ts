import { CELLS_PER_CHUNK, type LightChunkSource } from "../edits/chunk-cluster";
import { mergeLightUpdatesInPlace } from "../edits/merge-light";
import {
  addWorkerCounter,
  endWorkerSection,
  startWorkerSampledSection,
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

const NEIGHBOR_GATHER_SAMPLE_INTERVAL = 8;

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
  startWorkerSection("indexRegionChunks");
  for (let position = 0; position < chunks.length; position++) {
    const { chunkX, chunkY, chunkZ } = chunks[position];
    regionIndexByKey.set(chunkKey(chunkX, chunkY, chunkZ), position);
  }
  endWorkerSection();

  const initialLights: Uint8Array[] = new Array(chunks.length);
  const seedQueues: Uint32Array[] = new Array(chunks.length);

  let columnsAboveInRegion = 0;
  let columnsAboveInSurroundings = 0;
  let columnsWithNothingAbove = 0;
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
    if (aboveIndex !== undefined) columnsAboveInRegion++;
    else if (topBlocks) columnsAboveInSurroundings++;
    else columnsWithNothingAbove++;
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

  let neighborsInRegion = 0;
  let neighborsInSurroundings = 0;
  let neighborsMissing = 0;
  let updatesRoutedToRegion = 0;
  let updatesRoutedToSurroundings = 0;
  startWorkerSection("propagateRegionChunks");
  for (let position = 0; position < chunks.length; position++) {
    const { chunkX, chunkY, chunkZ, blocks } = chunks[position];
    startWorkerSampledSection("gatherNeighbors", NEIGHBOR_GATHER_SAMPLE_INTERVAL);
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
      if (!neighborBlocksArray || !neighborLightArray) {
        neighborsMissing++;
        continue;
      }
      if (neighborIndex !== undefined) neighborsInRegion++;
      else neighborsInSurroundings++;
      neighborBlocks[key] = neighborBlocksArray;
      neighborLights[key] = neighborLightArray;
    }
    endWorkerSection();

    const { centerLight, neighborLightUpdates } = propagateChunkLight(
      blocks,
      initialLights[position].slice(),
      neighborBlocks,
      neighborLights,
      seedQueues[position],
    );
    regionUpdates[position].push(centerLight);

    startWorkerSampledSection("routeNeighborUpdates", NEIGHBOR_GATHER_SAMPLE_INTERVAL);
    for (const { key, dx, dy, dz } of FACE_NEIGHBORS) {
      const update = neighborLightUpdates[key];
      if (!update) continue;
      const neighborX = chunkX + dx;
      const neighborY = chunkY + dy;
      const neighborZ = chunkZ + dz;
      const neighborIndex = regionIndexByKey.get(chunkKey(neighborX, neighborY, neighborZ));
      if (neighborIndex !== undefined) {
        updatesRoutedToRegion++;
        regionUpdates[neighborIndex].push(update);
        continue;
      }
      updatesRoutedToSurroundings++;
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
    endWorkerSection();
  }
  endWorkerSection();

  startWorkerSection("mergeRegionUpdates");
  let lightUpdatesMerged = 0;
  const chunkLights: RegionChunkLight[] = [];
  startWorkerSection("mergeRegionChunks");
  for (let position = 0; position < chunks.length; position++) {
    const { chunkX, chunkY, chunkZ } = chunks[position];
    const updates = regionUpdates[position];
    lightUpdatesMerged += updates.length - 1;
    chunkLights.push({
      chunkX,
      chunkY,
      chunkZ,
      light: mergeLightUpdatesInPlace(updates[0], updates.slice(1)),
    });
  }
  endWorkerSection();
  const surroundingUpdates: RegionChunkLight[] = [];
  startWorkerSection("mergeSurroundingChunks");
  for (const entry of surroundingUpdatesByKey.values()) {
    lightUpdatesMerged += entry.updates.length - 1;
    surroundingUpdates.push({
      chunkX: entry.chunkX,
      chunkY: entry.chunkY,
      chunkZ: entry.chunkZ,
      light: mergeLightUpdatesInPlace(entry.updates[0], entry.updates.slice(1)),
    });
  }
  endWorkerSection();
  endWorkerSection();

  addWorkerCounter("regionChunksLit", chunks.length);
  addWorkerCounter("surroundingChunksUpdated", surroundingUpdates.length);
  addWorkerCounter("regionColumnsAboveInRegion", columnsAboveInRegion);
  addWorkerCounter("regionColumnsAboveInSurroundings", columnsAboveInSurroundings);
  addWorkerCounter("regionColumnsNothingAbove", columnsWithNothingAbove);
  addWorkerCounter("regionNeighborsInRegion", neighborsInRegion);
  addWorkerCounter("regionNeighborsInSurroundings", neighborsInSurroundings);
  addWorkerCounter("regionNeighborsMissing", neighborsMissing);
  addWorkerCounter("regionUpdatesRoutedToRegion", updatesRoutedToRegion);
  addWorkerCounter("regionUpdatesRoutedToSurroundings", updatesRoutedToSurroundings);
  addWorkerCounter("regionLightUpdatesMerged", lightUpdatesMerged);
  addWorkerCounter("regionLightCloneBytes", chunks.length * CELLS_PER_CHUNK);
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
  addWorkerCounter("regionResultChunkBytes", result.chunkLights.length * CELLS_PER_CHUNK);
  addWorkerCounter("regionResultSurroundingBytes", result.surroundingUpdates.length * CELLS_PER_CHUNK);
  return [...result.chunkLights, ...result.surroundingUpdates].map(
    (entry) => entry.light.buffer,
  );
}
