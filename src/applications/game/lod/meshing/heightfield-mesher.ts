// Turns a TileSurface into blocky heightfield geometry: greedy-merged top quads (same height, colour and light),
// walls between neighbouring cells of different height (merged along the edge), skirts on all four tile borders that
// reach down to the world floor, and greedy-merged water quads in a second index range. Because every border cell
// hangs a skirt to the floor, two neighbouring tiles never leave a crack whatever their levels: the higher side's
// skirt always spans the step, and the rest of it is hidden inside the lower tile's terrain.

import { addWorkerCounter, workerSection } from "../../profiler/worker-recorder";
import { sideColorOfBlock, topColorOfBlock, WATER_SURFACE_COLOR } from "../colors/block-color-table";
import { NO_WATER, TILE_CELLS, WORLD_MIN_Y } from "../core/lod-constants";
import { cellIndexOf, type TileSurface } from "../data/tile-surface";
import {
  encodeVertexWord0,
  encodeVertexWord1,
  LOD_VERTEX_WORDS,
  LodFace,
  LodMaterial,
  MAXIMUM_OCCLUSION,
  MAXIMUM_SKY_LIGHT,
} from "./lod-vertex-format";

/** Skirts end one block below the lowest block of the world. */
export const SKIRT_BOTTOM_Y = WORLD_MIN_Y - 1;
const WALL_FOOT_OCCLUSION = 1;
const EMPTY_CELL_KEY = -1e12;
export const VERTICES_PER_QUAD = 4;
/** Upper bound of quads in one tile: tops and water per cell, one wall per inner edge, one skirt per border cell. */
export const MAXIMUM_TILE_QUADS = TILE_CELLS * TILE_CELLS * 2 + 2 * TILE_CELLS * (TILE_CELLS + 1) + 4 * TILE_CELLS;

export interface TileMesh {
  /**
   * LOD_VERTEX_WORDS uint32 words per vertex, four vertices per quad in counter-clockwise order, so every tile shares
   * one quad index buffer. Terrain quads come first, water quads after them.
   */
  vertices: Uint32Array;
  terrainQuadCount: number;
  waterQuadCount: number;
  minY: number;
  maxY: number;
}

function underwaterLight(waterDepth: number): number {
  if (waterDepth <= 2) return MAXIMUM_SKY_LIGHT - 1;
  if (waterDepth <= 6) return MAXIMUM_SKY_LIGHT - 3;
  if (waterDepth <= 12) return MAXIMUM_SKY_LIGHT - 5;
  return MAXIMUM_SKY_LIGHT - 7;
}

class QuadWriter {
  private readonly vertexWords = new Uint32Array(MAXIMUM_TILE_QUADS * VERTICES_PER_QUAD * LOD_VERTEX_WORDS);
  vertexCount = 0;
  minY = Infinity;
  maxY = -Infinity;

  /** Four corners in counter-clockwise order seen from the front; each corner is [cellX, blockY, cellZ, occlusion]. */
  get quadCount(): number {
    return this.vertexCount / VERTICES_PER_QUAD;
  }

  emit(corners: readonly (readonly [number, number, number, number])[], face: LodFace, light: number, color: number, material: LodMaterial): void {
    const colorWord = encodeVertexWord1(color, material);
    for (const [cellX, blockY, cellZ, occlusion] of corners) {
      const offset = this.vertexCount * LOD_VERTEX_WORDS;
      this.vertexWords[offset] = encodeVertexWord0(cellX, blockY, cellZ, face, occlusion, light);
      this.vertexWords[offset + 1] = colorWord;
      this.vertexCount++;
      if (blockY < this.minY) this.minY = blockY;
      if (blockY > this.maxY) this.maxY = blockY;
    }
  }

  topQuad(minCellX: number, minCellZ: number, maxCellX: number, maxCellZ: number, blockY: number, light: number, color: number, material: LodMaterial) {
    this.emit(
      [
        [minCellX, blockY, minCellZ, MAXIMUM_OCCLUSION],
        [minCellX, blockY, maxCellZ, MAXIMUM_OCCLUSION],
        [maxCellX, blockY, maxCellZ, MAXIMUM_OCCLUSION],
        [maxCellX, blockY, minCellZ, MAXIMUM_OCCLUSION],
      ],
      LodFace.Up,
      light,
      color,
      material,
    );
  }

