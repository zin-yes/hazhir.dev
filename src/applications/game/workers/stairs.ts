import { BLOCK_TEXTURES, BlockType, getDirection } from "@/applications/game/blocks";
import {
  CHUNK_UV_UNITS_PER_BLOCK,
  POSITION_UNITS_PER_BLOCK,
  packPositionWord,
  packSurfaceWord,
} from "../vertex-format";
import { cornerAmbientOcclusion, cornerLightSteps, faceLightLevel, sampleFaceSurface } from "./face-surface";
import {
  FACE_BACK,
  FACE_CORNER_FLAGS,
  FACE_COUNT,
  FACE_DOWN,
  FACE_FRONT,
  FACE_KIND_DOWN,
  FACE_KIND_SIDE,
  FACE_KIND_UP,
  FACE_LEFT,
  FACE_NEIGHBOR_DELTAS,
  FACE_NORMALS,
  FACE_RIGHT,
  FACE_UP,
  LIGHT_LEVEL_OF_PACKED_LIGHT,
  isFaceCulledMemoized,
} from "./mesh-tables";
import { paddedBlockGrid, paddedLightGrid } from "./padded-grid";
import type { VertexStream } from "./vertex-stream";

type Corner = [number, number, number];

const FACE_CORNER_COUNT = 4;
const faceAmbientOcclusion = new Int32Array(FACE_COUNT * FACE_CORNER_COUNT);
const faceLightSteps = new Int32Array(FACE_COUNT * FACE_CORNER_COUNT);
const isFaceSampled = new Uint8Array(FACE_COUNT);

/** Units of stair work since the last reset, flushed to the profiler once per task. */
export const stairStats = {
  surfaceSamples: 0,
  facesCulled: 0,
  quadsPushed: 0,
};

export function resetStairStats() {
  stairStats.surfaceSamples = 0;
  stairStats.facesCulled = 0;
  stairStats.quadsPushed = 0;
}

function isStairFaceCulled(block: number, neighbor: number, faceKind: number): boolean {
  const isCulled = isFaceCulledMemoized(block, neighbor, faceKind);
  if (isCulled) stairStats.facesCulled++;
  return isCulled;
}

/** The face a step's vertical riser looks toward, which is the side the lower tread extends to. */
const RISER_FACE_BY_DIRECTION: Record<string, number> = {
  NORTH: FACE_FRONT,
  SOUTH: FACE_BACK,
  EAST: FACE_LEFT,
  WEST: FACE_RIGHT,
};

