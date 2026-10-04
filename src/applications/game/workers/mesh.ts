import {
  BLOCK_TEXTURES,
  BlockType,
  TRANSLUCENT_BLOCKS,
  TRANSPARENT_BLOCKS,
  getDirection,
  getWaterLevel,
  isSlab,
  isStairs,
  isTopSlab,
  isWater,
} from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";

import { createSurfaceHeightSampler } from "./generation";

import { calculateOffset } from "../utils";
import { isPlantVoxelBlock } from "./plant-voxels";
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
  PLANT_NEIGHBOR_DIRECTIONS,
  LIGHT_STEPS_PER_LEVEL,
  POSITION_UNITS_PER_BLOCK,
  UV_UNITS_PER_TEXTURE,
  VERTICES_PER_QUAD,
  packPlantInstance,
  packPositionWord,
  packSurfaceWord,
} from "../vertex-format";
import type { ChunkFaceBuffers, ChunkMeshResult, PlantInstanceBatch } from "./mesh-types";
import { VertexStream } from "./vertex-stream";

const FULLY_LIT_AMBIENT_OCCLUSION = 3;
const BLOCK_ID_COUNT = 256;

const BLOCK_SECTION_SAMPLE_INTERVAL = 32;
const FACE_SECTION_SAMPLE_INTERVAL = 32;
const MESH_PART_OPAQUE = "opaque";
const MESH_PART_TRANSPARENT = "transparent";
const MESH_PART_PLANTS = "plants";
const MESH_PART_STAIRS = "stairs";
const INDICES_PER_QUAD = 6;

function buildBlockLookup(isMember: (block: BlockType) => boolean): Uint8Array {
  const lookup = new Uint8Array(BLOCK_ID_COUNT);
  for (let block = 0; block < BLOCK_ID_COUNT; block++) lookup[block] = isMember(block) ? 1 : 0;
  return lookup;
}

const IS_TRANSPARENT = buildBlockLookup((block) => TRANSPARENT_BLOCKS.includes(block));
const IS_TRANSLUCENT = buildBlockLookup((block) => TRANSLUCENT_BLOCKS.includes(block));
const IS_SLAB = buildBlockLookup(isSlab);
const IS_TOP_SLAB = buildBlockLookup(isTopSlab);
const IS_WATER = buildBlockLookup(isWater);
const OCCLUDES_AMBIENT_LIGHT = buildBlockLookup(
  (block) =>
    block !== BlockType.AIR && !TRANSPARENT_BLOCKS.includes(block) && !TRANSLUCENT_BLOCKS.includes(block)
);
const RECEIVES_AMBIENT_OCCLUSION = buildBlockLookup(
  (block) => !TRANSLUCENT_BLOCKS.includes(block) && !isSlab(block)
);

// A texture index of 0 is the invalid texture, so a falsy face texture falls back
// to the side texture and then the default, as the face tables always did.
function buildFaceTextureLookup(faceKey: "TOP_FACE" | "BOTTOM_FACE" | "FRONT_FACE" | "BACK_FACE" | "LEFT_FACE" | "RIGHT_FACE", fallsBackToSides: boolean): Uint8Array {
  const lookup = new Uint8Array(BLOCK_ID_COUNT);
  for (let block = 0; block < BLOCK_ID_COUNT; block++) {
    const textures = BLOCK_TEXTURES[block];
    if (!textures) continue;
    const defaultTexture = textures.DEFAULT ?? 0;
    const faceTexture = textures[faceKey];
    if (faceTexture) lookup[block] = faceTexture;
    else if (fallsBackToSides && textures.SIDES) lookup[block] = textures.SIDES;
    else lookup[block] = defaultTexture;
  }
  return lookup;
}

// Face order: up, down, front (+z), back (-z), left (-x), right (+x).
const FACE_UP = 0;
const FACE_DOWN = 1;
const FACE_COUNT = 6;
const FACE_TEXTURES = [
  buildFaceTextureLookup("TOP_FACE", false),
  buildFaceTextureLookup("BOTTOM_FACE", false),
  buildFaceTextureLookup("FRONT_FACE", true),
  buildFaceTextureLookup("BACK_FACE", true),
  buildFaceTextureLookup("LEFT_FACE", true),
  buildFaceTextureLookup("RIGHT_FACE", true),
];
const FACE_NORMALS: number[][] = [
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [-1, 0, 0],
  [1, 0, 0],
];

// Corner flags per face: x, y (0 = bottom of the block, 1 = top), z.
const FACE_CORNERS: number[][][] = [
  [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]],
  [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]],
  [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]],
  [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]],
];

// UV codes: 0 and 1 are the texture edges, 2 is the block's top row, 3 its bottom row.
const UV_ZERO = 0;
const UV_ONE = 1;
const UV_ROW_TOP = 2;
const UV_ROW_BOTTOM = 3;
const FACE_UV_CODES: number[][][] = [
  [[UV_ONE, UV_ONE], [UV_ZERO, UV_ONE], [UV_ONE, UV_ZERO], [UV_ZERO, UV_ZERO]],
  [[UV_ONE, UV_ZERO], [UV_ZERO, UV_ZERO], [UV_ONE, UV_ONE], [UV_ZERO, UV_ONE]],
  [[UV_ONE, UV_ROW_BOTTOM], [UV_ZERO, UV_ROW_BOTTOM], [UV_ONE, UV_ROW_TOP], [UV_ZERO, UV_ROW_TOP]],
  [[UV_ONE, UV_ROW_BOTTOM], [UV_ZERO, UV_ROW_BOTTOM], [UV_ONE, UV_ROW_TOP], [UV_ZERO, UV_ROW_TOP]],
  [[UV_ZERO, UV_ROW_TOP], [UV_ZERO, UV_ROW_BOTTOM], [UV_ONE, UV_ROW_TOP], [UV_ONE, UV_ROW_BOTTOM]],
  [[UV_ZERO, UV_ROW_TOP], [UV_ZERO, UV_ROW_BOTTOM], [UV_ONE, UV_ROW_TOP], [UV_ONE, UV_ROW_BOTTOM]],
];