  /** Wall in the plane x = planeX spanning cells [startCellZ, endCellZ), facing +x or -x. */
  wallAlongZ(planeX: number, startCellZ: number, endCellZ: number, bottomY: number, topY: number, facesPositiveX: boolean, light: number, color: number) {
    const foot = WALL_FOOT_OCCLUSION;
    const corners: [number, number, number, number][] = facesPositiveX
      ? [[planeX, bottomY, startCellZ, foot], [planeX, topY, startCellZ, MAXIMUM_OCCLUSION], [planeX, topY, endCellZ, MAXIMUM_OCCLUSION], [planeX, bottomY, endCellZ, foot]]
      : [[planeX, bottomY, endCellZ, foot], [planeX, topY, endCellZ, MAXIMUM_OCCLUSION], [planeX, topY, startCellZ, MAXIMUM_OCCLUSION], [planeX, bottomY, startCellZ, foot]];
    this.emit(corners, facesPositiveX ? LodFace.PositiveX : LodFace.NegativeX, light, color, LodMaterial.Terrain);
  }

  /** Wall in the plane z = planeZ spanning cells [startCellX, endCellX), facing +z or -z. */
  wallAlongX(planeZ: number, startCellX: number, endCellX: number, bottomY: number, topY: number, facesPositiveZ: boolean, light: number, color: number) {
    const foot = WALL_FOOT_OCCLUSION;
    const corners: [number, number, number, number][] = facesPositiveZ
      ? [[endCellX, bottomY, planeZ, foot], [endCellX, topY, planeZ, MAXIMUM_OCCLUSION], [startCellX, topY, planeZ, MAXIMUM_OCCLUSION], [startCellX, bottomY, planeZ, foot]]
      : [[startCellX, bottomY, planeZ, foot], [startCellX, topY, planeZ, MAXIMUM_OCCLUSION], [endCellX, topY, planeZ, MAXIMUM_OCCLUSION], [endCellX, bottomY, planeZ, foot]];
    this.emit(corners, facesPositiveZ ? LodFace.PositiveZ : LodFace.NegativeZ, light, color, LodMaterial.Terrain);
  }

  finish(terrainQuadCount: number): TileMesh {
    return {
      vertices: this.vertexWords.slice(0, this.vertexCount * LOD_VERTEX_WORDS),
      terrainQuadCount,
      waterQuadCount: this.quadCount - terrainQuadCount,
      minY: this.vertexCount === 0 ? 0 : this.minY,
      maxY: this.vertexCount === 0 ? 0 : this.maxY,
    };
  }
}

/** Greedy rectangle cover of the cells whose key is not EMPTY_CELL_KEY; equal keys merge. Returns the rectangle count. */
function greedyRectangles(keys: Float64Array, onRectangle: (minX: number, minZ: number, maxX: number, maxZ: number, firstIndex: number) => void): number {
  const consumed = new Uint8Array(TILE_CELLS * TILE_CELLS);
  let rectangleCount = 0;
  for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
    for (let cellX = 0; cellX < TILE_CELLS; cellX++) {
      const index = cellIndexOf(cellX, cellZ);
      if (consumed[index] || keys[index] === EMPTY_CELL_KEY) continue;
      const key = keys[index]!;
      let endX = cellX + 1;
      while (endX < TILE_CELLS && !consumed[cellIndexOf(endX, cellZ)] && keys[cellIndexOf(endX, cellZ)] === key) endX++;
      let endZ = cellZ + 1;
      rows: while (endZ < TILE_CELLS) {
        for (let scanX = cellX; scanX < endX; scanX++) {
          const scanIndex = cellIndexOf(scanX, endZ);
          if (consumed[scanIndex] || keys[scanIndex] !== key) break rows;
        }
        endZ++;
      }
      for (let fillZ = cellZ; fillZ < endZ; fillZ++) for (let fillX = cellX; fillX < endX; fillX++) consumed[cellIndexOf(fillX, fillZ)] = 1;
      onRectangle(cellX, cellZ, endX, endZ, index);
      rectangleCount++;
    }
  }
  return rectangleCount;
}