// Stairs are rare, so they are written as explicit quads rather than driven by the face tables.
// Every quad shades like the cube face it lies on: ambient occlusion and light are sampled once
// per cube face and interpolated to the quad's corners, so partial faces blend with their neighbors.
export function emitStairs(
  target: VertexStream,
  block: BlockType,
  x: number,
  y: number,
  z: number,
  paddedBase: number,
  isEdgeCell: boolean,
  rowIndex: number
) {
  const ownLevel = LIGHT_LEVEL_OF_PACKED_LIGHT[paddedLightGrid.cells[paddedBase]];
  isFaceSampled.fill(0);
  const sampleFace = (face: number) => {
    if (isFaceSampled[face] === 1) return;
    isFaceSampled[face] = 1;
    stairStats.surfaceSamples++;
    sampleFaceSurface(
      face,
      paddedBase,
      faceLightLevel(face, paddedBase, isEdgeCell, ownLevel),
      true,
      isEdgeCell,
      rowIndex,
      z
    );
    for (let corner = 0; corner < FACE_CORNER_COUNT; corner++) {
      faceAmbientOcclusion[face * FACE_CORNER_COUNT + corner] = cornerAmbientOcclusion[corner];
      faceLightSteps[face * FACE_CORNER_COUNT + corner] = cornerLightSteps[corner];
    }
  };
  const interpolateFaceValues = (face: number, point: Corner, values: Int32Array) => {
    let blended = 0;
    for (let corner = 0; corner < FACE_CORNER_COUNT; corner++) {
      let weight = 1;
      for (let axis = 0; axis < 3; axis++) {
        if (FACE_NORMALS[face][axis] !== 0) continue;
        const offset = point[axis] - [x, y, z][axis];
        weight *= FACE_CORNER_FLAGS[(face * FACE_CORNER_COUNT + corner) * 3 + axis] === 1 ? offset : 1 - offset;
      }
      blended += weight * values[face * FACE_CORNER_COUNT + corner];
    }
    return Math.round(blended);
  };

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

  const paddedBlocks = paddedBlockGrid.cells;
  const blockAbove = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_UP]];
  const blockBelow = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_DOWN]];
  const blockInfront = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_FRONT]];
  const blockBehind = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_BACK]];
  const blockToTheLeft = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_LEFT]];
  const blockToTheRight = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_RIGHT]];

  const pushQuad = (
    face: number,
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
    sampleFace(face);
    const occlusions = corners.map((corner) => interpolateFaceValues(face, corner, faceAmbientOcclusion));
    const surfaceWords = corners.map((corner, index) =>
      packSurfaceWord(
        uv[index * 2] * CHUNK_UV_UNITS_PER_BLOCK,
        uv[index * 2 + 1] * CHUNK_UV_UNITS_PER_BLOCK,
        textureIndex,
        occlusions[index],
        interpolateFaceValues(face, corner, faceLightSteps)
      )
    );
    stairStats.quadsPushed++;
    target.pushQuad(
      positionWords[0],
      surfaceWords[0],
      positionWords[1],
      surfaceWords[1],
      positionWords[2],
      surfaceWords[2],
      positionWords[3],
      surfaceWords[3],
      occlusions[0] + occlusions[3] > occlusions[1] + occlusions[2]
    );
  };

  const riserFace = RISER_FACE_BY_DIRECTION[direction ?? ""];
  const sideTexture = (faceTexture: number | undefined) =>
    faceTexture ?? textureIndexSides ?? textureIndexDefault;

  // Bottom Face (y=0)
  if (!isStairFaceCulled(block, blockBelow, FACE_KIND_DOWN)) {
    pushQuad(FACE_DOWN,
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

  pushQuad(FACE_UP,
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

  if (!isStairFaceCulled(block, blockAbove, FACE_KIND_UP)) {
    pushQuad(FACE_UP,
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
    pushQuad(riserFace, [x, y + 0.5, z + 0.5], [x + 1, y + 0.5, z + 0.5], [x, y + 1, z + 0.5], [x + 1, y + 1, z + 0.5], stepUv, sideTexture(undefined));
  } else if (direction === "SOUTH") {
    pushQuad(riserFace, [x + 1, y + 0.5, z + 0.5], [x, y + 0.5, z + 0.5], [x + 1, y + 1, z + 0.5], [x, y + 1, z + 0.5], stepUv, sideTexture(undefined));
  } else if (direction === "EAST") {
    pushQuad(riserFace, [x + 0.5, y + 0.5, z], [x + 0.5, y + 0.5, z + 1], [x + 0.5, y + 1, z], [x + 0.5, y + 1, z + 1], stepUv, sideTexture(undefined));
  } else if (direction === "WEST") {
    pushQuad(riserFace, [x + 0.5, y + 0.5, z + 1], [x + 0.5, y + 0.5, z], [x + 0.5, y + 1, z + 1], [x + 0.5, y + 1, z], stepUv, sideTexture(undefined));
  }

  const lowerHalfUv = [1, 0, 0, 0, 1, 0.5, 0, 0.5];

  // Front (z=1)
  if (!isStairFaceCulled(block, blockInfront, FACE_KIND_SIDE)) {
    const texture = sideTexture(textureIndexFront);
    pushQuad(FACE_FRONT, [x, y, z + 1], [x + 1, y, z + 1], [x, y + 0.5, z + 1], [x + 1, y + 0.5, z + 1], lowerHalfUv, texture);
    if (direction === "SOUTH") {
      pushQuad(FACE_FRONT, [x, y + 0.5, z + 1], [x + 1, y + 0.5, z + 1], [x, y + 1, z + 1], [x + 1, y + 1, z + 1], [1, 0.5, 0, 0.5, 1, 1, 0, 1], texture);
    } else if (direction === "EAST") {
      pushQuad(FACE_FRONT, [x + 0.5, y + 0.5, z + 1], [x + 1, y + 0.5, z + 1], [x + 0.5, y + 1, z + 1], [x + 1, y + 1, z + 1], [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1], texture);
    } else if (direction === "WEST") {
      pushQuad(FACE_FRONT, [x, y + 0.5, z + 1], [x + 0.5, y + 0.5, z + 1], [x, y + 1, z + 1], [x + 0.5, y + 1, z + 1], [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1], texture);
    }
  }

  // Back (z=0)
  if (!isStairFaceCulled(block, blockBehind, FACE_KIND_SIDE)) {
    const texture = sideTexture(textureIndexBack);
    pushQuad(FACE_BACK, [x + 1, y, z], [x, y, z], [x + 1, y + 0.5, z], [x, y + 0.5, z], lowerHalfUv, texture);
    if (direction === "NORTH") {
      pushQuad(FACE_BACK, [x + 1, y + 0.5, z], [x, y + 0.5, z], [x + 1, y + 1, z], [x, y + 1, z], [1, 0.5, 0, 0.5, 1, 1, 0, 1], texture);
    } else if (direction === "EAST") {
      pushQuad(FACE_BACK, [x + 1, y + 0.5, z], [x + 0.5, y + 0.5, z], [x + 1, y + 1, z], [x + 0.5, y + 1, z], [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1], texture);
    } else if (direction === "WEST") {
      pushQuad(FACE_BACK, [x + 0.5, y + 0.5, z], [x, y + 0.5, z], [x + 0.5, y + 1, z], [x, y + 1, z], [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1], texture);
    }
  }

  // Left (x=0)
  if (!isStairFaceCulled(block, blockToTheLeft, FACE_KIND_SIDE)) {
    const texture = sideTexture(textureIndexLeft);
    pushQuad(FACE_LEFT, [x, y, z], [x, y, z + 1], [x, y + 0.5, z], [x, y + 0.5, z + 1], lowerHalfUv, texture);
    if (direction === "WEST") {
      pushQuad(FACE_LEFT, [x, y + 0.5, z], [x, y + 0.5, z + 1], [x, y + 1, z], [x, y + 1, z + 1], [1, 0.5, 0, 0.5, 1, 1, 0, 1], texture);
    } else if (direction === "NORTH") {
      pushQuad(FACE_LEFT, [x, y + 0.5, z], [x, y + 0.5, z + 0.5], [x, y + 1, z], [x, y + 1, z + 0.5], [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1], texture);
    } else if (direction === "SOUTH") {
      pushQuad(FACE_LEFT, [x, y + 0.5, z + 0.5], [x, y + 0.5, z + 1], [x, y + 1, z + 0.5], [x, y + 1, z + 1], [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1], texture);
    }
  }

  // Right (x=1)
  if (!isStairFaceCulled(block, blockToTheRight, FACE_KIND_SIDE)) {
    const texture = sideTexture(textureIndexRight);
    pushQuad(FACE_RIGHT, [x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + 0.5, z + 1], [x + 1, y + 0.5, z], lowerHalfUv, texture);
    if (direction === "EAST") {
      pushQuad(FACE_RIGHT, [x + 1, y + 0.5, z + 1], [x + 1, y + 0.5, z], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], [1, 0.5, 0, 0.5, 1, 1, 0, 1], texture);
    } else if (direction === "NORTH") {
      pushQuad(FACE_RIGHT, [x + 1, y + 0.5, z + 0.5], [x + 1, y + 0.5, z], [x + 1, y + 1, z + 0.5], [x + 1, y + 1, z], [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1], texture);
    } else if (direction === "SOUTH") {
      pushQuad(FACE_RIGHT, [x + 1, y + 0.5, z + 1], [x + 1, y + 0.5, z + 0.5], [x + 1, y + 1, z + 1], [x + 1, y + 1, z + 0.5], [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1], texture);
    }
  }
}
