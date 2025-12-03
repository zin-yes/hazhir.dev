import {
  BLOCK_TEXTURES,
  BlockType,
  TRANSPARENT_BLOCKS,
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
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  indices: ArrayBuffer;
  uvs: ArrayBuffer;
  textureIndices: ArrayBuffer;
} {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const textureIndices: number[] = [];

  const chunk = new Uint8Array(_chunk);

  const topBorder = borders.top ? new Uint8Array(borders.top) : null;
  const bottomBorder = borders.bottom ? new Uint8Array(borders.bottom) : null;
  const leftBorder = borders.left ? new Uint8Array(borders.left) : null;
  const rightBorder = borders.right ? new Uint8Array(borders.right) : null;
  const frontBorder = borders.front ? new Uint8Array(borders.front) : null;
  const backBorder = borders.back ? new Uint8Array(borders.back) : null;

  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const block = chunk[calculateOffset(x, y, z)];

        if (block === BlockType.AIR) continue;

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

        if (
          TRANSPARENT_BLOCKS.includes(blockAbove) &&
          !(block === BlockType.WATER && blockAbove === BlockType.WATER)
        ) {
          const index = positions.length / 3;
          indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          positions.push(
            x,
            1 + y,
            1 + z,
            1 + x,
            1 + y,
            1 + z,
            x,
            1 + y,
            z,
            1 + x,
            1 + y,
            z
          );
          normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          if (textureIndexTop) {
            textureIndices.push(
              textureIndexTop,
              textureIndexTop,
              textureIndexTop,
              textureIndexTop
            );
          } else {
            textureIndices.push(
              textureIndexDefault,
              textureIndexDefault,
              textureIndexDefault,
              textureIndexDefault
            );
          }
        }
        if (
          TRANSPARENT_BLOCKS.includes(blockBelow) &&
          !(block === BlockType.WATER && blockBelow === BlockType.WATER)
        ) {
          const index = positions.length / 3;
          indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          positions.push(x + 1, y, z + 1, x, y, z + 1, x + 1, y, z, x, y, z);
          normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);
          uvs.push(1, 0, 0, 0, 1, 1, 0, 1);
          if (textureIndexBottom) {
            textureIndices.push(
              textureIndexBottom,
              textureIndexBottom,
              textureIndexBottom,
              textureIndexBottom
            );
          } else {
            textureIndices.push(
              textureIndexDefault,
              textureIndexDefault,
              textureIndexDefault,
              textureIndexDefault
            );
          }
        }

        if (
          TRANSPARENT_BLOCKS.includes(blockInfront) &&
          !(block === BlockType.WATER && blockInfront === BlockType.WATER)
        ) {
          const index = positions.length / 3;
          indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          positions.push(
            x,
            y,
            1 + z,
            1 + x,
            y,
            1 + z,
            x,
            1 + y,
            1 + z,
            1 + x,
            1 + y,
            1 + z
          );
          normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
          uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          if (textureIndexFront) {
            textureIndices.push(
              textureIndexFront,
              textureIndexFront,
              textureIndexFront,
              textureIndexFront
            );
          } else {
            if (textureIndexSides) {
              textureIndices.push(
                textureIndexSides,
                textureIndexSides,
                textureIndexSides,
                textureIndexSides
              );
            } else {
              textureIndices.push(
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault
              );
            }
          }
        }

        if (
          TRANSPARENT_BLOCKS.includes(blockBehind) &&
          !(block === BlockType.WATER && blockBehind === BlockType.WATER)
        ) {
          const index = positions.length / 3;
          indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          positions.push(1 + x, y, z, x, y, z, 1 + x, 1 + y, z, x, 1 + y, z);
          normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
          uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
          if (textureIndexBack) {
            textureIndices.push(
              textureIndexBack,
              textureIndexBack,
              textureIndexBack,
              textureIndexBack
            );
          } else {
            if (textureIndexSides) {
              textureIndices.push(
                textureIndexSides,
                textureIndexSides,
                textureIndexSides,
                textureIndexSides
              );
            } else {
              textureIndices.push(
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault
              );
            }
          }
        }

        if (
          TRANSPARENT_BLOCKS.includes(blockToTheLeft) &&
          !(block === BlockType.WATER && blockToTheLeft === BlockType.WATER)
        ) {
          const index = positions.length / 3;
          indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          positions.push(x, 1 + y, z, x, y, z, x, 1 + y, 1 + z, x, y, 1 + z);
          normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
          uvs.push(0, 0, 0, 1, 1, 0, 1, 1);
          if (textureIndexLeft) {
            textureIndices.push(
              textureIndexLeft,
              textureIndexLeft,
              textureIndexLeft,
              textureIndexLeft
            );
          } else {
            if (textureIndexSides) {
              textureIndices.push(
                textureIndexSides,
                textureIndexSides,
                textureIndexSides,
                textureIndexSides
              );
            } else {
              textureIndices.push(
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault,
                textureIndexDefault
              );
            }
          }
        }

        if (
          TRANSPARENT_BLOCKS.includes(blockToTheRight) &&
          !(block === BlockType.WATER && blockToTheRight === BlockType.WATER)
        ) {
          const index = positions.length / 3;
          indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          positions.push(
            1 + x,
            1 + y,
            1 + z,
            1 + x,
            y,
            1 + z,
            1 + x,
            1 + y,
            z,
            1 + x,
            y,
            z
          );
          normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
          uvs.push(0, 0, 0, 1, 1, 0, 1, 1);
          if (textureIndexRight) {
            textureIndices.push(
              textureIndexRight,
              textureIndexRight,
              textureIndexRight,
              textureIndexRight
            );
          } else {
            if (textureIndexSides) {
              textureIndices.push(
                textureIndexSides,
                textureIndexSides,
                textureIndexSides,
                textureIndexSides
              );
            } else {
              textureIndices.push(
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
    positions: new Float32Array(positions).buffer,
    normals: new Float32Array(normals).buffer,
    indices: new Uint32Array(indices).buffer,
    uvs: new Float32Array(uvs).buffer,
    textureIndices: new Int32Array(textureIndices).buffer,
  };
}