function topLightOf(surface: TileSurface, index: number): number {
  const water = surface.waterLevels[index]!;
  const height = surface.heights[index]!;
  return water !== NO_WATER && water > height ? underwaterLight(water - height) : MAXIMUM_SKY_LIGHT;
}

function wallLightOf(surface: TileSurface, higherIndex: number, wallTopY: number): number {
  const water = surface.waterLevels[higherIndex]!;
  return water !== NO_WATER && water >= wallTopY ? underwaterLight(water - wallTopY) : MAXIMUM_SKY_LIGHT;
}

interface PendingWall {
  bottomY: number;
  topY: number;
  color: number;
  light: number;
  start: number;
  end: number;
}

/**
 * Emits merged walls along one line of edges. `edgeAt(position)` describes the wall at each cell position along the
 * line (or null); consecutive identical walls merge into one quad. Returns how many cell edges had a wall.
 */
function mergeWallsAlongLine(edgeAt: (position: number) => Omit<PendingWall, "start" | "end"> | null, emit: (wall: PendingWall) => void): number {
  let pending: PendingWall | null = null;
  let wallEdges = 0;
  for (let position = 0; position <= TILE_CELLS; position++) {
    const edge = position < TILE_CELLS ? edgeAt(position) : null;
    if (edge !== null) wallEdges++;
    if (
      pending !== null &&
      edge !== null &&
      edge.bottomY === pending.bottomY &&
      edge.topY === pending.topY &&
      edge.color === pending.color &&
      edge.light === pending.light
    ) {
      pending.end = position + 1;
      continue;
    }
    if (pending !== null) emit(pending);
    pending = edge === null ? null : { ...edge, start: position, end: position + 1 };
  }
  return wallEdges;
}

