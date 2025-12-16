import {
  BLOCK_TEXTURES,
  BlockType,
  TRANSLUCENT_BLOCKS,
  TRANSPARENT_BLOCKS,
  getDirection,
  getWaterLevel,
  isCrop,
  isCrossBlock,
  isFlatQuad,
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

import { getSurfaceHeight } from "./generation";
// @ts-ignore
import FastNoiseLite from "fastnoise-lite";

import { calculateOffset } from "../utils";

export function generateMesh(
  _chunk: ArrayBuffer,
  _lightBuffer: ArrayBuffer,
  borders: {
    top?: ArrayBuffer;
    bottom?: ArrayBuffer;
    left?: ArrayBuffer;
    right?: ArrayBuffer;
    front?: ArrayBuffer;
    back?: ArrayBuffer;
  } = {},
  borderLights: {
    top?: ArrayBuffer;
    bottom?: ArrayBuffer;
    left?: ArrayBuffer;
    right?: ArrayBuffer;
    front?: ArrayBuffer;
    back?: ArrayBuffer;
  } = {},
  seed: number = 0,
  chunkX: number = 0,
  chunkY: number = 0,
  chunkZ: number = 0
): {
  opaque: {
    positions: ArrayBuffer;
    normals: ArrayBuffer;
    indices: ArrayBuffer;
    uvs: ArrayBuffer;
    textureIndices: ArrayBuffer;
    lightLevels: ArrayBuffer;
  };
  transparent: {
    positions: ArrayBuffer;
    normals: ArrayBuffer;
    indices: ArrayBuffer;
    uvs: ArrayBuffer;
    textureIndices: ArrayBuffer;
    lightLevels: ArrayBuffer;
  };
} {
  const opaque = {
    positions: [] as number[],
    normals: [] as number[],
    indices: [] as number[],
    uvs: [] as number[],
    textureIndices: [] as number[],
    lightLevels: [] as number[],
  };

  const transparent = {
    positions: [] as number[],
    normals: [] as number[],
    indices: [] as number[],
    uvs: [] as number[],
    textureIndices: [] as number[],
    lightLevels: [] as number[],
  };

  const chunk = new Uint8Array(_chunk);
  const lightMap = new Uint8Array(_lightBuffer);

  // Convert ArrayBuffer borders to Uint8Array before passing to lighting
  const topBorder = borders.top ? new Uint8Array(borders.top) : undefined;
  const bottomBorder = borders.bottom
    ? new Uint8Array(borders.bottom)
    : undefined;
  const leftBorder = borders.left ? new Uint8Array(borders.left) : undefined;
  const rightBorder = borders.right ? new Uint8Array(borders.right) : undefined;
  const frontBorder = borders.front ? new Uint8Array(borders.front) : undefined;
  const backBorder = borders.back ? new Uint8Array(borders.back) : undefined;

  // Convert ArrayBuffer borderLights to Uint8Array
  const topBorderLight = borderLights.top
    ? new Uint8Array(borderLights.top)
    : undefined;
  const bottomBorderLight = borderLights.bottom
    ? new Uint8Array(borderLights.bottom)
    : undefined;
  const leftBorderLight = borderLights.left
    ? new Uint8Array(borderLights.left)
    : undefined;
  const rightBorderLight = borderLights.right
    ? new Uint8Array(borderLights.right)
    : undefined;
  const frontBorderLight = borderLights.front
    ? new Uint8Array(borderLights.front)
    : undefined;
  const backBorderLight = borderLights.back
    ? new Uint8Array(borderLights.back)
    : undefined;

  const noise = new FastNoiseLite(seed);

  const shouldCull = (
    block: BlockType,
    neighbor: BlockType,
    face: "UP" | "DOWN" | "SIDE"
  ) => {
    if (neighbor === BlockType.AIR) return false;

    // If I am a bottom slab, my top face is never covered by the block above
    if (face === "UP" && isSlab(block) && !isTopSlab(block)) return false;

    // If I am a top slab, my bottom face is never covered by the block below
    if (face === "DOWN" && isTopSlab(block)) return false;

    // If the neighbor below is a bottom slab, it never covers my bottom face
    if (face === "DOWN" && isSlab(neighbor) && !isTopSlab(neighbor))
      return false;

    // If the neighbor above is a top slab, it never covers my top face
    if (face === "UP" && isTopSlab(neighbor)) return false;

    if (!TRANSPARENT_BLOCKS.includes(neighbor)) return true;

    if (isSlab(block) && isSlab(neighbor)) {
      // Slabs only cull each other on the sides if they are the same type (both top or both bottom)
      if (face === "SIDE") {
        return isTopSlab(block) === isTopSlab(neighbor);
      }
    }

    if (isWater(block) && isWater(neighbor)) return true;
    if (block === BlockType.GLASS && neighbor === BlockType.GLASS) return true;

    return false;
  };

  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const block = chunk[calculateOffset(x, y, z)];

        if (block === BlockType.AIR) continue;

        const rawLight = lightMap[calculateOffset(x, y, z)];
        const currentLight = Math.max((rawLight >> 4) & 0xf, rawLight & 0xf);

        const getLight = (lx: number, ly: number, lz: number) => {
          if (lx < 0) {
            if (
              leftBorderLight &&
              ly >= 0 &&
              ly < CHUNK_HEIGHT &&
              lz >= 0 &&
              lz < CHUNK_LENGTH
            ) {
              const val = leftBorderLight[ly * CHUNK_LENGTH + lz];
              return Math.max((val >> 4) & 0xf, val & 0xf);
            }
          } else if (lx >= CHUNK_WIDTH) {
            if (
              rightBorderLight &&
              ly >= 0 &&
              ly < CHUNK_HEIGHT &&
              lz >= 0 &&
              lz < CHUNK_LENGTH
            ) {
              const val = rightBorderLight[ly * CHUNK_LENGTH + lz];
              return Math.max((val >> 4) & 0xf, val & 0xf);
            }
          } else if (ly < 0) {
            if (
              bottomBorderLight &&
              lx >= 0 &&
              lx < CHUNK_WIDTH &&
              lz >= 0 &&
              lz < CHUNK_LENGTH
            ) {
              const val = bottomBorderLight[lx * CHUNK_LENGTH + lz];
              return Math.max((val >> 4) & 0xf, val & 0xf);
            }
          } else if (ly >= CHUNK_HEIGHT) {
            if (
              topBorderLight &&
              lx >= 0 &&
              lx < CHUNK_WIDTH &&
              lz >= 0 &&
              lz < CHUNK_LENGTH
            ) {
              const val = topBorderLight[lx * CHUNK_LENGTH + lz];
              return Math.max((val >> 4) & 0xf, val & 0xf);
            }
          } else if (lz < 0) {
            if (
              backBorderLight &&
              lx >= 0 &&
              lx < CHUNK_WIDTH &&
              ly >= 0 &&
              ly < CHUNK_HEIGHT
            ) {
              const val = backBorderLight[lx * CHUNK_HEIGHT + ly];
              return Math.max((val >> 4) & 0xf, val & 0xf);
            }
          } else if (lz >= CHUNK_LENGTH) {
            if (
              frontBorderLight &&
              lx >= 0 &&
              lx < CHUNK_WIDTH &&
              ly >= 0 &&
              ly < CHUNK_HEIGHT
            ) {
              const val = frontBorderLight[lx * CHUNK_HEIGHT + ly];
              return Math.max((val >> 4) & 0xf, val & 0xf);
            }
          } else if (
            lx >= 0 &&
            lx < CHUNK_WIDTH &&
            ly >= 0 &&
            ly < CHUNK_HEIGHT &&
            lz >= 0 &&
            lz < CHUNK_LENGTH
          ) {
            const val = lightMap[calculateOffset(lx, ly, lz)];
            return Math.max((val >> 4) & 0xf, val & 0xf);
          }

          const nWorldX = chunkX * CHUNK_WIDTH + lx;
          const nWorldY = chunkY * CHUNK_HEIGHT + ly;
          const nWorldZ = chunkZ * CHUNK_LENGTH + lz;

          const sY = getSurfaceHeight(noise, nWorldX, nWorldZ);
          const heuristic = nWorldY > sY ? 15 : 0;
          return Math.max(heuristic, currentLight - 1);
        };

        const isTranslucent = TRANSLUCENT_BLOCKS.includes(block);
        const target = isTranslucent ? transparent : opaque;

        const isLeftEdge = x === 0;
        const isRightEdge = x === CHUNK_WIDTH - 1;
        const isBottomEdge = y === 0;
        const isTopEdge = y === CHUNK_HEIGHT - 1;
        const isBackEdge = z === 0;
        const isFrontEdge = z === CHUNK_LENGTH - 1;

        let blockAbove;
        if (!isTopEdge) {
          blockAbove = chunk[calculateOffset(x, y + 1, z)];
        } else if (topBorder) {
          // Top border corresponds to y=0 of the chunk above.
          // The border array is flattened: x * CHUNK_LENGTH + z
          blockAbove = topBorder[x * CHUNK_LENGTH + z];
        } else {
          blockAbove = BlockType.AIR;
        }

        let blockBelow;
        if (!isBottomEdge) {
          blockBelow = chunk[calculateOffset(x, y - 1, z)];
        } else if (bottomBorder) {
          // Bottom border corresponds to y=MAX of the chunk below.
          blockBelow = bottomBorder[x * CHUNK_LENGTH + z];
        } else {
          blockBelow = BlockType.AIR;
        }

        let blockBehind;
        if (!isBackEdge) {
          blockBehind = chunk[calculateOffset(x, y, z - 1)];
        } else if (backBorder) {
          // Back border corresponds to z=MAX of the chunk behind.
          // Flattened: x * CHUNK_HEIGHT + y
          blockBehind = backBorder[x * CHUNK_HEIGHT + y];
        } else {
          blockBehind = BlockType.AIR;
        }

        let blockInfront;
        if (!isFrontEdge) {
          blockInfront = chunk[calculateOffset(x, y, z + 1)];
        } else if (frontBorder) {
          // Front border corresponds to z=0 of the chunk in front.
          blockInfront = frontBorder[x * CHUNK_HEIGHT + y];
        } else {
          blockInfront = BlockType.AIR;
        }

        let blockToTheLeft;
        if (!isLeftEdge) {
          blockToTheLeft = chunk[calculateOffset(x - 1, y, z)];
        } else if (leftBorder) {
          // Left border corresponds to x=MAX of the chunk to the left.
          // Flattened: y * CHUNK_LENGTH + z
          // Wait, left border is a slice of the chunk.
          // If we extracted it as a subarray, it keeps the original structure?
          // No, we will extract it into a dense array.
          // Let's assume we extract it as y * CHUNK_LENGTH + z
          blockToTheLeft = leftBorder[y * CHUNK_LENGTH + z];
        } else {
          blockToTheLeft = BlockType.AIR;
        }

        let blockToTheRight;
        if (!isRightEdge) {
          blockToTheRight = chunk[calculateOffset(x + 1, y, z)];
        } else if (rightBorder) {
          // Right border corresponds to x=0 of the chunk to the right.
          blockToTheRight = rightBorder[y * CHUNK_LENGTH + z];
        } else {
          blockToTheRight = BlockType.AIR;
        }

        const textureIndexDefault = BLOCK_TEXTURES[block].DEFAULT ?? 0;
        const textureIndexSides = BLOCK_TEXTURES[block].SIDES;

        const textureIndexFront = BLOCK_TEXTURES[block].FRONT_FACE;
        const textureIndexBack = BLOCK_TEXTURES[block].BACK_FACE;
        const textureIndexTop = BLOCK_TEXTURES[block].TOP_FACE;
        const textureIndexBottom = BLOCK_TEXTURES[block].BOTTOM_FACE;
        const textureIndexLeft = BLOCK_TEXTURES[block].LEFT_FACE;
        const textureIndexRight = BLOCK_TEXTURES[block].RIGHT_FACE;

        if (isCrossBlock(block)) {
          const index = transparent.positions.length / 3;

          const height = block === BlockType.TALL_GRASS ? 0.9 : 1;

          // Diagonal 1
          transparent.positions.push(
            x,
            y,
            z,
            x + 1,
            y,
            z + 1,
            x,
            y + height,
            z,
            x + 1,
            y + height,
            z + 1
          );
          transparent.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          transparent.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          transparent.textureIndices.push(
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault
          );
          transparent.lightLevels.push(
            currentLight,
            currentLight,
            currentLight,
            currentLight
          );

          transparent.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3,
            index,
            index + 2,
            index + 1,
            index + 2,
            index + 3,
            index + 1
          );

          const index2 = transparent.positions.length / 3;

          // Diagonal 2
          transparent.positions.push(
            x,
            y,
            z + 1,
            x + 1,
            y,
            z,
            x,
            y + height,
            z + 1,
            x + 1,
            y + height,
            z
          );
          transparent.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          transparent.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          transparent.textureIndices.push(
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault
          );
          transparent.lightLevels.push(
            currentLight,
            currentLight,
            currentLight,
            currentLight
          );

          transparent.indices.push(
            index2,
            index2 + 1,
            index2 + 2,
            index2 + 2,
            index2 + 1,
            index2 + 3,
            index2,
            index2 + 2,
            index2 + 1,
            index2 + 2,
            index2 + 3,
            index2 + 1
          );

          continue;
        }

        if (isFlatQuad(block)) {
          const index = transparent.positions.length / 3;
          const yOffset = 0.1;

          transparent.positions.push(
            x,
            y + yOffset,
            z + 1,
            x + 1,
            y + yOffset,
            z + 1,
            x,
            y + yOffset,
            z,
            x + 1,
            y + yOffset,
            z
          );
          transparent.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          transparent.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          transparent.textureIndices.push(
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault
          );
          transparent.lightLevels.push(
            currentLight,
            currentLight,
            currentLight,
            currentLight
          );

          transparent.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3,
            index,
            index + 2,
            index + 1,
            index + 2,
            index + 3,
            index + 1
          );

          continue;
        }

        if (isCrop(block)) {
          const margin = 0.3;
          const min = margin;
          const max = 1 - margin;
          const height = 1; // Full height? Or maybe slightly less? Let's stick to 1 for now.

          // 4 Quads forming a square box
          // Front (z = max)
          let index = transparent.positions.length / 3;
          transparent.positions.push(
            x,
            y,
            z + max,
            x + 1,
            y,
            z + max,
            x,
            y + height,
            z + max,
            x + 1,
            y + height,
            z + max
          );
          transparent.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
          transparent.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          transparent.textureIndices.push(
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault
          );
          transparent.lightLevels.push(
            currentLight,
            currentLight,
            currentLight,
            currentLight
          );
          transparent.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3,
            index,
            index + 2,
            index + 1,
            index + 2,
            index + 3,
            index + 1
          );

          // Back (z = min)
          index = transparent.positions.length / 3;
          transparent.positions.push(
            x + 1,
            y,
            z + min,
            x,
            y,
            z + min,
            x + 1,
            y + height,
            z + min,
            x,
            y + height,
            z + min
          );
          transparent.normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
          transparent.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          transparent.textureIndices.push(
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault
          );
          transparent.lightLevels.push(
            currentLight,
            currentLight,
            currentLight,
            currentLight
          );
          transparent.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3,
            index,
            index + 2,
            index + 1,
            index + 2,
            index + 3,
            index + 1
          );

          // Left (x = min)
          index = transparent.positions.length / 3;
          transparent.positions.push(
            x + min,
            y,
            z,
            x + min,
            y,
            z + 1,
            x + min,
            y + height,
            z,
            x + min,
            y + height,
            z + 1
          );
          transparent.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
          transparent.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          transparent.textureIndices.push(
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault
          );
          transparent.lightLevels.push(
            currentLight,
            currentLight,
            currentLight,
            currentLight
          );
          transparent.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3,
            index,
            index + 2,
            index + 1,
            index + 2,
            index + 3,
            index + 1
          );

          // Right (x = max)
          index = transparent.positions.length / 3;
          transparent.positions.push(
            x + max,
            y,
            z + 1,
            x + max,
            y,
            z,
            x + max,
            y + height,
            z + 1,
            x + max,
            y + height,
            z
          );
          transparent.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
          transparent.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          transparent.textureIndices.push(
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault,
            textureIndexDefault
          );
          transparent.lightLevels.push(
            currentLight,
            currentLight,
            currentLight,
            currentLight
          );
          transparent.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3,
            index,
            index + 2,
            index + 1,
            index + 2,
            index + 3,
            index + 1
          );

          continue;
        }

        if (isStairs(block)) {
          const direction = getDirection(block);

          const pushQuad = (
            p1: number[],
            p2: number[],
            p3: number[],
            p4: number[],
            n: number[],
            uv: number[],
            tex: number
          ) => {
            const index = target.positions.length / 3;
            target.positions.push(...p1, ...p2, ...p3, ...p4);
            target.normals.push(...n, ...n, ...n, ...n);
            target.uvs.push(...uv);
            target.textureIndices.push(tex, tex, tex, tex);
            target.lightLevels.push(
              currentLight,
              currentLight,
              currentLight,
              currentLight
            );
            target.indices.push(
              index,
              index + 1,
              index + 2,
              index + 2,
              index + 1,
              index + 3
            );
          };

          // Bottom Face (y=0)
          if (!shouldCull(block, blockBelow, "DOWN")) {
            // Normal (0, -1, 0). Winding: p1(TR), p2(TL), p3(BR), p4(BL) relative to bottom view?
            // Standard cube bottom: (x+1, z+1), (x, z+1), (x+1, z), (x, z)
            // p1(1,1), p2(0,1), p3(1,0), p4(0,0)
            // Tri 1: p1, p2, p3 -> (1,1), (0,1), (1,0). (v2-v1)=(-1,0), (v3-v1)=(0,-1). Cross = (0,0,1).
            // Wait, standard cube bottom normal is (0, -1, 0).
            // Let's copy standard cube bottom winding exactly.
            // Standard: p1(x+1, z+1), p2(x, z+1), p3(x+1, z), p4(x, z)
            pushQuad(
              [x + 1, y, z + 1],
              [x, y, z + 1],
              [x + 1, y, z],
              [x, y, z],
              [0, -1, 0],
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

          // Normal (0, 1, 0). Standard cube top: (x, z+1), (x+1, z+1), (x, z), (x+1, z)
          // p1(0,1), p2(1,1), p3(0,0), p4(1,0)
          pushQuad(
            [x + exposedMinX, y + 0.5, z + exposedMaxZ],
            [x + exposedMaxX, y + 0.5, z + exposedMaxZ],
            [x + exposedMinX, y + 0.5, z + exposedMinZ],
            [x + exposedMaxX, y + 0.5, z + exposedMinZ],
            [0, 1, 0],
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

          if (!shouldCull(block, blockAbove, "UP")) {
            pushQuad(
              [x + topMinX, y + 1, z + topMaxZ],
              [x + topMaxX, y + 1, z + topMaxZ],
              [x + topMinX, y + 1, z + topMinZ],
              [x + topMaxX, y + 1, z + topMinZ],
              [0, 1, 0],
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
          if (direction === "NORTH") {
            // Face at Z=0.5, facing South (+Z). Normal (0, 0, 1).
            // Standard Front: (x, z+1), (x+1, z+1), (x, z+1), (x+1, z+1) ... wait standard front uses y.
            // Standard Front: p1(0,0), p2(1,0), p3(0,1), p4(1,1) -> (x, yl, z+1), (x+1, yl, z+1), (x, yh, z+1), (x+1, yh, z+1)
            // Tri 1: p1, p2, p3 -> (0,0), (1,0), (0,1). (1,0)x(0,1) = (0,0,1). Correct.
            // So p1=BL, p2=BR, p3=TL, p4=TR.
            pushQuad(
              [x, y + 0.5, z + 0.5],
              [x + 1, y + 0.5, z + 0.5],
              [x, y + 1, z + 0.5],
              [x + 1, y + 1, z + 0.5],
              [0, 0, 1],
              [1, 0.5, 0, 0.5, 1, 1, 0, 1], // UVs need to be checked. 0.5 to 1 in V?
              textureIndexSides ?? textureIndexDefault
            );
          } else if (direction === "SOUTH") {
            // Face at Z=0.5, facing North (-Z). Normal (0, 0, -1).
            // Standard Back: p1(x+1, yl, z), p2(x, yl, z), p3(x+1, yh, z), p4(x, yh, z)
            // p1(1,0), p2(0,0), p3(1,1). (-1,0)x(0,1) = (0,0,-1). Correct.
            pushQuad(
              [x + 1, y + 0.5, z + 0.5],
              [x, y + 0.5, z + 0.5],
              [x + 1, y + 1, z + 0.5],
              [x, y + 1, z + 0.5],
              [0, 0, -1],
              [1, 0.5, 0, 0.5, 1, 1, 0, 1],
              textureIndexSides ?? textureIndexDefault
            );
          } else if (direction === "EAST") {
            // Face at X=0.5, facing West (-X). Normal (-1, 0, 0).
            // Standard Left: p1(x, yl, z), p2(x, yl, z+1), p3(x, yh, z), p4(x, yh, z+1)
            // p1(0,0,0), p2(0,0,1), p3(0,1,0). (0,0,1)x(0,1,0) = (-1,0,0). Correct.
            pushQuad(
              [x + 0.5, y + 0.5, z],
              [x + 0.5, y + 0.5, z + 1],
              [x + 0.5, y + 1, z],
              [x + 0.5, y + 1, z + 1],
              [-1, 0, 0],
              [1, 0.5, 0, 0.5, 1, 1, 0, 1],
              textureIndexSides ?? textureIndexDefault
            );
          } else if (direction === "WEST") {
            // Face at X=0.5, facing East (+X). Normal (1, 0, 0).
            // Standard Right: p1(x+1, yl, z+1), p2(x+1, yl, z), p3(x+1, yh, z+1), p4(x+1, yh, z)
            // p1(1,0,1), p2(1,0,0), p3(1,1,1). (0,0,-1)x(0,1,0) = (1,0,0). Correct.
            pushQuad(
              [x + 0.5, y + 0.5, z + 1],
              [x + 0.5, y + 0.5, z],
              [x + 0.5, y + 1, z + 1],
              [x + 0.5, y + 1, z],
              [1, 0, 0],
              [1, 0.5, 0, 0.5, 1, 1, 0, 1],
              textureIndexSides ?? textureIndexDefault
            );
          }

          // Front (z=1)
          if (!shouldCull(block, blockInfront, "SIDE")) {
            // Standard Front: p1(BL), p2(BR), p3(TL), p4(TR)
            // Bottom half (y=0..0.5)
            pushQuad(
              [x, y, z + 1],
              [x + 1, y, z + 1],
              [x, y + 0.5, z + 1],
              [x + 1, y + 0.5, z + 1],
              [0, 0, 1],
              [1, 0, 0, 0, 1, 0.5, 0, 0.5],
              textureIndexFront ?? textureIndexSides ?? textureIndexDefault
            );

            // Top half (y=0.5..1)
            if (direction === "SOUTH") {
              // Full face
              pushQuad(
                [x, y + 0.5, z + 1],
                [x + 1, y + 0.5, z + 1],
                [x, y + 1, z + 1],
                [x + 1, y + 1, z + 1],
                [0, 0, 1],
                [1, 0.5, 0, 0.5, 1, 1, 0, 1],
                textureIndexFront ?? textureIndexSides ?? textureIndexDefault
              );
            } else if (direction === "EAST") {
              // Right half (x=0.5..1)
              pushQuad(
                [x + 0.5, y + 0.5, z + 1],
                [x + 1, y + 0.5, z + 1],
                [x + 0.5, y + 1, z + 1],
                [x + 1, y + 1, z + 1],
                [0, 0, 1],
                [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1],
                textureIndexFront ?? textureIndexSides ?? textureIndexDefault
              );
            } else if (direction === "WEST") {
              // Left half (x=0..0.5)
              pushQuad(
                [x, y + 0.5, z + 1],
                [x + 0.5, y + 0.5, z + 1],
                [x, y + 1, z + 1],
                [x + 0.5, y + 1, z + 1],
                [0, 0, 1],
                [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1],
                textureIndexFront ?? textureIndexSides ?? textureIndexDefault
              );
            }
          }

          // Back (z=0)
          if (!shouldCull(block, blockBehind, "SIDE")) {
            // Standard Back: p1(BR), p2(BL), p3(TR), p4(TL) (looking from back)
            // p1(x+1, yl, z), p2(x, yl, z), p3(x+1, yh, z), p4(x, yh, z)

            // Bottom half
            pushQuad(
              [x + 1, y, z],
              [x, y, z],
              [x + 1, y + 0.5, z],
              [x, y + 0.5, z],
              [0, 0, -1],
              [1, 0, 0, 0, 1, 0.5, 0, 0.5],
              textureIndexBack ?? textureIndexSides ?? textureIndexDefault
            );

            // Top half
            if (direction === "NORTH") {
              // Full face
              pushQuad(
                [x + 1, y + 0.5, z],
                [x, y + 0.5, z],
                [x + 1, y + 1, z],
                [x, y + 1, z],
                [0, 0, -1],
                [1, 0.5, 0, 0.5, 1, 1, 0, 1],
                textureIndexBack ?? textureIndexSides ?? textureIndexDefault
              );
            } else if (direction === "EAST") {
              // Right half (x=0.5..1) (Looking from back, x is inverted? No, x is world x)
              // Back face is at z=0. x goes 0->1.
              // EAST top step is at x=0.5..1.
              pushQuad(
                [x + 1, y + 0.5, z],
                [x + 0.5, y + 0.5, z],
                [x + 1, y + 1, z],
                [x + 0.5, y + 1, z],
                [0, 0, -1],
                [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1],
                textureIndexBack ?? textureIndexSides ?? textureIndexDefault
              );
            } else if (direction === "WEST") {
              // Left half (x=0..0.5)
              pushQuad(
                [x + 0.5, y + 0.5, z],
                [x, y + 0.5, z],
                [x + 0.5, y + 1, z],
                [x, y + 1, z],
                [0, 0, -1],
                [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1],
                textureIndexBack ?? textureIndexSides ?? textureIndexDefault
              );
            }
          }

          // Left (x=0)
          if (!shouldCull(block, blockToTheLeft, "SIDE")) {
            // Standard Left: p1(x, yl, z), p2(x, yl, z+1), p3(x, yh, z), p4(x, yh, z+1)

            // Bottom half
            pushQuad(
              [x, y, z],
              [x, y, z + 1],
              [x, y + 0.5, z],
              [x, y + 0.5, z + 1],
              [-1, 0, 0],
              [1, 0, 0, 0, 1, 0.5, 0, 0.5],
              textureIndexLeft ?? textureIndexSides ?? textureIndexDefault
            );

            // Top half
            if (direction === "WEST") {
              // Full face
              pushQuad(
                [x, y + 0.5, z],
                [x, y + 0.5, z + 1],
                [x, y + 1, z],
                [x, y + 1, z + 1],
                [-1, 0, 0],
                [1, 0.5, 0, 0.5, 1, 1, 0, 1],
                textureIndexLeft ?? textureIndexSides ?? textureIndexDefault
              );
            } else if (direction === "NORTH") {
              // Back half (z=0..0.5)
              pushQuad(
                [x, y + 0.5, z],
                [x, y + 0.5, z + 0.5],
                [x, y + 1, z],
                [x, y + 1, z + 0.5],
                [-1, 0, 0],
                [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1],
                textureIndexLeft ?? textureIndexSides ?? textureIndexDefault
              );
            } else if (direction === "SOUTH") {
              // Front half (z=0.5..1)
              pushQuad(
                [x, y + 0.5, z + 0.5],
                [x, y + 0.5, z + 1],
                [x, y + 1, z + 0.5],
                [x, y + 1, z + 1],
                [-1, 0, 0],
                [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1],
                textureIndexLeft ?? textureIndexSides ?? textureIndexDefault
              );
            }
          }

          // Right (x=1)
          if (!shouldCull(block, blockToTheRight, "SIDE")) {
            // Standard Right: p1(x+1, yl, z+1), p2(x+1, yl, z), p3(x+1, yh, z+1), p4(x+1, yh, z)

            // Bottom half
            pushQuad(
              [x + 1, y, z + 1],
              [x + 1, y, z],
              [x + 1, y + 0.5, z + 1],
              [x + 1, y + 0.5, z],
              [1, 0, 0],
              [1, 0, 0, 0, 1, 0.5, 0, 0.5],
              textureIndexRight ?? textureIndexSides ?? textureIndexDefault
            );

            // Top half
            if (direction === "EAST") {
              // Full face
              pushQuad(
                [x + 1, y + 0.5, z + 1],
                [x + 1, y + 0.5, z],
                [x + 1, y + 1, z + 1],
                [x + 1, y + 1, z],
                [1, 0, 0],
                [1, 0.5, 0, 0.5, 1, 1, 0, 1],
                textureIndexRight ?? textureIndexSides ?? textureIndexDefault
              );
            } else if (direction === "NORTH") {
              // Back half (z=0..0.5)
              pushQuad(
                [x + 1, y + 0.5, z + 0.5],
                [x + 1, y + 0.5, z],
                [x + 1, y + 1, z + 0.5],
                [x + 1, y + 1, z],
                [1, 0, 0],
                [0.5, 0.5, 0, 0.5, 0.5, 1, 0, 1],
                textureIndexRight ?? textureIndexSides ?? textureIndexDefault
              );
            } else if (direction === "SOUTH") {
              // Front half (z=0.5..1)
              pushQuad(
                [x + 1, y + 0.5, z + 1],
                [x + 1, y + 0.5, z + 0.5],
                [x + 1, y + 1, z + 1],
                [x + 1, y + 1, z + 0.5],
                [1, 0, 0],
                [1, 0.5, 0.5, 0.5, 1, 1, 0.5, 1],
                textureIndexRight ?? textureIndexSides ?? textureIndexDefault
              );
            }
          }

          continue;
        }

        const blockHeight = isSlab(block)
          ? 0.5
          : isWater(block) && !isWater(blockAbove)
          ? getWaterLevel(block) / 9
          : 1;

        const yOffset = isTopSlab(block) ? 0.5 : 0;
        const yh = y + blockHeight + yOffset;
        const yl = y + yOffset;

        let vRowTop = 0;
        let vRowBottom = 1;

        if (isSlab(block)) {
          if (isTopSlab(block)) {
            vRowBottom = 0.5;
          } else {
            vRowTop = 0.5;
          }
        }

        if (!shouldCull(block, blockAbove, "UP")) {
          const index = target.positions.length / 3;
          target.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          target.positions.push(
            x,
            yh,
            1 + z,
            1 + x,
            yh,
            1 + z,
            x,
            yh,
            z,
            1 + x,
            yh,
            z
          );
          target.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          target.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          if (textureIndexTop) {
            target.textureIndices.push(
              textureIndexTop,
              textureIndexTop,
              textureIndexTop,
              textureIndexTop
            );
          } else {
            target.textureIndices.push(
              textureIndexDefault,
              textureIndexDefault,
              textureIndexDefault,
              textureIndexDefault
            );
          }
          const l = getLight(x, y + 1, z);
          target.lightLevels.push(l, l, l, l);
        }
        if (!shouldCull(block, blockBelow, "DOWN")) {
          const index = target.positions.length / 3;
          target.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          target.positions.push(
            x + 1,
            yl,
            z + 1,
            x,
            yl,
            z + 1,
            x + 1,
            yl,
            z,
            x,
            yl,
            z
          );
          target.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);
          target.uvs.push(1, 0, 0, 0, 1, 1, 0, 1);
          if (textureIndexBottom) {
            target.textureIndices.push(
              textureIndexBottom,
              textureIndexBottom,
              textureIndexBottom,
              textureIndexBottom
            );
          } else {
            target.textureIndices.push(
              textureIndexDefault,
              textureIndexDefault,
              textureIndexDefault,
              textureIndexDefault
            );
          }
          const l = getLight(x, y - 1, z);
          target.lightLevels.push(l, l, l, l);
        }

        if (!shouldCull(block, blockInfront, "SIDE")) {
          const index = target.positions.length / 3;
          target.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          target.positions.push(
            x,
            yl,
            1 + z,
            1 + x,
            yl,
            1 + z,
            x,
            yh,
            1 + z,
            1 + x,
            yh,
            1 + z
          );
          target.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
          target.uvs.push(1, vRowBottom, 0, vRowBottom, 1, vRowTop, 0, vRowTop);
          if (textureIndexFront) {
            target.textureIndices.push(
              textureIndexFront,
              textureIndexFront,
              textureIndexFront,
              textureIndexFront
            );
          } else {
            if (textureIndexSides) {
              target.textureIndices.push(
                textureIndexSides,
                textureIndexSides,
                textureIndexSides,
                textureIndexSides
              );
            } else {
              target.textureIndices.push(
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault
              );
            }
          }
          const l = getLight(x, y, z + 1);
          target.lightLevels.push(l, l, l, l);
        }

        if (!shouldCull(block, blockBehind, "SIDE")) {
          const index = target.positions.length / 3;
          target.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          target.positions.push(1 + x, yl, z, x, yl, z, 1 + x, yh, z, x, yh, z);
          target.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
          target.uvs.push(1, vRowBottom, 0, vRowBottom, 1, vRowTop, 0, vRowTop);
          if (textureIndexBack) {
            target.textureIndices.push(
              textureIndexBack,
              textureIndexBack,
              textureIndexBack,
              textureIndexBack
            );
          } else {
            if (textureIndexSides) {
              target.textureIndices.push(
                textureIndexSides,
                textureIndexSides,
                textureIndexSides,
                textureIndexSides
              );
            } else {
              target.textureIndices.push(
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault
              );
            }
          }
          const l = getLight(x, y, z - 1);
          target.lightLevels.push(l, l, l, l);
        }

        if (!shouldCull(block, blockToTheLeft, "SIDE")) {
          const index = target.positions.length / 3;
          target.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          target.positions.push(x, yh, z, x, yl, z, x, yh, 1 + z, x, yl, 1 + z);
          target.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
          target.uvs.push(0, vRowTop, 0, vRowBottom, 1, vRowTop, 1, vRowBottom);
          if (textureIndexLeft) {
            target.textureIndices.push(
              textureIndexLeft,
              textureIndexLeft,
              textureIndexLeft,
              textureIndexLeft
            );
          } else {
            if (textureIndexSides) {
              target.textureIndices.push(
                textureIndexSides,
                textureIndexSides,
                textureIndexSides,
                textureIndexSides
              );
            } else {
              target.textureIndices.push(
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault
              );
            }
          }
          const l = getLight(x - 1, y, z);
          target.lightLevels.push(l, l, l, l);
        }

        if (!shouldCull(block, blockToTheRight, "SIDE")) {
          const index = target.positions.length / 3;
          target.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          target.positions.push(
            1 + x,
            yh,
            1 + z,
            1 + x,
            yl,
            1 + z,
            1 + x,
            yh,
            z,
            1 + x,
            yl,
            z
          );
          target.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
          target.uvs.push(0, vRowTop, 0, vRowBottom, 1, vRowTop, 1, vRowBottom);
          if (textureIndexRight) {
            target.textureIndices.push(
              textureIndexRight,
              textureIndexRight,
              textureIndexRight,
              textureIndexRight
            );
          } else {
            if (textureIndexSides) {
              target.textureIndices.push(
                textureIndexSides,
                textureIndexSides,
                textureIndexSides,
                textureIndexSides
              );
            } else {
              target.textureIndices.push(
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault
              );
            }
          }
          const l = getLight(x + 1, y, z);
          target.lightLevels.push(l, l, l, l);
        }
      }
    }
  }

  return {
    opaque: {
      positions: new Float32Array(opaque.positions).buffer,
      normals: new Float32Array(opaque.normals).buffer,
      indices: new Uint32Array(opaque.indices).buffer,
      uvs: new Float32Array(opaque.uvs).buffer,
      textureIndices: new Int32Array(opaque.textureIndices).buffer,
      lightLevels: new Float32Array(opaque.lightLevels).buffer,
    },
    transparent: {
      positions: new Float32Array(transparent.positions).buffer,
      normals: new Float32Array(transparent.normals).buffer,
      indices: new Uint32Array(transparent.indices).buffer,
      uvs: new Float32Array(transparent.uvs).buffer,
      textureIndices: new Int32Array(transparent.textureIndices).buffer,
      lightLevels: new Float32Array(transparent.lightLevels).buffer,
    },
  };
}