// The block grid is copied into an array padded by one block on every side so
// every neighbor and ambient occlusion sample is a plain index, with no bounds
// branches. Only face slabs of neighbor chunks exist, so cells diagonal across a
// chunk edge stay empty and read as open air.
const PADDED_WIDTH = CHUNK_WIDTH + 2;
const PADDED_HEIGHT = CHUNK_HEIGHT + 2;
const PADDED_LENGTH = CHUNK_LENGTH + 2;
const STRIDE_X = PADDED_HEIGHT * PADDED_LENGTH;
const STRIDE_Y = PADDED_LENGTH;
const PADDED_VOLUME = PADDED_WIDTH * STRIDE_X;

function paddedIndex(x: number, y: number, z: number): number {
  return (x + 1) * STRIDE_X + (y + 1) * STRIDE_Y + (z + 1);
}

function paddedDelta(dx: number, dy: number, dz: number): number {
  return dx * STRIDE_X + dy * STRIDE_Y + dz;
}

const FACE_NEIGHBOR_DELTAS = FACE_NORMALS.map(([dx, dy, dz]) => paddedDelta(dx, dy, dz));

// For each face and corner, the offsets of the two side blocks and the corner block
// that darken that vertex (0 = fully boxed in, 3 = open). The same cells are averaged
// into the vertex light so brightness changes smoothly across a face.
const VERTEX_SAMPLE_OFFSETS = FACE_NORMALS.map((normal, face) =>
  FACE_CORNERS[face].map((corner) => {
    const [firstTangent, secondTangent] = [0, 1, 2].filter((axis) => normal[axis] === 0);
    const firstStep = [0, 0, 0];
    firstStep[firstTangent] = corner[firstTangent] === 1 ? 1 : -1;
    const secondStep = [0, 0, 0];
    secondStep[secondTangent] = corner[secondTangent] === 1 ? 1 : -1;
    return [
      [normal[0] + firstStep[0], normal[1] + firstStep[1], normal[2] + firstStep[2]],
      [normal[0] + secondStep[0], normal[1] + secondStep[1], normal[2] + secondStep[2]],
      [
        normal[0] + firstStep[0] + secondStep[0],
        normal[1] + firstStep[1] + secondStep[1],
        normal[2] + firstStep[2] + secondStep[2],
      ],
    ];
  })
);

const AMBIENT_OCCLUSION_SAMPLE_DELTAS = VERTEX_SAMPLE_OFFSETS.map((faceOffsets) =>
  faceOffsets.map((cornerOffsets) =>
    cornerOffsets.map(([dx, dy, dz]) => paddedDelta(dx, dy, dz))
  )
);

const FACE_BY_AXIS_AND_DIRECTION = [0, 1, 2].map((axis) => {
  const faceFor = (direction: number) =>
    FACE_NORMALS.findIndex((normal) => normal[axis] === direction);
  return { negative: faceFor(-1), positive: faceFor(1) };
});

const PLANT_NEIGHBOR_DELTAS = PLANT_NEIGHBOR_DIRECTIONS.map(([dx, dy, dz]) =>
  paddedDelta(dx, dy, dz)
);

const FACE_KIND_UP = 0;
const FACE_KIND_DOWN = 1;
const FACE_KIND_SIDE = 2;
const FACE_KINDS = [FACE_KIND_UP, FACE_KIND_DOWN, FACE_KIND_SIDE, FACE_KIND_SIDE, FACE_KIND_SIDE, FACE_KIND_SIDE];

function isFaceCulled(block: number, neighbor: number, faceKind: number): boolean {
  if (neighbor === BlockType.AIR) return false;

  // If I am a bottom slab, my top face is never covered by the block above
  if (faceKind === FACE_KIND_UP && IS_SLAB[block] && !IS_TOP_SLAB[block]) return false;

  // If I am a top slab, my bottom face is never covered by the block below
  if (faceKind === FACE_KIND_DOWN && IS_TOP_SLAB[block]) return false;

  // If the neighbor below is a bottom slab, it never covers my bottom face
  if (faceKind === FACE_KIND_DOWN && IS_SLAB[neighbor] && !IS_TOP_SLAB[neighbor]) return false;

  // If the neighbor above is a top slab, it never covers my top face
  if (faceKind === FACE_KIND_UP && IS_TOP_SLAB[neighbor]) return false;

  if (!IS_TRANSPARENT[neighbor]) return true;

  if (IS_SLAB[block] && IS_SLAB[neighbor]) {
    // Slabs only cull each other on the sides if they are the same type (both top or both bottom)
    if (faceKind === FACE_KIND_SIDE) {
      return IS_TOP_SLAB[block] === IS_TOP_SLAB[neighbor];
    }
  }

  if (IS_WATER[block] && IS_WATER[neighbor]) return true;
  if (block === BlockType.GLASS && neighbor === BlockType.GLASS) return true;

  return false;
}

