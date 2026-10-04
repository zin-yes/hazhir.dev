import { BlockType, getWaterLevel } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";

import { DIMENSIONS } from "../profiler/dimensions";
import {
  addWorkerCounter,
  addWorkerKeyedUnits,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "../profiler/worker-recorder";
import {
  CHUNK_UV_UNITS_PER_BLOCK,
  INDICES_PER_QUAD,
  PLANT_NEIGHBOR_DIRECTIONS,
  POSITION_UNITS_PER_BLOCK,
  VERTICES_PER_QUAD,
  packPlantInstance,
} from "../vertex-format";
import {
  emitFaceQuad,
  lightKnownByOutsideFlags,
  sampleFaceSurface,
  updateLightKnownFlags,
} from "./face-surface";
import { mergeRecordedFaces, recordMergeableFace } from "./greedy-grid";
import {
  BLOCK_ID_COUNT,
  BLOCK_KIND,
  BLOCK_KIND_PLANT,
  BLOCK_KIND_SLAB,
  BLOCK_KIND_STAIRS,
  BLOCK_KIND_WATER,
  BLOCK_ROW_FLAGS,
  FACE_COUNT,
  FACE_DOWN,
  FACE_KINDS,
  FACE_NEIGHBOR_DELTAS,
  FACE_TEXTURES,
  FACE_UP,
  FACE_V_FORWARD,
  IS_TOP_SLAB,
  IS_TRANSLUCENT,
  IS_WATER,
  LIGHT_LEVEL_OF_PACKED_LIGHT,
  OCCLUDES_AMBIENT_LIGHT,
  OUTSIDE_FACE_FLAGS,
  RECEIVES_AMBIENT_OCCLUSION,
  ROW_FLAG_CUBE_OCCLUDER,
  ROW_FLAG_OCCLUDER,
  isFaceCulledMemoized,
} from "./mesh-tables";
import type { ChunkFaceBuffers, ChunkMeshResult, PlantInstanceBatch } from "./mesh-types";
import { fillPaddedGrid, paddedBlockGrid, paddedLightGrid } from "./padded-grid";
import { paddedDelta, paddedIndex } from "./padded-layout";
import { buildRowOccupancy, visibleCellsOfRow } from "./row-occupancy";
import { emitStairs } from "./stairs";
import { VertexStream } from "./vertex-stream";

const MESH_PART_OPAQUE = "opaque";
const MESH_PART_TRANSPARENT = "transparent";
const MESH_PART_PLANTS = "plants";
const MESH_PART_STAIRS = "stairs";
const CELLS_PER_CHUNK = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;
const FULL_BLOCK_HEIGHT = POSITION_UNITS_PER_BLOCK;
const WATER_LEVELS_PER_BLOCK = 9;

const PLANT_NEIGHBOR_DELTAS = PLANT_NEIGHBOR_DIRECTIONS.map(([deltaX, deltaY, deltaZ]) =>
  paddedDelta(deltaX, deltaY, deltaZ)
);

// Streams and scratch buffers live across tasks: a worker meshes one chunk at a
// time, and reusing them avoids reallocating on every chunk.
const opaqueStream = new VertexStream();
const transparentStream = new VertexStream();
const plantCellWords = new Uint32Array(CELLS_PER_CHUNK);
const plantCellBlocks = new Uint8Array(CELLS_PER_CHUNK);
const facesByBlockId = new Int32Array(BLOCK_ID_COUNT);

const stats = {
  cellsVisited: 0,
  translucentCells: 0,
  stairCells: 0,
  plantCells: 0,
  facesCulled: 0,
  cubeFacesEmitted: 0,
  mergeableFaces: 0,
  stairQuads: 0,
};

function resetStats() {
  stats.cellsVisited = 0;
  stats.translucentCells = 0;
  stats.stairCells = 0;
  stats.plantCells = 0;
  stats.facesCulled = 0;
  stats.cubeFacesEmitted = 0;
  stats.mergeableFaces = 0;
  stats.stairQuads = 0;
  facesByBlockId.fill(0);
}

const EMPTY_RESULT = (): ChunkMeshResult => ({
  opaque: new ArrayBuffer(0),
  transparent: new ArrayBuffer(0),
  plants: [],
});

function reportFacesPerBlockType() {
  for (let blockId = 0; blockId < BLOCK_ID_COUNT; blockId++) {
    const faceCount = facesByBlockId[blockId];
    if (faceCount === 0) continue;
    addWorkerKeyedUnits(DIMENSIONS.meshBlockFaces, BlockType[blockId] ?? `block${blockId}`, faceCount);
  }
}

// Order matches FACE_NORMALS: up, down, front, back, left, right.
const FACE_BORDER_NAMES: Array<keyof ChunkFaceBuffers> = ["top", "bottom", "front", "back", "left", "right"];

function countSlabs(borders: ChunkFaceBuffers): number {
  return FACE_BORDER_NAMES.filter((face) => Boolean(borders[face])).length;
}

/** The block id when every cell of the chunk is the same block, else -1. */
function findUniformBlock(chunkWords: Uint32Array): number {
  const firstWord = chunkWords[0];
  const block = firstWord & 0xff;
  if (firstWord !== block * 0x01010101) return -1;
  for (let word = 1; word < chunkWords.length; word++) {
    if (chunkWords[word] !== firstWord) return -1;
  }
  return block;
}

function isEverySlabOccluding(borders: ChunkFaceBuffers): boolean {
  for (const face of FACE_BORDER_NAMES) {
    const slab = borders[face];
    if (!slab) return false;
    const cells = new Uint8Array(slab);
    for (let cell = 0; cell < cells.length; cell++) {
      if ((BLOCK_ROW_FLAGS[cells[cell]] & ROW_FLAG_OCCLUDER) === 0) return false;
    }
  }
  return true;
}

function recordPlant(block: number, x: number, y: number, z: number, cellIndex: number) {
  const blocks = paddedBlockGrid.cells;
  let neighborMask = 0;
  for (let direction = 0; direction < PLANT_NEIGHBOR_DELTAS.length; direction++) {
    if (OCCLUDES_AMBIENT_LIGHT[blocks[cellIndex + PLANT_NEIGHBOR_DELTAS[direction]]]) {
      neighborMask |= 1 << direction;
    }
  }
  const ownLevel = LIGHT_LEVEL_OF_PACKED_LIGHT[paddedLightGrid.cells[cellIndex]];
  plantCellWords[stats.plantCells] = packPlantInstance(x, y, z, ownLevel, neighborMask);
  plantCellBlocks[stats.plantCells] = block;
  stats.plantCells++;
}

function packPlantBatches(): PlantInstanceBatch[] {
  const instanceCountByBlock = new Uint32Array(BLOCK_ID_COUNT);
  for (let plant = 0; plant < stats.plantCells; plant++) instanceCountByBlock[plantCellBlocks[plant]]++;
  const batches: PlantInstanceBatch[] = [];
  const writtenByBlock = new Uint32Array(BLOCK_ID_COUNT);
  const instancesByBlock: Array<Uint32Array | undefined> = new Array(BLOCK_ID_COUNT);
  for (let block = 0; block < BLOCK_ID_COUNT; block++) {
    if (instanceCountByBlock[block] === 0) continue;
    const instances = new Uint32Array(instanceCountByBlock[block]);
    instancesByBlock[block] = instances;
    batches.push({ blockType: block, instances: instances.buffer as ArrayBuffer });
  }
  for (let plant = 0; plant < stats.plantCells; plant++) {
    const block = plantCellBlocks[plant];
    instancesByBlock[block]![writtenByBlock[block]++] = plantCellWords[plant];
  }
  return batches;
}

function emitCubeFaces(
  block: number,
  kind: number,
  x: number,
  y: number,
  z: number,
  cellIndex: number,
  isEdgeCell: boolean
) {
  const blocks = paddedBlockGrid.cells;
  const light = paddedLightGrid.cells;
  const ownLevel = LIGHT_LEVEL_OF_PACKED_LIGHT[light[cellIndex]];
  const receivesAmbientOcclusion = RECEIVES_AMBIENT_OCCLUSION[block] === 1;
  const isTranslucent = IS_TRANSLUCENT[block] === 1;
  const target = isTranslucent ? transparentStream : opaqueStream;
  if (isTranslucent) stats.translucentCells++;

  // Slabs and the water surface are not full blocks: they keep their own height,
  // and only the faces that stay on a single plane may merge with their neighbors.
  let blockHeight16 = FULL_BLOCK_HEIGHT;
  let bottomOffset16 = 0;
  let rowTopV = 0;
  let rowBottomV = CHUNK_UV_UNITS_PER_BLOCK;
  let canMergeSides = true;
  if (kind === BLOCK_KIND_SLAB) {
    blockHeight16 = FULL_BLOCK_HEIGHT / 2;
    canMergeSides = false;
    if (IS_TOP_SLAB[block]) {
      bottomOffset16 = FULL_BLOCK_HEIGHT / 2;
      rowBottomV = CHUNK_UV_UNITS_PER_BLOCK / 2;
    } else {
      rowTopV = CHUNK_UV_UNITS_PER_BLOCK / 2;
    }
  } else if (kind === BLOCK_KIND_WATER && !IS_WATER[blocks[cellIndex + FACE_NEIGHBOR_DELTAS[FACE_UP]]]) {
    blockHeight16 = Math.round((getWaterLevel(block) / WATER_LEVELS_PER_BLOCK) * FULL_BLOCK_HEIGHT);
    canMergeSides = false;
  }
  const canMergeHorizontalFaces = kind !== BLOCK_KIND_SLAB;

  for (let face = 0; face < FACE_COUNT; face++) {
    const neighborIndex = cellIndex + FACE_NEIGHBOR_DELTAS[face];
    if (isFaceCulledMemoized(block, blocks[neighborIndex], FACE_KINDS[face])) {
      stats.facesCulled++;
      continue;
    }

    const faceLevel =
      isEdgeCell && lightKnownByOutsideFlags[OUTSIDE_FACE_FLAGS[neighborIndex]] === 0
        ? ownLevel
        : LIGHT_LEVEL_OF_PACKED_LIGHT[light[neighborIndex]];
    const mergeDirections = sampleFaceSurface(face, cellIndex, faceLevel, receivesAmbientOcclusion, isEdgeCell);
    stats.cubeFacesEmitted++;
    facesByBlockId[block]++;
    const textureIndex = FACE_TEXTURES[face][block];

    const isHorizontalFace = face <= FACE_DOWN;
    const canMerge = isHorizontalFace ? canMergeHorizontalFaces : canMergeSides && canMergeHorizontalFaces;
    if (mergeDirections !== 0 && canMerge) {
      stats.mergeableFaces++;
      recordMergeableFace(
        face,
        x,
        y,
        z,
        textureIndex,
        isTranslucent,
        face === FACE_UP ? blockHeight16 : 0,
        mergeDirections
      );
      continue;
    }

    const isVForward = FACE_V_FORWARD[face] === 1;
    const fullTextureV = CHUNK_UV_UNITS_PER_BLOCK;
    emitFaceQuad(
      target,
      face,
      x * POSITION_UNITS_PER_BLOCK,
      y * POSITION_UNITS_PER_BLOCK + bottomOffset16,
      z * POSITION_UNITS_PER_BLOCK,
      POSITION_UNITS_PER_BLOCK,
      blockHeight16,
      POSITION_UNITS_PER_BLOCK,
      CHUNK_UV_UNITS_PER_BLOCK,
      isHorizontalFace ? (isVForward ? 0 : fullTextureV) : rowBottomV,
      isHorizontalFace ? (isVForward ? fullTextureV : 0) : rowTopV,
      textureIndex
    );
  }
}

export function generateMesh(
  _chunk: ArrayBuffer,
  _lightBuffer: ArrayBuffer,
  borders: ChunkFaceBuffers = {},
  borderLights: ChunkFaceBuffers = {},
  // Kept for callers that still pass the world position; the mesher no longer samples terrain.
  _seed: number = 0,
  _chunkX: number = 0,
  _chunkY: number = 0,
  _chunkZ: number = 0
): ChunkMeshResult {
  startWorkerSection("unpackInputs");

  startWorkerSection("emptyScan");
  const uniformBlock = findUniformBlock(new Uint32Array(_chunk));
  const isAir = uniformBlock === BlockType.AIR;
  const isBuried =
    uniformBlock > 0 &&
    (BLOCK_ROW_FLAGS[uniformBlock] & ROW_FLAG_CUBE_OCCLUDER) !== 0 &&
    isEverySlabOccluding(borders);
  endWorkerSection();
  if (isAir || isBuried) {
    endWorkerSection();
    addWorkerCounter("blocksScanned", CELLS_PER_CHUNK);
    addWorkerCounter(isAir ? "emptyChunksSkipped" : "buriedChunksSkipped", 1);
    return EMPTY_RESULT();
  }

  startWorkerSection("fillPaddedBlocks");
  fillPaddedGrid(paddedBlockGrid, _chunk, borders, true);
  endWorkerSection();
  startWorkerSection("fillPaddedLight");
  fillPaddedGrid(paddedLightGrid, _lightBuffer, borderLights, false);
  updateLightKnownFlags(FACE_BORDER_NAMES.map((face) => Boolean(borderLights[face])));
  endWorkerSection();
  startWorkerSection("buildRowOccupancy");
  buildRowOccupancy();
  endWorkerSection();
  endWorkerSection();
  addWorkerCounter("borderSlabsCopied", countSlabs(borders) + countSlabs(borderLights));

  resetStats();
  opaqueStream.reset();
  transparentStream.reset();
  const blocks = paddedBlockGrid.cells;
  const light = paddedLightGrid.cells;

  startWorkerSection("faceGeneration");
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      let visibleCells = visibleCellsOfRow(x, y);
      if (visibleCells === 0) continue;
      const firstCell = paddedIndex(x, y, 0);
      const isEdgeRow = x === 0 || x === CHUNK_WIDTH - 1 || y === 0 || y === CHUNK_HEIGHT - 1;
      while (visibleCells !== 0) {
        const z = 31 - Math.clz32(visibleCells & -visibleCells);
        visibleCells &= visibleCells - 1;
        const cellIndex = firstCell + z;
        const block = blocks[cellIndex];
        const kind = BLOCK_KIND[block];
        stats.cellsVisited++;

        if (kind === BLOCK_KIND_PLANT) {
          recordPlant(block, x, y, z, cellIndex);
        } else if (kind === BLOCK_KIND_STAIRS) {
          const verticesBefore = opaqueStream.vertexCount;
          emitStairs(opaqueStream, block, x, y, z, LIGHT_LEVEL_OF_PACKED_LIGHT[light[cellIndex]], cellIndex);
          const quads = (opaqueStream.vertexCount - verticesBefore) / VERTICES_PER_QUAD;
          stats.stairCells++;
          stats.stairQuads += quads;
          facesByBlockId[block] += quads;
        } else {
          emitCubeFaces(block, kind, x, y, z, cellIndex, isEdgeRow || z === 0 || z === CHUNK_LENGTH - 1);
        }
      }
    }
  }
  startWorkerSection("greedyMerge");
  const mergedQuads = mergeRecordedFaces(opaqueStream, transparentStream);
  endWorkerSection();
  endWorkerSection();

  startWorkerSection("packResult");
  startWorkerSection("plantInstanceBuffers", DIMENSIONS.meshPart, MESH_PART_PLANTS);
  const plants = packPlantBatches();
  endWorkerSection();
  startWorkerSection("opaqueBuffer", DIMENSIONS.meshPart, MESH_PART_OPAQUE);
  const opaqueBuffer = opaqueStream.toBuffer();
  endWorkerSection();
  startWorkerSection("transparentBuffer", DIMENSIONS.meshPart, MESH_PART_TRANSPARENT);
  const transparentBuffer = transparentStream.toBuffer();
  endWorkerSection();
  const result: ChunkMeshResult = {
    opaque: opaqueBuffer,
    transparent: transparentBuffer,
    plants,
  };
  endWorkerSection();

  const totalQuads = (opaqueStream.vertexCount + transparentStream.vertexCount) / VERTICES_PER_QUAD;
  addWorkerCounter("blocksScanned", CELLS_PER_CHUNK);
  addWorkerCounter("solidBlocksVisited", stats.cellsVisited);
  addWorkerCounter("translucentBlocksVisited", stats.translucentCells);
  addWorkerCounter("stairBlocksVisited", stats.stairCells);
  addWorkerCounter("facesEmitted", stats.cubeFacesEmitted + stats.stairQuads);
  addWorkerCounter("quadsEmitted", totalQuads);
  addWorkerCounter("mergeableFaces", stats.mergeableFaces);
  addWorkerCounter("mergedQuads", mergedQuads);
  addWorkerCounter("stairQuadsEmitted", stats.stairQuads);
  addWorkerCounter("facesCulled", stats.facesCulled);
  addWorkerCounter("opaqueVertices", opaqueStream.vertexCount);
  addWorkerCounter("transparentVertices", transparentStream.vertexCount);
  addWorkerCounter("plantInstancesEmitted", stats.plantCells);
  if (isWorkerProfiling()) {
    addWorkerCounter("opaqueBytes", opaqueBuffer.byteLength);
    addWorkerCounter("transparentBytes", transparentBuffer.byteLength);
    addWorkerCounter(
      "plantBytes",
      plants.reduce((total, batch) => total + batch.instances.byteLength, 0)
    );
    addWorkerCounter("impliedIndices", totalQuads * INDICES_PER_QUAD);
    reportFacesPerBlockType();
    addWorkerKeyedUnits(
      DIMENSIONS.meshPart,
      MESH_PART_OPAQUE,
      opaqueStream.vertexCount / VERTICES_PER_QUAD - stats.stairQuads
    );
    addWorkerKeyedUnits(DIMENSIONS.meshPart, MESH_PART_TRANSPARENT, transparentStream.vertexCount / VERTICES_PER_QUAD);
    addWorkerKeyedUnits(DIMENSIONS.meshPart, MESH_PART_STAIRS, stats.stairQuads);
    addWorkerKeyedUnits(DIMENSIONS.meshPart, MESH_PART_PLANTS, stats.plantCells);
  }

  return result;
}

export function listTransferables(result: ChunkMeshResult): ArrayBuffer[] {
  startWorkerSection("listTransferables");
  const transferables = [
    result.opaque,
    result.transparent,
    ...result.plants.map((batch) => batch.instances),
  ];
  endWorkerSection();
  addWorkerCounter("transferableBuffers", transferables.length);
  return transferables;
}
