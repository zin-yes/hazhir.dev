import {
  BLOCK_TEXTURES,
  BlockType,
  TRANSLUCENT_BLOCKS,
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

        const blockHeight =
          block === BlockType.WATER && blockAbove !== BlockType.WATER ? 0.8 : 1;
        const yh = y + blockHeight;

        if (
          TRANSPARENT_BLOCKS.includes(blockAbove) &&
          !(block === BlockType.WATER && blockAbove === BlockType.WATER)
        ) {
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
        if (
          TRANSPARENT_BLOCKS.includes(blockBelow) &&
          !(block === BlockType.WATER && blockBelow === BlockType.WATER)
        ) {
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
            y,
            z + 1,
            x,
            y,
            z + 1,
            x + 1,
            y,
            z,
            x,
            y,
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

        let cullFront = false;
        if (block === BlockType.WATER && blockInfront === BlockType.WATER) {
          let neighborAbove = BlockType.AIR;
          if (!isFrontEdge) {
            if (!isTopEdge)
              neighborAbove = chunk[calculateOffset(x, y + 1, z + 1)];
            else if (topBorder)
              neighborAbove = topBorder[x * CHUNK_LENGTH + (z + 1)];
          } else if (frontBorder && !isTopEdge) {
            neighborAbove = frontBorder[x * CHUNK_HEIGHT + (y + 1)];
          }
          const neighborHeight = neighborAbove !== BlockType.WATER ? 0.8 : 1;
          if (blockHeight <= neighborHeight) cullFront = true;
        }

        if (TRANSPARENT_BLOCKS.includes(blockInfront) && !cullFront) {
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
            y,
            1 + z,
            1 + x,
            y,
            1 + z,
            x,
            yh,
            1 + z,
            1 + x,
            yh,
            1 + z
          );
          target.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
          target.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
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

        let cullBack = false;
        if (block === BlockType.WATER && blockBehind === BlockType.WATER) {
          let neighborAbove = BlockType.AIR;
          if (!isBackEdge) {
            if (!isTopEdge)
              neighborAbove = chunk[calculateOffset(x, y + 1, z - 1)];
            else if (topBorder)
              neighborAbove = topBorder[x * CHUNK_LENGTH + (z - 1)];
          } else if (backBorder && !isTopEdge) {
            neighborAbove = backBorder[x * CHUNK_HEIGHT + (y + 1)];
          }
          const neighborHeight = neighborAbove !== BlockType.WATER ? 0.8 : 1;
          if (blockHeight <= neighborHeight) cullBack = true;
        }

        if (TRANSPARENT_BLOCKS.includes(blockBehind) && !cullBack) {
          const index = target.positions.length / 3;
          target.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          target.positions.push(1 + x, y, z, x, y, z, 1 + x, yh, z, x, yh, z);
          target.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
          target.uvs.push(1, 1, 0, 1, 1, 0, 0, 0);
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

        let cullLeft = false;
        if (block === BlockType.WATER && blockToTheLeft === BlockType.WATER) {
          let neighborAbove = BlockType.AIR;
          if (!isLeftEdge) {
            if (!isTopEdge)
              neighborAbove = chunk[calculateOffset(x - 1, y + 1, z)];
            else if (topBorder)
              neighborAbove = topBorder[(x - 1) * CHUNK_LENGTH + z];
          } else if (leftBorder && !isTopEdge) {
            neighborAbove = leftBorder[(y + 1) * CHUNK_LENGTH + z];
          }
          const neighborHeight = neighborAbove !== BlockType.WATER ? 0.8 : 1;
          if (blockHeight <= neighborHeight) cullLeft = true;
        }

        if (TRANSPARENT_BLOCKS.includes(blockToTheLeft) && !cullLeft) {
          const index = target.positions.length / 3;
          target.indices.push(
            index,
            index + 1,
            index + 2,
            index + 2,
            index + 1,
            index + 3
          );

          target.positions.push(x, yh, z, x, y, z, x, yh, 1 + z, x, y, 1 + z);
          target.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
          target.uvs.push(0, 0, 0, 1, 1, 0, 1, 1);
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

        let cullRight = false;
        if (block === BlockType.WATER && blockToTheRight === BlockType.WATER) {
          let neighborAbove = BlockType.AIR;
          if (!isRightEdge) {
            if (!isTopEdge)
              neighborAbove = chunk[calculateOffset(x + 1, y + 1, z)];
            else if (topBorder)
              neighborAbove = topBorder[(x + 1) * CHUNK_LENGTH + z];
          } else if (rightBorder && !isTopEdge) {
            neighborAbove = rightBorder[(y + 1) * CHUNK_LENGTH + z];
          }
          const neighborHeight = neighborAbove !== BlockType.WATER ? 0.8 : 1;
          if (blockHeight <= neighborHeight) cullRight = true;
        }

        if (TRANSPARENT_BLOCKS.includes(blockToTheRight) && !cullRight) {
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
            y,
            1 + z,
            1 + x,
            yh,
            z,
            1 + x,
            y,
            z
          );
          target.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
          target.uvs.push(0, 0, 0, 1, 1, 0, 1, 1);
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