function fillPaddedBlocks(
  paddedBlocks: Uint8Array,
  chunk: Uint8Array,
  borders: ChunkFaceBuffers
) {
  startWorkerSection("fillPaddedBlocks");
  startWorkerSection("copyChunkRows");
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      const chunkRowStart = calculateOffset(x, y, 0);
      paddedBlocks.set(
        chunk.subarray(chunkRowStart, chunkRowStart + CHUNK_LENGTH),
        paddedIndex(x, y, 0)
      );
    }
  }
  endWorkerSection();
  copyBorderSlabs(paddedBlocks, borders);
  endWorkerSection();
}

// Border layouts: top and bottom are [x * length + z], left and right are
// [y * length + z], back and front are [x * height + y].
function copyBorderSlabs(
  target: Uint8Array,
  borders: ChunkFaceBuffers,
  valueMap?: Uint8Array
) {
  startWorkerSection("copyBorderSlabs");
  const left = borders.left ? new Uint8Array(borders.left) : undefined;
  const right = borders.right ? new Uint8Array(borders.right) : undefined;
  const bottom = borders.bottom ? new Uint8Array(borders.bottom) : undefined;
  const top = borders.top ? new Uint8Array(borders.top) : undefined;
  const back = borders.back ? new Uint8Array(borders.back) : undefined;
  const front = borders.front ? new Uint8Array(borders.front) : undefined;
  const map = (value: number) => (valueMap ? valueMap[value] : value);
  addWorkerCounter(
    "borderSlabsCopied",
    Number(Boolean(left)) +
      Number(Boolean(right)) +
      Number(Boolean(bottom)) +
      Number(Boolean(top)) +
      Number(Boolean(back)) +
      Number(Boolean(front))
  );

  if (left || right) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        if (left) target[paddedIndex(-1, y, z)] = map(left[y * CHUNK_LENGTH + z]);
        if (right) target[paddedIndex(CHUNK_WIDTH, y, z)] = map(right[y * CHUNK_LENGTH + z]);
      }
    }
  }
  if (bottom || top) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        if (bottom) target[paddedIndex(x, -1, z)] = map(bottom[x * CHUNK_LENGTH + z]);
        if (top) target[paddedIndex(x, CHUNK_HEIGHT, z)] = map(top[x * CHUNK_LENGTH + z]);
      }
    }
  }
  if (back || front) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        if (back) target[paddedIndex(x, y, -1)] = map(back[x * CHUNK_HEIGHT + y]);
        if (front) target[paddedIndex(x, y, CHUNK_LENGTH)] = map(front[x * CHUNK_HEIGHT + y]);
      }
    }
  }
  endWorkerSection();
}

const LIGHT_LEVEL_OF_PACKED_LIGHT = (() => {
  const lookup = new Uint8Array(BLOCK_ID_COUNT);
  for (let packed = 0; packed < BLOCK_ID_COUNT; packed++) {
    lookup[packed] = Math.max((packed >> 4) & 0xf, packed & 0xf);
  }
  return lookup;
})();

// Same layout as fillPaddedBlocks, holding max(sky, block) light per cell.
function fillPaddedLightLevels(
  paddedLight: Uint8Array,
  lightMap: Uint8Array,
  borderLights: ChunkFaceBuffers
) {
  startWorkerSection("fillPaddedLight");
  startWorkerSection("mapChunkLight");
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      const rowStart = calculateOffset(x, y, 0);
      const paddedRowStart = paddedIndex(x, y, 0);
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        paddedLight[paddedRowStart + z] = LIGHT_LEVEL_OF_PACKED_LIGHT[lightMap[rowStart + z]];
      }
    }
  }
  endWorkerSection();
  copyBorderSlabs(paddedLight, borderLights, LIGHT_LEVEL_OF_PACKED_LIGHT);
  endWorkerSection();
}

const EMPTY_RESULT = (): ChunkMeshResult => ({
  opaque: new ArrayBuffer(0),
  transparent: new ArrayBuffer(0),
  plants: [],
});

function reportFacesPerBlockType(facesByBlockId: Int32Array) {
  for (let blockId = 0; blockId < BLOCK_ID_COUNT; blockId++) {
    const faceCount = facesByBlockId[blockId];
    if (faceCount === 0) continue;
    addWorkerKeyedUnits(
      DIMENSIONS.meshBlockFaces,
      BlockType[blockId] ?? `block${blockId}`,
      faceCount
    );
  }
}

