import {
  BLOCK_TEXTURES,
  BlockType,
  Texture,
  isCrop,
  isCrossBlock,
  isFlatQuad,
} from "../blocks";
import { TEXTURE_SIZE } from "../config";
import { PLANT_PIXEL_MASKS } from "../data/plant-pixel-masks";
import { DIMENSIONS } from "../profiler/dimensions";
import {
  addWorkerCounter,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "../profiler/worker-recorder";
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

function buildVoxelCells(
  block: BlockType,
  pixelRows: string[],
): Map<number, VoxelCell> {
  const cells = new Map<number, VoxelCell>();
  let opaquePixelsSampled = 0;

  const claimCell = (
    cellX: number,
    cellY: number,
    cellZ: number,
    pixelColumn: number,
    pixelRow: number,
  ) => {
    const key = cellKey(cellX, cellY, cellZ);
    if (!cells.has(key))
      cells.set(key, { cellX, cellY, cellZ, pixelColumn, pixelRow });
  };

  for (let pixelRow = 0; pixelRow < TEXTURE_SIZE; pixelRow++) {
    for (let pixelColumn = 0; pixelColumn < TEXTURE_SIZE; pixelColumn++) {
      if (pixelRows[pixelRow]?.[pixelColumn] !== OPAQUE_PIXEL) continue;
      opaquePixelsSampled++;

      const cellY = TEXTURE_SIZE - 1 - pixelRow;

      if (isCrossBlock(block)) {
        claimCell(pixelColumn, cellY, CROSS_SHEET_Z, pixelColumn, pixelRow);
        claimCell(CROSS_SHEET_X, cellY, pixelColumn, pixelColumn, pixelRow);
      } else if (isFlatQuad(block)) {
        claimCell(
          pixelColumn,
          FLAT_QUAD_LAYER,
          pixelRow,
          pixelColumn,
          pixelRow,
        );
      } else if (isCrop(block)) {
        for (const sheet of [CROP_NEAR_SHEET, CROP_FAR_SHEET]) {
          claimCell(pixelColumn, cellY, sheet, pixelColumn, pixelRow);
          claimCell(sheet, cellY, pixelColumn, pixelColumn, pixelRow);
        }
      }
    }
  }
  addWorkerCounter("plantPixelsSampled", TEXTURE_SIZE * TEXTURE_SIZE);
  addWorkerCounter("plantOpaquePixels", opaquePixelsSampled);
  addWorkerCounter("plantVoxelCells", cells.size);
  return cells;
}

// 3 = open, 0 = boxed in, from the plant's own voxels only. Shade cast by solid
// blocks around the plant is added per instance in the vertex shader.
function cornerAmbientOcclusion(
  cells: Map<number, VoxelCell>,
  cell: VoxelCell,
  face: VoxelFace,
  corner: Vector,
): number {
  const [firstTangent, secondTangent] = [0, 1, 2].filter(
    (axis) => face.normal[axis] === 0,
  );
  const firstStep: Vector = [0, 0, 0];
  firstStep[firstTangent] = corner[firstTangent] === 1 ? 1 : -1;
  const secondStep: Vector = [0, 0, 0];
  secondStep[secondTangent] = corner[secondTangent] === 1 ? 1 : -1;

  const originX = cell.cellX + face.normal[0];
  const originY = cell.cellY + face.normal[1];
  const originZ = cell.cellZ + face.normal[2];

  const isFirstSideBlocked = cells.has(
    cellKey(
      originX + firstStep[0],
      originY + firstStep[1],
      originZ + firstStep[2],
    ),
  );
  const isSecondSideBlocked = cells.has(
    cellKey(
      originX + secondStep[0],
      originY + secondStep[1],
      originZ + secondStep[2],
    ),
  );
  const isCornerBlocked = cells.has(
    cellKey(
      originX + firstStep[0] + secondStep[0],
      originY + firstStep[1] + secondStep[1],
      originZ + firstStep[2] + secondStep[2],
    ),
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

function plantTemplateKey(prefix: string, block: BlockType): string | undefined {
  return isWorkerProfiling() ? `${prefix}.${BlockType[block]}` : undefined;
}

export function buildPlantTemplate(block: BlockType): PlantTemplate {
  startWorkerSection(
    "buildPlantTemplate",
    DIMENSIONS.meshPart,
    plantTemplateKey("plantTemplate", block),
  );
  const textureIndex = BLOCK_TEXTURES[block].DEFAULT;
  const pixelRows = PLANT_PIXEL_MASKS[TEXTURE_FILE_NAMES[textureIndex]];
  const stream = new VertexStream();
  if (!pixelRows) {
    const emptyTemplate = { blockType: block, vertexBuffer: stream.toBuffer(), quadCount: 0 };
    endWorkerSection();
    return emptyTemplate;
  }

  startWorkerSection("buildVoxelCells");
  const cells = buildVoxelCells(block, pixelRows);
  endWorkerSection();

  startWorkerSection("emitVoxelFaces");
  let hiddenFaces = 0;
  for (const cell of cells.values()) {
    const u32 = cell.pixelColumn * 2 + 1;
    const v32 = cell.pixelRow * 2 + 1;

    for (const face of VOXEL_FACES) {
      const [normalX, normalY, normalZ] = face.normal;
      const isHidden = cells.has(
        cellKey(
          cell.cellX + normalX,
          cell.cellY + normalY,
          cell.cellZ + normalZ,
        ),
      );
      if (isHidden) {
        hiddenFaces++;
        continue;
      }

      const corners: Vector[] = [
        face.base,
        face.base.map((value, axis) => value + face.alongU[axis]) as Vector,
        face.base.map(
          (value, axis) => value + face.alongU[axis] + face.alongV[axis],
        ) as Vector,
        face.base.map((value, axis) => value + face.alongV[axis]) as Vector,
      ];
      const cornerOcclusion = corners.map((corner) =>
        cornerAmbientOcclusion(cells, cell, face, corner),
      );
      const positionWords = corners.map((corner) =>
        packPositionWord(
          cell.cellX + corner[0],
          cell.cellY + corner[1],
          cell.cellZ + corner[2],
        ),
      );
      const surfaceWords = cornerOcclusion.map((occlusion) =>
        packSurfaceWord(u32, v32, textureIndex, occlusion, 0),
      );

      // Split along the brighter diagonal so a dark corner does not streak across the quad.
      const shouldFlipDiagonal =
        cornerOcclusion[1] + cornerOcclusion[3] >
        cornerOcclusion[0] + cornerOcclusion[2];
      const [first, second, third, fourth] = shouldFlipDiagonal
        ? [2, 3, 1, 0]
        : [1, 2, 0, 3];
      stream.pushQuad(
        positionWords[first],
        surfaceWords[first],
        positionWords[second],
        surfaceWords[second],
        positionWords[third],
        surfaceWords[third],
        positionWords[fourth],
        surfaceWords[fourth],
        false,
      );
    }
  }

  endWorkerSection();

  startWorkerSection("packTemplateBuffer");
  const vertexBuffer = stream.toBuffer();
  endWorkerSection();
  const quadCount = stream.vertexCount / 4;
  addWorkerCounter("plantTemplateQuads", quadCount);
  addWorkerCounter("plantTemplateHiddenFaces", hiddenFaces);
  addWorkerCounter("plantTemplateBytes", vertexBuffer.byteLength);
  endWorkerSection();
  return { blockType: block, vertexBuffer, quadCount };
}

type Corner2 = [number, number];

/**
 * A distant stand-in for the voxel plant: the same sheets as flat textured quads,
 * each drawn from both sides. Positions are in 1/16 block units, and the sheets sit
 * on the whole-voxel line closest to where the voxels are, so they stay on the grid.
 */
export function buildPlantBillboardTemplate(block: BlockType): PlantTemplate {
  startWorkerSection(
    "buildPlantBillboardTemplate",
    DIMENSIONS.meshPart,
    plantTemplateKey("plantBillboard", block),
  );
  const textureIndex = BLOCK_TEXTURES[block].DEFAULT;
  const stream = new VertexStream();
  const unit = TEXTURE_SIZE;

  // A sheet is described by its four corners (x, y, z) with the texture corner each one samples.
  const pushSheet = (corners: Vector[], textureCorners: Corner2[]) => {
    const positionWords = corners.map((corner) =>
      packPositionWord(corner[0], corner[1], corner[2]),
    );
    const surfaceWords = textureCorners.map(([column, row]) =>
      packSurfaceWord(
        column * 2,
        row * 2,
        textureIndex,
        FULLY_LIT_AMBIENT_OCCLUSION,
        0,
      ),
    );
    stream.pushQuad(
      positionWords[0],
      surfaceWords[0],
      positionWords[1],
      surfaceWords[1],
      positionWords[2],
      surfaceWords[2],
      positionWords[3],
      surfaceWords[3],
      false,
    );
    stream.pushQuad(
      positionWords[1],
      surfaceWords[1],
      positionWords[0],
      surfaceWords[0],
      positionWords[3],
      surfaceWords[3],
      positionWords[2],
      surfaceWords[2],
      false,
    );
  };

  // Corner order for every sheet: bottom-left, bottom-right, top-left, top-right of the texture.
  const textureCorners: Corner2[] = [
    [0, unit],
    [unit, unit],
    [0, 0],
    [unit, 0],
  ];
  const upright = (fixedAxis: 0 | 2, fixedAt: number) =>
    [0, unit].flatMap((bottomOrTop) =>
      [0, unit].map((along) => {
        const corner: Vector = [0, 0, 0];
        corner[fixedAxis] = fixedAt;
        corner[fixedAxis === 0 ? 2 : 0] = along;
        corner[1] = bottomOrTop === 0 ? 0 : unit;
        return corner;
      }),
    );

  if (isCrossBlock(block)) {
    pushSheet(upright(2, CROSS_SHEET_Z), textureCorners);
    pushSheet(upright(0, CROSS_SHEET_X), textureCorners);
  } else if (isCrop(block)) {
    for (const sheet of [CROP_NEAR_SHEET, CROP_FAR_SHEET]) {
      pushSheet(upright(2, sheet), textureCorners);
      pushSheet(upright(0, sheet), textureCorners);
    }
  } else if (isFlatQuad(block)) {
    const layer = FLAT_QUAD_LAYER;
    pushSheet(
      [
        [0, layer, 0],
        [unit, layer, 0],
        [0, layer, unit],
        [unit, layer, unit],
      ],
      [
        [0, 0],
        [unit, 0],
        [0, unit],
        [unit, unit],
      ],
    );
  }

  const vertexBuffer = stream.toBuffer();
  const quadCount = stream.vertexCount / 4;
  addWorkerCounter("plantBillboardQuads", quadCount);
  addWorkerCounter("plantBillboardBytes", vertexBuffer.byteLength);
  endWorkerSection();
  return { blockType: block, vertexBuffer, quadCount };
}
