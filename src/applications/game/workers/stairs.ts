import { BLOCK_TEXTURES, BlockType, getDirection } from "@/applications/game/blocks";
import {
  CHUNK_UV_UNITS_PER_BLOCK,
  LIGHT_STEPS_PER_LEVEL,
  POSITION_UNITS_PER_BLOCK,
  packPositionWord,
  packSurfaceWord,
} from "../vertex-format";
import {
  FACE_BACK,
  FACE_DOWN,
  FACE_FRONT,
  FACE_KIND_DOWN,
  FACE_KIND_SIDE,
  FACE_KIND_UP,
  FACE_LEFT,
  FACE_NEIGHBOR_DELTAS,
  FACE_RIGHT,
  FACE_UP,
  FULLY_LIT_AMBIENT_OCCLUSION,
  isFaceCulledMemoized,
} from "./mesh-tables";
import { paddedBlockGrid } from "./padded-grid";
import type { VertexStream } from "./vertex-stream";

type Corner = [number, number, number];

// Stairs are rare, so they are written as explicit quads rather than driven by the face tables.
export function emitStairs(
  target: VertexStream,
  block: BlockType,
  x: number,
  y: number,
  z: number,
  light: number,
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

  const paddedBlocks = paddedBlockGrid.cells;
  const blockAbove = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_UP]];
  const blockBelow = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_DOWN]];
  const blockInfront = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_FRONT]];
  const blockBehind = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_BACK]];
  const blockToTheLeft = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_LEFT]];
  const blockToTheRight = paddedBlocks[paddedBase + FACE_NEIGHBOR_DELTAS[FACE_RIGHT]];

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
        uv[index * 2] * CHUNK_UV_UNITS_PER_BLOCK,
        uv[index * 2 + 1] * CHUNK_UV_UNITS_PER_BLOCK,
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
  if (!isFaceCulledMemoized(block, blockBelow, FACE_KIND_DOWN)) {
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

  if (!isFaceCulledMemoized(block, blockAbove, FACE_KIND_UP)) {
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
  if (!isFaceCulledMemoized(block, blockInfront, FACE_KIND_SIDE)) {
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
  if (!isFaceCulledMemoized(block, blockBehind, FACE_KIND_SIDE)) {
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
  if (!isFaceCulledMemoized(block, blockToTheLeft, FACE_KIND_SIDE)) {
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
  if (!isFaceCulledMemoized(block, blockToTheRight, FACE_KIND_SIDE)) {
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
