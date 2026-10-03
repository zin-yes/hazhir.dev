import { BLOCK_TEXTURES, BlockType, Texture, isCrop, isCrossBlock, isFlatQuad } from "../blocks";
import { TEXTURE_SIZE } from "../config";
import { PLANT_PIXEL_MASKS } from "../data/plant-pixel-masks";
import { packPositionWord, packSurfaceWord } from "../vertex-format";
import { VertexStream } from "./vertex-stream";

const OPAQUE_PIXEL = "#";
const CROSS_SHEET_Z = TEXTURE_SIZE / 2;
const CROSS_SHEET_X = TEXTURE_SIZE / 2 - 1;
const CROP_NEAR_SHEET = 5;
const CROP_FAR_SHEET = TEXTURE_SIZE - 1 - CROP_NEAR_SHEET;
const FLAT_QUAD_LAYER = 1;

const FULLY_LIT_AMBIENT_OCCLUSION = 3;
const TEXTURE_FILE_NAMES = Object.values(Texture);

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

// 3 = open, 0 = boxed in, from the plant's own voxels only. Shade cast by solid
// blocks around the plant is added per instance in the vertex shader.
function cornerAmbientOcclusion(
  cells: Map<number, VoxelCell>,
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

  const isFirstSideBlocked = cells.has(
    cellKey(originX + firstStep[0], originY + firstStep[1], originZ + firstStep[2])
  );
  const isSecondSideBlocked = cells.has(
    cellKey(originX + secondStep[0], originY + secondStep[1], originZ + secondStep[2])
  );
  const isCornerBlocked = cells.has(
    cellKey(
      originX + firstStep[0] + secondStep[0],
      originY + firstStep[1] + secondStep[1],
      originZ + firstStep[2] + secondStep[2]
    )
  );

  if (isFirstSideBlocked && isSecondSideBlocked) return 0;
  return (
    FULLY_LIT_AMBIENT_OCCLUSION -
    Number(isFirstSideBlocked) -
    Number(isSecondSideBlocked) -
    Number(isCornerBlocked)
  );
}

export interface PlantTemplate {
  blockType: BlockType;
  /** Packed vertices in the shared mesh format, positions in 1/16 block units from the block corner. */
  vertexBuffer: ArrayBuffer;
  quadCount: number;
}

export function buildPlantTemplate(block: BlockType): PlantTemplate {
  const textureIndex = BLOCK_TEXTURES[block].DEFAULT;
  const pixelRows = PLANT_PIXEL_MASKS[TEXTURE_FILE_NAMES[textureIndex]];
  const stream = new VertexStream();
  if (!pixelRows) return { blockType: block, vertexBuffer: stream.toBuffer(), quadCount: 0 };

  const cells = buildVoxelCells(block, pixelRows);

  for (const cell of cells.values()) {
    const u32 = cell.pixelColumn * 2 + 1;
    const v32 = cell.pixelRow * 2 + 1;

    for (const face of VOXEL_FACES) {
      const [normalX, normalY, normalZ] = face.normal;
      const isHidden = cells.has(
        cellKey(cell.cellX + normalX, cell.cellY + normalY, cell.cellZ + normalZ)
      );
      if (isHidden) continue;

      const corners: Vector[] = [
        face.base,
        face.base.map((value, axis) => value + face.alongU[axis]) as Vector,
        face.base.map((value, axis) => value + face.alongU[axis] + face.alongV[axis]) as Vector,
        face.base.map((value, axis) => value + face.alongV[axis]) as Vector,
      ];
      const cornerOcclusion = corners.map((corner) =>
        cornerAmbientOcclusion(cells, cell, face, corner)
      );
      const positionWords = corners.map((corner) =>
        packPositionWord(cell.cellX + corner[0], cell.cellY + corner[1], cell.cellZ + corner[2])
      );
      const surfaceWords = cornerOcclusion.map((occlusion) =>
        packSurfaceWord(u32, v32, textureIndex, occlusion, 0)
      );

      // Split along the brighter diagonal so a dark corner does not streak across the quad.
      const shouldFlipDiagonal =
        cornerOcclusion[1] + cornerOcclusion[3] > cornerOcclusion[0] + cornerOcclusion[2];
      const [first, second, third, fourth] = shouldFlipDiagonal ? [2, 3, 1, 0] : [1, 2, 0, 3];
      stream.pushQuad(
        positionWords[first],
        surfaceWords[first],
        positionWords[second],
        surfaceWords[second],
        positionWords[third],
        surfaceWords[third],
        positionWords[fourth],
        surfaceWords[fourth],
        false
      );
    }
  }

  const vertexBuffer = stream.toBuffer();
  return { blockType: block, vertexBuffer, quadCount: stream.vertexCount / 4 };
}
