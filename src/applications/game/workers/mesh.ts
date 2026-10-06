import { BlockType, getWaterLevel } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";

import { DIMENSIONS } from "../profiler/dimensions";
import {
  addWorkerCounter,
  addWorkerKeyedUnits,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSampledSection,
  startWorkerSection,
} from "../profiler/worker-recorder";
import {
  CHUNK_UV_UNITS_PER_BLOCK,
  INDICES_PER_QUAD,
  PLANT_NEIGHBOR_DIRECTIONS,
  POSITION_UNITS_PER_BLOCK,
  VERTICES_PER_QUAD,
  packPlantInstance,
  packPositionWord,
} from "../vertex-format";
import {
  emitFaceQuad,
  faceLightLevel,
  faceSurfaceStats,
  lightKnownByOutsideFlags,
  resetFaceSurfaceStats,
  sampleFaceSurface,
  updateLightKnownFlags,
} from "./face-surface";
import {
  FACE_DIRECTION_NAMES,
  greedyMergeStats,
  mergeRecordedFaces,
  recordMergeableFace,
  resetGreedyMergeStats,
} from "./greedy-grid";
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
import { PADDED_VOLUME, paddedDelta, paddedIndex } from "./padded-layout";
import { buildRowOccupancy, countSetBits, exposedCubeFaceCells, prepareRow, rowIndexOf } from "./row-occupancy";
import { emitStairs, resetStairStats, stairStats } from "./stairs";
import { VertexStream } from "./vertex-stream";

const MESH_PART_OPAQUE = "opaque";
const MESH_PART_TRANSPARENT = "transparent";
const MESH_PART_PLANTS = "plants";
const MESH_PART_STAIRS = "stairs";
const CELLS_PER_CHUNK = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;
const FULL_BLOCK_HEIGHT = POSITION_UNITS_PER_BLOCK;
const WATER_LEVELS_PER_BLOCK = 9;
const BYTES_PER_WORD = 4;
const VERTEX_ATTRIBUTE_POSITION = "position";
const VERTEX_ATTRIBUTE_SURFACE = "surface";
const ROW_SAMPLE_INTERVAL = 32;
const STAIR_SAMPLE_INTERVAL = 8;
const MERGEABLE_FACE_COUNTER_NAMES = FACE_DIRECTION_NAMES.map((name) => `mergeableFaces.${name}`);

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
  cubeFacesEmitted: 0,
  mergeableFaces: 0,
  stairQuads: 0,
  rowsScanned: 0,
  emptyRows: 0,
  opaqueBulkFaces: 0,
  facesCulledByNeighbor: 0,
  translucentFaces: 0,
  slabCells: 0,
  waterCells: 0,
};

function resetStats() {
  stats.cellsVisited = 0;
  stats.translucentCells = 0;
  stats.stairCells = 0;
  stats.plantCells = 0;
  stats.cubeFacesEmitted = 0;
  stats.mergeableFaces = 0;
  stats.stairQuads = 0;
  stats.rowsScanned = 0;
  stats.emptyRows = 0;
  stats.opaqueBulkFaces = 0;
  stats.facesCulledByNeighbor = 0;
  stats.translucentFaces = 0;
  stats.slabCells = 0;
  stats.waterCells = 0;
  facesByBlockId.fill(0);
  resetFaceSurfaceStats();
  resetGreedyMergeStats();
  resetStairStats();
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

function countSlabCells(borders: ChunkFaceBuffers): number {
  let cells = 0;
  for (const face of FACE_BORDER_NAMES) cells += borders[face]?.byteLength ?? 0;
  return cells;
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
  isEdgeCell: boolean,
  rowIndex: number
) {
  const blocks = paddedBlockGrid.cells;
  const light = paddedLightGrid.cells;
  const ownLevel = LIGHT_LEVEL_OF_PACKED_LIGHT[light[cellIndex]];
  const receivesAmbientOcclusion = RECEIVES_AMBIENT_OCCLUSION[block] === 1;
  const isTranslucent = IS_TRANSLUCENT[block] === 1;
  const target = isTranslucent ? transparentStream : opaqueStream;
  if (isTranslucent) stats.translucentCells++;
  if (kind === BLOCK_KIND_SLAB) stats.slabCells++;
  else if (kind === BLOCK_KIND_WATER) stats.waterCells++;

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
      stats.facesCulledByNeighbor++;
      continue;
    }

    const faceLevel = faceLightLevel(face, cellIndex, isEdgeCell, ownLevel);
    const mergeDirections = sampleFaceSurface(
      face,
      cellIndex,
      faceLevel,
      receivesAmbientOcclusion,
      isEdgeCell,
      rowIndex,
      z
    );
    stats.cubeFacesEmitted++;
    if (isTranslucent) stats.translucentFaces++;
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
      packPositionWord(
        x * POSITION_UNITS_PER_BLOCK,
        y * POSITION_UNITS_PER_BLOCK + bottomOffset16,
        z * POSITION_UNITS_PER_BLOCK
      ),
      packPositionWord(POSITION_UNITS_PER_BLOCK, blockHeight16, POSITION_UNITS_PER_BLOCK),
      CHUNK_UV_UNITS_PER_BLOCK,
      isHorizontalFace ? (isVForward ? 0 : fullTextureV) : rowBottomV,
      isHorizontalFace ? (isVForward ? fullTextureV : 0) : rowTopV,
      textureIndex
    );
  }
}