export function meshTileSurface(surface: TileSurface): TileMesh {
  const topColors = new Uint32Array(TILE_CELLS * TILE_CELLS);
  const sideColors = new Uint32Array(TILE_CELLS * TILE_CELLS);
  const topKeys = new Float64Array(TILE_CELLS * TILE_CELLS);
  const writer = workerSection("lod.mesh.prepare", () => {
    const quadWriter = new QuadWriter();
    for (let index = 0; index < TILE_CELLS * TILE_CELLS; index++) {
      topColors[index] = topColorOfBlock(surface.topBlocks[index]!);
      sideColors[index] = sideColorOfBlock(surface.sideBlocks[index]!);
    }
    for (let index = 0; index < topKeys.length; index++) {
      topKeys[index] = (surface.heights[index]! + 1024) * 2 ** 32 + topColors[index]! * 16 + topLightOf(surface, index);
    }
    return quadWriter;
  });

  const topRectangles = workerSection("lod.mesh.tops", () =>
    greedyRectangles(topKeys, (minX, minZ, maxX, maxZ, firstIndex) => {
      writer.topQuad(minX, minZ, maxX, maxZ, surface.heights[firstIndex]!, topLightOf(surface, firstIndex), topColors[firstIndex]!, LodMaterial.Terrain);
    }),
  );

  const wallBetween = (higherIndex: number, lowerHeight: number) => {
    const topY = surface.heights[higherIndex]!;
    return { bottomY: lowerHeight, topY, color: sideColors[higherIndex]!, light: wallLightOf(surface, higherIndex, topY) };
  };

  const quadsBeforeWalls = writer.quadCount;
  const innerWallEdges = workerSection("lod.mesh.walls", () => {
    let wallEdges = 0;
    for (let planeX = 1; planeX < TILE_CELLS; planeX++) {
      for (const facesPositiveX of [true, false]) {
        wallEdges += mergeWallsAlongLine(
          (cellZ) => {
            const westIndex = cellIndexOf(planeX - 1, cellZ);
            const eastIndex = cellIndexOf(planeX, cellZ);
            const higherIndex = facesPositiveX ? westIndex : eastIndex;
            const lowerIndex = facesPositiveX ? eastIndex : westIndex;
            if (surface.heights[higherIndex]! <= surface.heights[lowerIndex]!) return null;
            return wallBetween(higherIndex, surface.heights[lowerIndex]!);
          },
          (wall) => writer.wallAlongZ(planeX, wall.start, wall.end, wall.bottomY, wall.topY, facesPositiveX, wall.light, wall.color),
        );
      }
    }
    for (let planeZ = 1; planeZ < TILE_CELLS; planeZ++) {
      for (const facesPositiveZ of [true, false]) {
        wallEdges += mergeWallsAlongLine(
          (cellX) => {
            const northIndex = cellIndexOf(cellX, planeZ - 1);
            const southIndex = cellIndexOf(cellX, planeZ);
            const higherIndex = facesPositiveZ ? northIndex : southIndex;
            const lowerIndex = facesPositiveZ ? southIndex : northIndex;
            if (surface.heights[higherIndex]! <= surface.heights[lowerIndex]!) return null;
            return wallBetween(higherIndex, surface.heights[lowerIndex]!);
          },
          (wall) => writer.wallAlongX(planeZ, wall.start, wall.end, wall.bottomY, wall.topY, facesPositiveZ, wall.light, wall.color),
        );
      }
    }
    return wallEdges;
  });
  const quadsBeforeSkirts = writer.quadCount;

  workerSection("lod.mesh.skirts", () => {
    const skirtOf = (index: number) => wallBetween(index, SKIRT_BOTTOM_Y);
    mergeWallsAlongLine(
      (cellZ) => skirtOf(cellIndexOf(0, cellZ)),
      (wall) => writer.wallAlongZ(0, wall.start, wall.end, wall.bottomY, wall.topY, false, wall.light, wall.color),
    );
    mergeWallsAlongLine(
      (cellZ) => skirtOf(cellIndexOf(TILE_CELLS - 1, cellZ)),
      (wall) => writer.wallAlongZ(TILE_CELLS, wall.start, wall.end, wall.bottomY, wall.topY, true, wall.light, wall.color),
    );
    mergeWallsAlongLine(
      (cellX) => skirtOf(cellIndexOf(cellX, 0)),
      (wall) => writer.wallAlongX(0, wall.start, wall.end, wall.bottomY, wall.topY, false, wall.light, wall.color),
    );
    mergeWallsAlongLine(
      (cellX) => skirtOf(cellIndexOf(cellX, TILE_CELLS - 1)),
      (wall) => writer.wallAlongX(TILE_CELLS, wall.start, wall.end, wall.bottomY, wall.topY, true, wall.light, wall.color),
    );
  });

  const terrainQuadCount = writer.quadCount;
  let waterCells = 0;
  const waterRectangles = workerSection("lod.mesh.water", () => {
    const waterKeys = new Float64Array(TILE_CELLS * TILE_CELLS);
    for (let index = 0; index < waterKeys.length; index++) {
      const water = surface.waterLevels[index]!;
      const isWet = water !== NO_WATER && water > surface.heights[index]!;
      waterKeys[index] = isWet ? water : EMPTY_CELL_KEY;
      if (isWet) waterCells++;
    }
    return greedyRectangles(waterKeys, (minX, minZ, maxX, maxZ, firstIndex) => {
      writer.topQuad(minX, minZ, maxX, maxZ, surface.waterLevels[firstIndex]!, MAXIMUM_SKY_LIGHT, WATER_SURFACE_COLOR, LodMaterial.Water);
    });
  });
  const mesh = workerSection("lod.mesh.finish", () => writer.finish(terrainQuadCount));
  addWorkerCounter("lodMeshTopCells", TILE_CELLS * TILE_CELLS);
  addWorkerCounter("lodMeshTopRectangles", topRectangles);
  addWorkerCounter("lodMeshWallEdges", innerWallEdges);
  addWorkerCounter("lodMeshWallQuads", quadsBeforeSkirts - quadsBeforeWalls);
  addWorkerCounter("lodMeshSkirtQuads", terrainQuadCount - quadsBeforeSkirts);
  addWorkerCounter("lodMeshWaterCells", waterCells);
  addWorkerCounter("lodMeshWaterRectangles", waterRectangles);
  addWorkerCounter("lodMeshColorLookups", 2 * TILE_CELLS * TILE_CELLS);
  return mesh;
}
