import { BlockType, Texture, isCrop, isCrossBlock, isFlatQuad } from "../blocks";
import { TEXTURE_SIZE } from "../config";
import { PLANT_PIXEL_MASKS } from "../data/plant-pixel-masks";

const VOXEL_SIZE = 1 / TEXTURE_SIZE;
const OPAQUE_PIXEL = "#";
const CROSS_SHEET_Z = TEXTURE_SIZE / 2;
const CROSS_SHEET_X = TEXTURE_SIZE / 2 - 1;
const CROP_NEAR_SHEET = 5;
const CROP_FAR_SHEET = TEXTURE_SIZE - 1 - CROP_NEAR_SHEET;
const FLAT_QUAD_LAYER = 1;

const FULLY_LIT_AMBIENT_OCCLUSION = 3;
// How many voxels from a neighbouring solid block its shadow reaches onto the plant.
const NEIGHBOR_SHADOW_REACH = 6;

const NEIGHBOR_BLOCK_DIRECTIONS: Vector[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const TEXTURE_FILE_NAMES = Object.values(Texture);

export interface PlantMeshBuffers {
  positions: number[];
  normals: number[];
  indices: number[];
  uvs: number[];
  textureIndices: number[];
  lightLevels: number[];
  ambientOcclusion: number[];
}

export type IsWorldBlockOccluding = (blockX: number, blockY: number, blockZ: number) => boolean;

interface VoxelCell {
  cellX: number;
  cellY: number;
  cellZ: number;
  pixelColumn: number;
  pixelRow: number;
}

type Vector = [number, number, number];

interface VoxelFace {
  normal: Vector;
  base: Vector;
  alongU: Vector;
  alongV: Vector;
}

// Every face satisfies alongU x alongV = normal, so the triangles wind outward.
const VOXEL_FACES: VoxelFace[] = [
  { normal: [1, 0, 0], base: [1, 0, 0], alongU: [0, 1, 0], alongV: [0, 0, 1] },
  { normal: [-1, 0, 0], base: [0, 0, 0], alongU: [0, 0, 1], alongV: [0, 1, 0] },
  { normal: [0, 1, 0], base: [0, 1, 0], alongU: [0, 0, 1], alongV: [1, 0, 0] },
  { normal: [0, -1, 0], base: [0, 0, 0], alongU: [1, 0, 0], alongV: [0, 0, 1] },
  { normal: [0, 0, 1], base: [0, 0, 1], alongU: [1, 0, 0], alongV: [0, 1, 0] },
  { normal: [0, 0, -1], base: [0, 0, 0], alongU: [0, 1, 0], alongV: [1, 0, 0] },
];

export function isPlantVoxelBlock(block: BlockType): boolean {
  return isCrossBlock(block) || isFlatQuad(block) || isCrop(block);
}

function cellKey(cellX: number, cellY: number, cellZ: number): number {
  return (cellX * TEXTURE_SIZE + cellY) * TEXTURE_SIZE + cellZ;
}

function buildVoxelCells(block: BlockType, pixelRows: string[]): Map<number, VoxelCell> {
  const cells = new Map<number, VoxelCell>();

  const claimCell = (
    cellX: number,
    cellY: number,
    cellZ: number,
    pixelColumn: number,
    pixelRow: number
  ) => {
    const key = cellKey(cellX, cellY, cellZ);
    if (!cells.has(key)) cells.set(key, { cellX, cellY, cellZ, pixelColumn, pixelRow });
  };

  for (let pixelRow = 0; pixelRow < TEXTURE_SIZE; pixelRow++) {
    for (let pixelColumn = 0; pixelColumn < TEXTURE_SIZE; pixelColumn++) {
      if (pixelRows[pixelRow]?.[pixelColumn] !== OPAQUE_PIXEL) continue;

      const cellY = TEXTURE_SIZE - 1 - pixelRow;

      if (isCrossBlock(block)) {
        claimCell(pixelColumn, cellY, CROSS_SHEET_Z, pixelColumn, pixelRow);
        claimCell(CROSS_SHEET_X, cellY, pixelColumn, pixelColumn, pixelRow);
      } else if (isFlatQuad(block)) {
        claimCell(pixelColumn, FLAT_QUAD_LAYER, pixelRow, pixelColumn, pixelRow);
      } else if (isCrop(block)) {
        for (const sheet of [CROP_NEAR_SHEET, CROP_FAR_SHEET]) {
          claimCell(pixelColumn, cellY, sheet, pixelColumn, pixelRow);
          claimCell(sheet, cellY, pixelColumn, pixelColumn, pixelRow);
        }
      }
    }
  }
  return cells;
}

// 3 = open, 0 = boxed in. Cells outside the plant's own block defer to the world.
function cornerAmbientOcclusion(
  isCellOccluding: (cellX: number, cellY: number, cellZ: number) => boolean,
  cell: VoxelCell,
  face: VoxelFace,
  corner: Vector
): number {
  const [firstTangent, secondTangent] = [0, 1, 2].filter((axis) => face.normal[axis] === 0);
  const firstStep: Vector = [0, 0, 0];
  firstStep[firstTangent] = corner[firstTangent] === 1 ? 1 : -1;
  const secondStep: Vector = [0, 0, 0];
  secondStep[secondTangent] = corner[secondTangent] === 1 ? 1 : -1;

  const originX = cell.cellX + face.normal[0];
  const originY = cell.cellY + face.normal[1];
  const originZ = cell.cellZ + face.normal[2];

  const isFirstSideBlocked = isCellOccluding(
    originX + firstStep[0],
    originY + firstStep[1],
    originZ + firstStep[2]
  );
  const isSecondSideBlocked = isCellOccluding(
    originX + secondStep[0],
    originY + secondStep[1],
    originZ + secondStep[2]
  );
  const isCornerBlocked = isCellOccluding(
    originX + firstStep[0] + secondStep[0],
    originY + firstStep[1] + secondStep[1],
    originZ + firstStep[2] + secondStep[2]
  );

  if (isFirstSideBlocked && isSecondSideBlocked) return 0;
  return (
    FULLY_LIT_AMBIENT_OCCLUSION -
    Number(isFirstSideBlocked) -
    Number(isSecondSideBlocked) -
    Number(isCornerBlocked)
  );
}

// Darkens a vertex by how close it is to each solid block touching the plant's block.
function neighborShadowAmbientOcclusion(
  occludingNeighborDirections: Vector[],
  vertexInVoxels: Vector
): number {
  let shadowStrength = 0;
  for (const direction of occludingNeighborDirections) {
    const axis = direction.findIndex((component) => component !== 0);
    const distanceInVoxels =
      direction[axis] > 0 ? TEXTURE_SIZE - vertexInVoxels[axis] : vertexInVoxels[axis];
    const reach = Math.max(0, 1 - distanceInVoxels / NEIGHBOR_SHADOW_REACH);
    shadowStrength += reach * reach;
  }
  return FULLY_LIT_AMBIENT_OCCLUSION * (1 - Math.min(1, shadowStrength));
}

export function emitPlantVoxels(
  target: PlantMeshBuffers,
  block: BlockType,
  blockX: number,
  blockY: number,
  blockZ: number,
  textureIndex: number,
  lightLevel: number,
  isWorldBlockOccluding: IsWorldBlockOccluding = () => false
) {
  const pixelRows = PLANT_PIXEL_MASKS[TEXTURE_FILE_NAMES[textureIndex]];
  if (!pixelRows) return;

  const cells = buildVoxelCells(block, pixelRows);

  const occludingNeighborDirections = NEIGHBOR_BLOCK_DIRECTIONS.filter(
    ([directionX, directionY, directionZ]) =>
      isWorldBlockOccluding(blockX + directionX, blockY + directionY, blockZ + directionZ)
  );

  const isCellOccluding = (cellX: number, cellY: number, cellZ: number) => {
    const isInsideOwnBlock = [cellX, cellY, cellZ].every(
      (cellAxis) => cellAxis >= 0 && cellAxis < TEXTURE_SIZE
    );
    if (isInsideOwnBlock) return cells.has(cellKey(cellX, cellY, cellZ));
    return isWorldBlockOccluding(
      blockX + Math.floor(cellX / TEXTURE_SIZE),
      blockY + Math.floor(cellY / TEXTURE_SIZE),
      blockZ + Math.floor(cellZ / TEXTURE_SIZE)
    );
  };

  for (const cell of cells.values()) {
    const u = (cell.pixelColumn + 0.5) / TEXTURE_SIZE;
    const v = (cell.pixelRow + 0.5) / TEXTURE_SIZE;

    for (const face of VOXEL_FACES) {
      const [normalX, normalY, normalZ] = face.normal;
      const isHidden = cells.has(
        cellKey(cell.cellX + normalX, cell.cellY + normalY, cell.cellZ + normalZ)
      );
      if (isHidden) continue;

      const firstVertexIndex = target.positions.length / 3;
      const corners: Vector[] = [
        face.base,
        face.base.map((value, axis) => value + face.alongU[axis]) as Vector,
        face.base.map((value, axis) => value + face.alongU[axis] + face.alongV[axis]) as Vector,
        face.base.map((value, axis) => value + face.alongV[axis]) as Vector,
      ];

      const cornerOcclusion = corners.map((corner) =>
        Math.min(
          cornerAmbientOcclusion(isCellOccluding, cell, face, corner),
          neighborShadowAmbientOcclusion(occludingNeighborDirections, [
            cell.cellX + corner[0],
            cell.cellY + corner[1],
            cell.cellZ + corner[2],
          ])
        )
      );

      for (const corner of corners) {
        target.positions.push(
          blockX + (cell.cellX + corner[0]) * VOXEL_SIZE,
          blockY + (cell.cellY + corner[1]) * VOXEL_SIZE,
          blockZ + (cell.cellZ + corner[2]) * VOXEL_SIZE
        );
        target.normals.push(normalX, normalY, normalZ);
        target.uvs.push(u, v);
        target.textureIndices.push(textureIndex);
        target.lightLevels.push(lightLevel);
      }
      target.ambientOcclusion.push(...cornerOcclusion);

      // Split along the brighter diagonal so a dark corner does not streak across the quad.
      const shouldFlipDiagonal =
        cornerOcclusion[1] + cornerOcclusion[3] > cornerOcclusion[0] + cornerOcclusion[2];
      if (shouldFlipDiagonal) {
        target.indices.push(
          firstVertexIndex + 1,
          firstVertexIndex + 2,
          firstVertexIndex + 3,
          firstVertexIndex + 1,
          firstVertexIndex + 3,
          firstVertexIndex
        );
      } else {
        target.indices.push(
          firstVertexIndex,
          firstVertexIndex + 1,
          firstVertexIndex + 2,
          firstVertexIndex,
          firstVertexIndex + 2,
          firstVertexIndex + 3
        );
      }
    }
  }
}