export function generateMesh(
  _chunk: ArrayBuffer,
  _lightBuffer: ArrayBuffer,
  borders: ChunkFaceBuffers = {},
  borderLights: ChunkFaceBuffers = {},
  seed: number = 0,
  chunkX: number = 0,
  chunkY: number = 0,
  chunkZ: number = 0
): ChunkMeshResult {
  const isProfiling = isWorkerProfiling();
  startWorkerSection("unpackInputs");
  const chunk = new Uint8Array(_chunk);
  const lightMap = new Uint8Array(_lightBuffer);

  startWorkerSection("emptyScan");
  let hasAnyBlock = false;
  for (let index = 0; index < chunk.length; index++) {
    if (chunk[index] !== BlockType.AIR) {
      hasAnyBlock = true;
      break;
    }
  }
  endWorkerSection();
  if (!hasAnyBlock) {
    endWorkerSection();
    addWorkerCounter("blocksScanned", CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
    addWorkerCounter("emptyChunksSkipped", 1);
    return EMPTY_RESULT();
  }

  startWorkerSection("allocatePaddedGrids");
  const paddedBlocks = new Uint8Array(PADDED_VOLUME);
  const paddedLight = new Uint8Array(PADDED_VOLUME);
  endWorkerSection();
  addWorkerCounter("paddedGridBytes", paddedBlocks.byteLength + paddedLight.byteLength);
  fillPaddedBlocks(paddedBlocks, chunk, borders);
  fillPaddedLightLevels(paddedLight, lightMap, borderLights);
  // Order matches FACE_NORMALS: up, down, front, back, left, right.
  const hasLightBorderForFace = [
    Boolean(borderLights.top),
    Boolean(borderLights.bottom),
    Boolean(borderLights.front),
    Boolean(borderLights.back),
    Boolean(borderLights.left),
    Boolean(borderLights.right),
  ];
  endWorkerSection();

  const opaque = new VertexStream();
  const transparent = new VertexStream();
  const plantInstancesByBlock = new Map<number, number[]>();
  const facesByBlockId = new Int32Array(BLOCK_ID_COUNT);

  let solidBlocksVisited = 0;
  let transparentBlocksVisited = 0;
  let translucentBlocksVisited = 0;
  let stairBlocksVisited = 0;
  let facesCulled = 0;
  let facesEmitted = 0;
  let stairQuadsEmitted = 0;
  let aoQuads = 0;
  let plantInstancesEmitted = 0;
  let unloadedLightEstimates = 0;
  let edgeLightCellChecks = 0;

  let lookUpSurfaceHeight: ((x: number, z: number) => number) | undefined;
  // Light for a face whose neighbor chunk is not loaded: sky above the terrain, else dimmed own light.
  const estimateUnloadedLight = (
    neighborX: number,
    neighborY: number,
    neighborZ: number,
    ownLight: number
  ) => {
    unloadedLightEstimates++;
    lookUpSurfaceHeight ??= createSurfaceHeightSampler(seed);
    const surfaceY = lookUpSurfaceHeight(
      chunkX * CHUNK_WIDTH + neighborX,
      chunkZ * CHUNK_LENGTH + neighborZ
    );
    const heuristic = chunkY * CHUNK_HEIGHT + neighborY > surfaceY ? 15 : 0;
    return Math.max(heuristic, ownLight - 1);
  };

  const cornerPositionWords = new Int32Array(4);
  const cornerSurfaceWords = new Int32Array(4);
  const cornerOcclusion = new Int32Array(4);

  // Light cells diagonal across a chunk edge are not stored, and slabs of unloaded
  // neighbors are empty, so those cells say nothing about the real light.
  const isLightCellKnown = (x: number, y: number, z: number, offset: number[]) => {
    edgeLightCellChecks++;
    const cell = [x + offset[0], y + offset[1], z + offset[2]];
    const limits = [CHUNK_WIDTH, CHUNK_HEIGHT, CHUNK_LENGTH];
    let outsideAxisCount = 0;
    let outsideFace = -1;
    for (let axis = 0; axis < 3; axis++) {
      if (cell[axis] < 0) {
        outsideAxisCount++;
        outsideFace = FACE_BY_AXIS_AND_DIRECTION[axis].negative;
      } else if (cell[axis] >= limits[axis]) {
        outsideAxisCount++;
        outsideFace = FACE_BY_AXIS_AND_DIRECTION[axis].positive;
      }
    }
    if (outsideAxisCount === 0) return true;
    return outsideAxisCount === 1 && hasLightBorderForFace[outsideFace];
  };

  startWorkerSection("faceGeneration");
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const block = chunk[calculateOffset(x, y, z)];
        if (block === BlockType.AIR) continue;
        solidBlocksVisited++;

        const paddedBase = paddedIndex(x, y, z);
        const ownLight = paddedLight[paddedBase];

        if (isPlantVoxelBlock(block)) {
          if (isProfiling) {
            startWorkerSampledSection(
              "plantInstance",
              BLOCK_SECTION_SAMPLE_INTERVAL,
              DIMENSIONS.meshPart,
              MESH_PART_PLANTS
            );
          }
          let neighborMask = 0;
          for (let direction = 0; direction < PLANT_NEIGHBOR_DELTAS.length; direction++) {
            if (OCCLUDES_AMBIENT_LIGHT[paddedBlocks[paddedBase + PLANT_NEIGHBOR_DELTAS[direction]]]) {
              neighborMask |= 1 << direction;
            }
          }
          let instances = plantInstancesByBlock.get(block);
          if (!instances) {
            instances = [];
            plantInstancesByBlock.set(block, instances);
          }
          instances.push(packPlantInstance(x, y, z, ownLight, neighborMask));
          plantInstancesEmitted++;
          if (isProfiling) endWorkerSection();
          continue;
        }

        if (isStairs(block)) {
          if (isProfiling) {
            startWorkerSampledSection(
              "stairBlock",
              BLOCK_SECTION_SAMPLE_INTERVAL,
              DIMENSIONS.meshPart,
              MESH_PART_STAIRS
            );
          }
          const verticesBeforeStairs = opaque.vertexCount;
          emitStairs(opaque, block, x, y, z, ownLight, paddedBlocks, paddedBase);
          const stairQuads = (opaque.vertexCount - verticesBeforeStairs) / VERTICES_PER_QUAD;
          stairBlocksVisited++;
          stairQuadsEmitted += stairQuads;
          facesByBlockId[block] += stairQuads;
          if (isProfiling) endWorkerSection();
          continue;
        }

        if (IS_TRANSPARENT[block]) transparentBlocksVisited++;
        const isTranslucent = IS_TRANSLUCENT[block] === 1;
        if (isTranslucent) translucentBlocksVisited++;
        if (isProfiling) {
          startWorkerSampledSection(
            "cubeBlock",
            BLOCK_SECTION_SAMPLE_INTERVAL,
            DIMENSIONS.meshPart,
            isTranslucent ? MESH_PART_TRANSPARENT : MESH_PART_OPAQUE
          );
        }
        const target = isTranslucent ? transparent : opaque;
        const receivesAmbientOcclusion = RECEIVES_AMBIENT_OCCLUSION[block] === 1;

        const isSlabBlock = IS_SLAB[block] === 1;
        const blockAbove = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_UP]];
        const blockHeight16 = isSlabBlock
          ? POSITION_UNITS_PER_BLOCK / 2
          : IS_WATER[block] && !IS_WATER[blockAbove]
          ? Math.round((getWaterLevel(block) / 9) * POSITION_UNITS_PER_BLOCK)
          : POSITION_UNITS_PER_BLOCK;
        const yOffset16 = IS_TOP_SLAB[block] ? POSITION_UNITS_PER_BLOCK / 2 : 0;
        const bottomY16 = y * POSITION_UNITS_PER_BLOCK + yOffset16;
        const topY16 = bottomY16 + blockHeight16;

        let rowTopV = 0;
        let rowBottomV = UV_UNITS_PER_TEXTURE;
        if (isSlabBlock) {
          if (IS_TOP_SLAB[block]) rowBottomV = UV_UNITS_PER_TEXTURE / 2;
          else rowTopV = UV_UNITS_PER_TEXTURE / 2;
        }

        const isOnChunkEdge =
          x === 0 ||
          x === CHUNK_WIDTH - 1 ||
          y === 0 ||
          y === CHUNK_HEIGHT - 1 ||
          z === 0 ||
          z === CHUNK_LENGTH - 1;

        for (let face = 0; face < FACE_COUNT; face++) {
          const neighbor = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[face]];
          if (isFaceCulled(block, neighbor, FACE_KINDS[face])) {
            facesCulled++;
            continue;
          }

          if (isProfiling) startWorkerSampledSection("emitFace", FACE_SECTION_SAMPLE_INTERVAL);
          let faceLight = paddedLight[paddedBase + FACE_NEIGHBOR_DELTAS[face]];
          if (isOnChunkEdge && !hasLightBorderForFace[face]) {
            const normal = FACE_NORMALS[face];
            const neighborX = x + normal[0];
            const neighborY = y + normal[1];
            const neighborZ = z + normal[2];
            const isNeighborOutside =
              neighborX < 0 ||
              neighborX >= CHUNK_WIDTH ||
              neighborY < 0 ||
              neighborY >= CHUNK_HEIGHT ||
              neighborZ < 0 ||
              neighborZ >= CHUNK_LENGTH;
            if (isNeighborOutside) {
              faceLight = estimateUnloadedLight(neighborX, neighborY, neighborZ, ownLight);
            }
          }

          const textureIndex = FACE_TEXTURES[face][block];
          const corners = FACE_CORNERS[face];
          const uvCodes = FACE_UV_CODES[face];

          if (isProfiling) startWorkerSampledSection("cornerPositions", FACE_SECTION_SAMPLE_INTERVAL);
          for (let corner = 0; corner < 4; corner++) {
            const cornerFlags = corners[corner];
            cornerPositionWords[corner] = packPositionWord(
              (x + cornerFlags[0]) * POSITION_UNITS_PER_BLOCK,
              cornerFlags[1] ? topY16 : bottomY16,
              (z + cornerFlags[2]) * POSITION_UNITS_PER_BLOCK
            );
          }
          if (isProfiling) endWorkerSection();

          if (isProfiling) startWorkerSampledSection("ambientOcclusion", FACE_SECTION_SAMPLE_INTERVAL);
          for (let corner = 0; corner < 4; corner++) {
            let occlusion = FULLY_LIT_AMBIENT_OCCLUSION;
            if (receivesAmbientOcclusion) {
              const sampleDeltas = AMBIENT_OCCLUSION_SAMPLE_DELTAS[face][corner];
              const isFirstSideBlocked = OCCLUDES_AMBIENT_LIGHT[paddedBlocks[paddedBase + sampleDeltas[0]]];
              const isSecondSideBlocked = OCCLUDES_AMBIENT_LIGHT[paddedBlocks[paddedBase + sampleDeltas[1]]];
              const isCornerBlocked = OCCLUDES_AMBIENT_LIGHT[paddedBlocks[paddedBase + sampleDeltas[2]]];
              occlusion =
                isFirstSideBlocked && isSecondSideBlocked
                  ? 0
                  : FULLY_LIT_AMBIENT_OCCLUSION -
                    isFirstSideBlocked -
                    isSecondSideBlocked -
                    isCornerBlocked;
            }
            cornerOcclusion[corner] = occlusion;
          }
          if (isProfiling) endWorkerSection();

          if (isProfiling) startWorkerSampledSection("vertexLightAndSurface", FACE_SECTION_SAMPLE_INTERVAL);
          for (let corner = 0; corner < 4; corner++) {
            let lightSum = faceLight;
            let lightCellCount = 1;
            const sampleDeltas = AMBIENT_OCCLUSION_SAMPLE_DELTAS[face][corner];
            for (let sample = 0; sample < 3; sample++) {
              if (OCCLUDES_AMBIENT_LIGHT[paddedBlocks[paddedBase + sampleDeltas[sample]]]) continue;
              if (
                isOnChunkEdge &&
                !isLightCellKnown(x, y, z, VERTEX_SAMPLE_OFFSETS[face][corner][sample])
              ) {
                continue;
              }
              lightSum += paddedLight[paddedBase + sampleDeltas[sample]];
              lightCellCount++;
            }
            const vertexLightSteps = Math.round((lightSum * LIGHT_STEPS_PER_LEVEL) / lightCellCount);

            const uvCode = uvCodes[corner];
            cornerSurfaceWords[corner] = packSurfaceWord(
              uvCode[0] === UV_ONE ? UV_UNITS_PER_TEXTURE : 0,
              uvCode[1] === UV_ONE
                ? UV_UNITS_PER_TEXTURE
                : uvCode[1] === UV_ROW_TOP
                ? rowTopV
                : uvCode[1] === UV_ROW_BOTTOM
                ? rowBottomV
                : 0,
              textureIndex,
              cornerOcclusion[corner],
              vertexLightSteps
            );
          }
          if (isProfiling) endWorkerSection();
          if (receivesAmbientOcclusion) aoQuads++;

          // Split along the brighter diagonal so a dark corner does not streak.
          if (isProfiling) startWorkerSampledSection("pushQuad", FACE_SECTION_SAMPLE_INTERVAL);
          target.pushQuad(
            cornerPositionWords[0],
            cornerSurfaceWords[0],
            cornerPositionWords[1],
            cornerSurfaceWords[1],
            cornerPositionWords[2],
            cornerSurfaceWords[2],
            cornerPositionWords[3],
            cornerSurfaceWords[3],
            cornerOcclusion[0] + cornerOcclusion[3] > cornerOcclusion[1] + cornerOcclusion[2]
          );
          if (isProfiling) endWorkerSection();
          facesEmitted++;
          facesByBlockId[block]++;
          if (isProfiling) endWorkerSection();
        }
        if (isProfiling) endWorkerSection();
      }
    }
  }
  endWorkerSection();

  startWorkerSection("packResult");
  startWorkerSection("plantInstanceBuffers", DIMENSIONS.meshPart, MESH_PART_PLANTS);
  const plants: PlantInstanceBatch[] = [];
  plantInstancesByBlock.forEach((instanceWords, blockType) => {
    plants.push({ blockType, instances: new Uint32Array(instanceWords).buffer });
  });
  endWorkerSection();
  startWorkerSection("opaqueBuffer", DIMENSIONS.meshPart, MESH_PART_OPAQUE);
  const opaqueBuffer = opaque.toBuffer();
  endWorkerSection();
  startWorkerSection("transparentBuffer", DIMENSIONS.meshPart, MESH_PART_TRANSPARENT);
  const transparentBuffer = transparent.toBuffer();
  endWorkerSection();
  const result: ChunkMeshResult = {
    opaque: opaqueBuffer,
    transparent: transparentBuffer,
    plants,
  };
  endWorkerSection();

  facesEmitted += stairQuadsEmitted;
  addWorkerCounter("blocksScanned", CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
  addWorkerCounter("solidBlocksVisited", solidBlocksVisited);
  addWorkerCounter("transparentBlocksVisited", transparentBlocksVisited);
  addWorkerCounter("translucentBlocksVisited", translucentBlocksVisited);
  addWorkerCounter("stairBlocksVisited", stairBlocksVisited);
  addWorkerCounter("facesEmitted", facesEmitted);
  addWorkerCounter("stairQuadsEmitted", stairQuadsEmitted);
  addWorkerCounter("facesCulled", facesCulled);
  addWorkerCounter("opaqueVertices", opaque.vertexCount);
  addWorkerCounter("transparentVertices", transparent.vertexCount);
  addWorkerCounter("aoSamples", aoQuads * 12);
  addWorkerCounter("plantInstancesEmitted", plantInstancesEmitted);
  addWorkerCounter("unloadedLightEstimates", unloadedLightEstimates);
  addWorkerCounter("edgeLightCellChecks", edgeLightCellChecks);
  if (isProfiling) {
    addWorkerCounter("opaqueBytes", opaqueBuffer.byteLength);
    addWorkerCounter("transparentBytes", transparentBuffer.byteLength);
    addWorkerCounter(
      "plantBytes",
      plants.reduce((total, batch) => total + batch.instances.byteLength, 0)
    );
    addWorkerCounter(
      "impliedIndices",
      ((opaque.vertexCount + transparent.vertexCount) / VERTICES_PER_QUAD) * INDICES_PER_QUAD
    );
    reportFacesPerBlockType(facesByBlockId);
    addWorkerKeyedUnits(
      DIMENSIONS.meshPart,
      MESH_PART_OPAQUE,
      opaque.vertexCount / VERTICES_PER_QUAD - stairQuadsEmitted
    );
    addWorkerKeyedUnits(DIMENSIONS.meshPart, MESH_PART_TRANSPARENT, transparent.vertexCount / VERTICES_PER_QUAD);
    addWorkerKeyedUnits(DIMENSIONS.meshPart, MESH_PART_STAIRS, stairQuadsEmitted);
    addWorkerKeyedUnits(DIMENSIONS.meshPart, MESH_PART_PLANTS, plantInstancesEmitted);
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

type Corner = [number, number, number];

// Stairs are rare, so they are written as explicit quads rather than driven by the face tables.
function emitStairs(
  target: VertexStream,
  block: BlockType,
  x: number,
  y: number,
  z: number,
  light: number,
  paddedBlocks: Uint8Array,
  paddedBase: number
) {
  const direction = getDirection(block);
  const textures = BLOCK_TEXTURES[block];
  const textureIndexDefault = textures.DEFAULT ?? 0;
  const textureIndexSides = textures.SIDES;
  const textureIndexFront = textures.FRONT_FACE;
  const textureIndexBack = textures.BACK_FACE;
  const textureIndexTop = textures.TOP_FACE;
  const textureIndexBottom = textures.BOTTOM_FACE;
  const textureIndexLeft = textures.LEFT_FACE;
  const textureIndexRight = textures.RIGHT_FACE;

  const blockAbove = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_UP]];
  const blockBelow = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_DOWN]];
  const blockInfront = paddedBlocks[paddedBase + paddedDelta(0, 0, 1)];
  const blockBehind = paddedBlocks[paddedBase + paddedDelta(0, 0, -1)];
  const blockToTheLeft = paddedBlocks[paddedBase + paddedDelta(-1, 0, 0)];
  const blockToTheRight = paddedBlocks[paddedBase + paddedDelta(1, 0, 0)];

  const pushQuad = (
    p1: Corner,
    p2: Corner,
    p3: Corner,
    p4: Corner,
    uv: number[],
    textureIndex: number
  ) => {
    const corners = [p1, p2, p3, p4];
    const positionWords = corners.map((corner) =>
      packPositionWord(
        corner[0] * POSITION_UNITS_PER_BLOCK,
        corner[1] * POSITION_UNITS_PER_BLOCK,
        corner[2] * POSITION_UNITS_PER_BLOCK
      )
    );
    const surfaceWords = corners.map((_, index) =>
      packSurfaceWord(
        uv[index * 2] * UV_UNITS_PER_TEXTURE,
        uv[index * 2 + 1] * UV_UNITS_PER_TEXTURE,
        textureIndex,
        FULLY_LIT_AMBIENT_OCCLUSION,
        light * LIGHT_STEPS_PER_LEVEL
      )
    );
    target.pushQuad(
      positionWords[0],
      surfaceWords[0],
      positionWords[1],
      surfaceWords[1],
      positionWords[2],
      surfaceWords[2],
      positionWords[3],
      surfaceWords[3],
      false
    );
  };

  const sideTexture = (faceTexture: number | undefined) =>
    faceTexture ?? textureIndexSides ?? textureIndexDefault;

  // Bottom Face (y=0)
  if (!isFaceCulled(block, blockBelow, FACE_KIND_DOWN)) {
    pushQuad(
      [x + 1, y, z + 1],
      [x, y, z + 1],
      [x + 1, y, z],
      [x, y, z],
      [1, 0, 0, 0, 1, 1, 0, 1],
      textureIndexBottom ?? textureIndexDefault
    );
  }

  // Top Face of Bottom Slab (y=0.5)
  let exposedMinX = 0,
    exposedMaxX = 1,
    exposedMinZ = 0,
    exposedMaxZ = 1;
  if (direction === "NORTH") exposedMinZ = 0.5;
  else if (direction === "SOUTH") exposedMaxZ = 0.5;
  else if (direction === "EAST") exposedMaxX = 0.5;
  else if (direction === "WEST") exposedMinX = 0.5;

  pushQuad(
    [x + exposedMinX, y + 0.5, z + exposedMaxZ],
    [x + exposedMaxX, y + 0.5, z + exposedMaxZ],
    [x + exposedMinX, y + 0.5, z + exposedMinZ],
    [x + exposedMaxX, y + 0.5, z + exposedMinZ],
    [
      1 - exposedMinX,
      exposedMaxZ,
      1 - exposedMaxX,
      exposedMaxZ,
      1 - exposedMinX,
      exposedMinZ,
      1 - exposedMaxX,
      exposedMinZ,
    ],
    textureIndexTop ?? textureIndexDefault
  );

  // Top Face of Top Slab (y=1)
  let topMinX = 0,
    topMaxX = 1,
    topMinZ = 0,
    topMaxZ = 1;
  if (direction === "NORTH") topMaxZ = 0.5;
  else if (direction === "SOUTH") topMinZ = 0.5;
  else if (direction === "EAST") topMinX = 0.5;
  else if (direction === "WEST") topMaxX = 0.5;

  if (!isFaceCulled(block, blockAbove, FACE_KIND_UP)) {
    pushQuad(
      [x + topMinX, y + 1, z + topMaxZ],
      [x + topMaxX, y + 1, z + topMaxZ],
      [x + topMinX, y + 1, z + topMinZ],
      [x + topMaxX, y + 1, z + topMinZ],
      [
        1 - topMinX,
        topMaxZ,
        1 - topMaxX,
        topMaxZ,
        1 - topMinX,
        topMinZ,
        1 - topMaxX,
        topMinZ,
      ],
      textureIndexTop ?? textureIndexDefault
    );
  }

  // Vertical Step Face
  const stepUv = [1, 0.5, 0, 0.5, 1, 1, 0, 1];
  if (direction === "NORTH") {
    pushQuad([x, y + 0.5, z + 0.5], [x + 1, y + 0.5, z + 0.5], [x, y + 1, z + 0.5], [x + 1, y + 1, z + 0.5], stepUv, sideTexture(undefined));
  } else if (direction === "SOUTH") {
    pushQuad([x + 1, y + 0.5, z + 0.5], [x, y + 0.5, z + 0.5], [x + 1, y + 1, z + 0.5], [x, y + 1, z + 0.5], stepUv, sideTexture(undefined));
  } else if (direction === "EAST") {
    pushQuad([x + 0.5, y + 0.5, z], [x + 0.5, y + 0.5, z + 1], [x + 0.5, y + 1, z], [x + 0.5, y + 1, z + 1], stepUv, sideTexture(undefined));
  } else if (direction === "WEST") {
    pushQuad([x + 0.5, y + 0.5, z + 1], [x + 0.5, y + 0.5, z], [x + 0.5, y + 1, z + 1], [x + 0.5, y + 1, z], stepUv, sideTexture(undefined));
  }

  const lowerHalfUv = [1, 0, 0, 0, 1, 0.5, 0, 0.5];

  // Front (z=1)
  if (!isFaceCulled(block, blockInfront, FACE_KIND_SIDE)) {
    const texture = sideTexture(textureIndexFront);
    pushQuad([x, y, z + 1], [x + 1, y, z + 1], [x, y + 0.5, z + 1], [x + 1, y + 0.5, z + 1], lowerHalfUv, texture);
    if (direction === "SOUTH") {
      pushQuad([x, y + 0.5, z + 1], [x + 1, y + 0.5, z + 1], [x, y + 1, z + 1], [x + 1, y + 1, z + 1], [1, 0.5, 0, 0.5, 1, 1, 0, 1], texture);
    } else if (direction === "EAST") {
      pushQuad([x + 0.5, y + 0.5, z + 1], [x + 1, y + 0.5, z + 1], [x + 0.5, y + 1, z + 1], [x + 1, y + 1, z + 1], [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1], texture);
    } else if (direction === "WEST") {
      pushQuad([x, y + 0.5, z + 1], [x + 0.5, y + 0.5, z + 1], [x, y + 1, z + 1], [x + 0.5, y + 1, z + 1], [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1], texture);
    }
  }

  // Back (z=0)
  if (!isFaceCulled(block, blockBehind, FACE_KIND_SIDE)) {
    const texture = sideTexture(textureIndexBack);
    pushQuad([x + 1, y, z], [x, y, z], [x + 1, y + 0.5, z], [x, y + 0.5, z], lowerHalfUv, texture);
    if (direction === "NORTH") {
      pushQuad([x + 1, y + 0.5, z], [x, y + 0.5, z], [x + 1, y + 1, z], [x, y + 1, z], [1, 0.5, 0, 0.5, 1, 1, 0, 1], texture);
    } else if (direction === "EAST") {
      pushQuad([x + 1, y + 0.5, z], [x + 0.5, y + 0.5, z], [x + 1, y + 1, z], [x + 0.5, y + 1, z], [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1], texture);
    } else if (direction === "WEST") {
      pushQuad([x + 0.5, y + 0.5, z], [x, y + 0.5, z], [x + 0.5, y + 1, z], [x, y + 1, z], [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1], texture);
    }
  }

  // Left (x=0)
  if (!isFaceCulled(block, blockToTheLeft, FACE_KIND_SIDE)) {
    const texture = sideTexture(textureIndexLeft);
    pushQuad([x, y, z], [x, y, z + 1], [x, y + 0.5, z], [x, y + 0.5, z + 1], lowerHalfUv, texture);
    if (direction === "WEST") {
      pushQuad([x, y + 0.5, z], [x, y + 0.5, z + 1], [x, y + 1, z], [x, y + 1, z + 1], [1, 0.5, 0, 0.5, 1, 1, 0, 1], texture);
    } else if (direction === "NORTH") {
      pushQuad([x, y + 0.5, z], [x, y + 0.5, z + 0.5], [x, y + 1, z], [x, y + 1, z + 0.5], [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1], texture);
    } else if (direction === "SOUTH") {
      pushQuad([x, y + 0.5, z + 0.5], [x, y + 0.5, z + 1], [x, y + 1, z + 0.5], [x, y + 1, z + 1], [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1], texture);
    }
  }

  // Right (x=1)
  if (!isFaceCulled(block, blockToTheRight, FACE_KIND_SIDE)) {
    const texture = sideTexture(textureIndexRight);
    pushQuad([x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + 0.5, z + 1], [x + 1, y + 0.5, z], lowerHalfUv, texture);
    if (direction === "EAST") {
      pushQuad([x + 1, y + 0.5, z + 1], [x + 1, y + 0.5, z], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], [1, 0.5, 0, 0.5, 1, 1, 0, 1], texture);
    } else if (direction === "NORTH") {
      pushQuad([x + 1, y + 0.5, z + 0.5], [x + 1, y + 0.5, z], [x + 1, y + 1, z + 0.5], [x + 1, y + 1, z], [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1], texture);
    } else if (direction === "SOUTH") {
      pushQuad([x + 1, y + 0.5, z + 1], [x + 1, y + 0.5, z + 0.5], [x + 1, y + 1, z + 1], [x + 1, y + 1, z + 0.5], [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1], texture);
    }
  }
}
