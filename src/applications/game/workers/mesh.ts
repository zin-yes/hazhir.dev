import {
  BLOCK_TEXTURES,
  BlockType,
  TRANSLUCENT_BLOCKS,
  TRANSPARENT_BLOCKS,
  getWaterLevel,
  isCrop,
  isCrossBlock,
  isFlatQuad,
  isSlab,
  isTopSlab,
  isWater,
} from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";

import { calculateOffset } from "../utils";

export function generateMesh(
  _chunk: ArrayBuffer,
  borders: {
    top?: ArrayBuffer;
    bottom?: ArrayBuffer;
    left?: ArrayBuffer;
    right?: ArrayBuffer;
    front?: ArrayBuffer;
    back?: ArrayBuffer;
  } = {}
): {
  opaque: {
    positions: ArrayBuffer;
    normals: ArrayBuffer;
    indices: ArrayBuffer;
    uvs: ArrayBuffer;
    textureIndices: ArrayBuffer;
  };
  transparent: {
    positions: ArrayBuffer;
    normals: ArrayBuffer;
    indices: ArrayBuffer;
    uvs: ArrayBuffer;
    textureIndices: ArrayBuffer;
  };
} {
  const opaque = {
    positions: [] as number[],
    normals: [] as number[],
    indices: [] as number[],
    uvs: [] as number[],
    textureIndices: [] as number[],
  };

  const transparent = {
    positions: [] as number[],
    normals: [] as number[],
    indices: [] as number[],
    uvs: [] as number[],
    textureIndices: [] as number[],
  };

  const chunk = new Uint8Array(_chunk);

  const topBorder = borders.top ? new Uint8Array(borders.top) : null;
  const bottomBorder = borders.bottom ? new Uint8Array(borders.bottom) : null;
  const leftBorder = borders.left ? new Uint8Array(borders.left) : null;
  const rightBorder = borders.right ? new Uint8Array(borders.right) : null;
  const frontBorder = borders.front ? new Uint8Array(borders.front) : null;
  const backBorder = borders.back ? new Uint8Array(borders.back) : null;

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
    },
    transparent: {
      positions: new Float32Array(transparent.positions).buffer,
      normals: new Float32Array(transparent.normals).buffer,
      indices: new Uint32Array(transparent.indices).buffer,
      uvs: new Float32Array(transparent.uvs).buffer,
      textureIndices: new Int32Array(transparent.textureIndices).buffer,
    },
  };
}