// An opaque cube takes full ambient occlusion, is never translucent, and its face is
// known to be exposed, so nothing but shading is left to decide.
function emitOpaqueCubeFace(
  face: number,
  x: number,
  y: number,
  z: number,
  cellIndex: number,
  isEdgeCell: boolean,
  rowIndex: number
) {
  const light = paddedLightGrid.cells;
  const neighborIndex = cellIndex + FACE_NEIGHBOR_DELTAS[face];
  const faceLevel =
    isEdgeCell && lightKnownByOutsideFlags[OUTSIDE_FACE_FLAGS[neighborIndex]] === 0
      ? LIGHT_LEVEL_OF_PACKED_LIGHT[light[cellIndex]]
      : LIGHT_LEVEL_OF_PACKED_LIGHT[light[neighborIndex]];
  const mergeDirections = sampleFaceSurface(face, cellIndex, faceLevel, true, isEdgeCell, rowIndex, z);
  const block = paddedBlockGrid.cells[cellIndex];
  const textureIndex = FACE_TEXTURES[face][block];
  stats.cubeFacesEmitted++;
  stats.opaqueBulkFaces++;
  facesByBlockId[block]++;
  if (mergeDirections !== 0) {
    stats.mergeableFaces++;
    recordMergeableFace(face, x, y, z, textureIndex, false, face === FACE_UP ? FULL_BLOCK_HEIGHT : 0, mergeDirections);
    return;
  }
  const isHorizontalFace = face <= FACE_DOWN;
  const isVForward = FACE_V_FORWARD[face] === 1;
  emitFaceQuad(
    opaqueStream,
    face,
    packPositionWord(x * POSITION_UNITS_PER_BLOCK, y * POSITION_UNITS_PER_BLOCK, z * POSITION_UNITS_PER_BLOCK),
    packPositionWord(POSITION_UNITS_PER_BLOCK, FULL_BLOCK_HEIGHT, POSITION_UNITS_PER_BLOCK),
    CHUNK_UV_UNITS_PER_BLOCK,
    isHorizontalFace ? (isVForward ? 0 : CHUNK_UV_UNITS_PER_BLOCK) : CHUNK_UV_UNITS_PER_BLOCK,
    isHorizontalFace ? (isVForward ? CHUNK_UV_UNITS_PER_BLOCK : 0) : 0,
    textureIndex
  );
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
    if (uniformBlock >= 0) addWorkerCounter("uniformChunksSeen", 1);
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
  if (uniformBlock >= 0) addWorkerCounter("uniformChunksSeen", 1);
  if (isWorkerProfiling()) {
    addWorkerCounter("paddedGridBytes", PADDED_VOLUME * 2);
    addWorkerCounter("chunkCellsCopied", CELLS_PER_CHUNK * 2);
    addWorkerCounter("borderCellsCopied", countSlabCells(borders) + countSlabCells(borderLights));
  }

  resetStats();
  opaqueStream.reset();
  transparentStream.reset();
  const blocks = paddedBlockGrid.cells;
  const light = paddedLightGrid.cells;

  startWorkerSection("faceGeneration");
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      startWorkerSampledSection("scanRow", ROW_SAMPLE_INTERVAL);
      let visibleCells = prepareRow(x, y);
      const rowCellsVisited = countSetBits(
        visibleCells |
          exposedCubeFaceCells[0] |
          exposedCubeFaceCells[1] |
          exposedCubeFaceCells[2] |
          exposedCubeFaceCells[3] |
          exposedCubeFaceCells[4] |
          exposedCubeFaceCells[5]
      );
      endWorkerSection();
      stats.cellsVisited += rowCellsVisited;
      stats.rowsScanned++;
      if (rowCellsVisited === 0) {
        stats.emptyRows++;
        continue;
      }
      const firstCell = paddedIndex(x, y, 0);
      const isEdgeRow = x === 0 || x === CHUNK_WIDTH - 1 || y === 0 || y === CHUNK_HEIGHT - 1;
      startWorkerSampledSection("opaqueCubeFaces", ROW_SAMPLE_INTERVAL);
      for (let face = 0; face < FACE_COUNT; face++) {
        let faceCells = exposedCubeFaceCells[face];
        while (faceCells !== 0) {
          const z = 31 - Math.clz32(faceCells & -faceCells);
          faceCells &= faceCells - 1;
          emitOpaqueCubeFace(
            face,
            x,
            y,
            z,
            firstCell + z,
            isEdgeRow || z === 0 || z === CHUNK_LENGTH - 1,
            rowIndexOf(x, y)
          );
        }
      }
      endWorkerSection();
      startWorkerSampledSection("generalCells", ROW_SAMPLE_INTERVAL);
      while (visibleCells !== 0) {
        const z = 31 - Math.clz32(visibleCells & -visibleCells);
        visibleCells &= visibleCells - 1;
        const cellIndex = firstCell + z;
        const block = blocks[cellIndex];
        const kind = BLOCK_KIND[block];

        if (kind === BLOCK_KIND_PLANT) {
          recordPlant(block, x, y, z, cellIndex);
        } else if (kind === BLOCK_KIND_STAIRS) {
          const verticesBefore = opaqueStream.vertexCount;
          startWorkerSampledSection("stairs", STAIR_SAMPLE_INTERVAL);
          emitStairs(
            opaqueStream,
            block,
            x,
            y,
            z,
            cellIndex,
            isEdgeRow || z === 0 || z === CHUNK_LENGTH - 1,
            rowIndexOf(x, y)
          );
          endWorkerSection();
          const quads = (opaqueStream.vertexCount - verticesBefore) / VERTICES_PER_QUAD;
          stats.stairCells++;
          stats.stairQuads += quads;
          facesByBlockId[block] += quads;
        } else {
          emitCubeFaces(
            block,
            kind,
            x,
            y,
            z,
            cellIndex,
            isEdgeRow || z === 0 || z === CHUNK_LENGTH - 1,
            rowIndexOf(x, y)
          );
        }
      }
      endWorkerSection();
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
  addWorkerCounter(
    "facesCulled",
    (stats.cellsVisited - stats.plantCells - stats.stairCells) * FACE_COUNT - stats.cubeFacesEmitted
  );
  addWorkerCounter("opaqueVertices", opaqueStream.vertexCount);
  addWorkerCounter("transparentVertices", transparentStream.vertexCount);
  addWorkerCounter("plantInstancesEmitted", stats.plantCells);
  addWorkerCounter("rowsScanned", stats.rowsScanned);
  addWorkerCounter("emptyRowsSkipped", stats.emptyRows);
  addWorkerCounter("opaqueBulkFaces", stats.opaqueBulkFaces);
  addWorkerCounter("generalPathFaces", stats.cubeFacesEmitted - stats.opaqueBulkFaces);
  addWorkerCounter("facesCulledByNeighbor", stats.facesCulledByNeighbor);
  addWorkerCounter("directFacesEmitted", stats.cubeFacesEmitted - stats.mergeableFaces);
  addWorkerCounter("translucentFacesEmitted", stats.translucentFaces);
  addWorkerCounter("slabBlocksVisited", stats.slabCells);
  addWorkerCounter("waterBlocksVisited", stats.waterCells);
  addWorkerCounter("stairSurfaceSamples", stairStats.surfaceSamples);
  addWorkerCounter("stairFacesCulled", stairStats.facesCulled);
  addWorkerCounter("aoEdgeCellSamples", faceSurfaceStats.edgeCellSamples);
  addWorkerCounter("aoInteriorSamples", faceSurfaceStats.interiorSamples);
  addWorkerCounter("aoUniformFastPathSamples", faceSurfaceStats.uniformFastPathSamples);
  addWorkerCounter("aoOccludedFaceSamples", faceSurfaceStats.occludedFaceSamples);
  addWorkerCounter("aoDarkenedCorners", faceSurfaceStats.darkenedCorners);
  addWorkerCounter("mergeableSurfaces", faceSurfaceStats.mergeableSurfaces);
  addWorkerCounter("quadsPacked", faceSurfaceStats.quadsPacked);
  addWorkerCounter("flippedDiagonals", faceSurfaceStats.flippedDiagonals);
  addWorkerCounter("mergeSlicesVisited", greedyMergeStats.slicesVisited);
  addWorkerCounter("mergeRowsVisited", greedyMergeStats.rowsVisited);
  addWorkerCounter("mergeCellsAbsorbed", greedyMergeStats.cellsAbsorbedAlongCells);
  addWorkerCounter("mergeRowsAbsorbed", greedyMergeStats.rowsAbsorbedAlongRows);
  addWorkerCounter("mergeFacesConsumed", greedyMergeStats.facesConsumed);
  addWorkerCounter("mergedTranslucentQuads", greedyMergeStats.translucentQuads);
  if (isWorkerProfiling()) {
    for (let face = 0; face < FACE_COUNT; face++) {
      addWorkerCounter(MERGEABLE_FACE_COUNTER_NAMES[face], greedyMergeStats.recordedFacesByDirection[face]);
    }
    const totalVertices = opaqueStream.vertexCount + transparentStream.vertexCount;
    addWorkerKeyedUnits(DIMENSIONS.meshVertexAttribute, VERTEX_ATTRIBUTE_POSITION, totalVertices * BYTES_PER_WORD);
    addWorkerKeyedUnits(DIMENSIONS.meshVertexAttribute, VERTEX_ATTRIBUTE_SURFACE, totalVertices * BYTES_PER_WORD);
    addWorkerCounter("positionWordBytes", totalVertices * BYTES_PER_WORD);
    addWorkerCounter("surfaceWordBytes", totalVertices * BYTES_PER_WORD);
    addWorkerCounter("opaqueStreamCapacityBytes", opaqueStream.capacityBytes);
    addWorkerCounter("transparentStreamCapacityBytes", transparentStream.capacityBytes);
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
