import {
  BLOCK_TEXTURES,
  BlockType,
  NON_SOLID_BLOCKS,
} from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";

import { calculateOffset } from "../utils";

export function generateMesh(_chunk: ArrayBuffer): {
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

        let blockAbove = !isTopEdge
          ? chunk[calculateOffset(x, y + 1, z)]
          : BlockType.AIR;
        let blockBelow = !isBottomEdge
          ? chunk[calculateOffset(x, y - 1, z)]
          : BlockType.AIR;
        let blockBehind = !isBackEdge
          ? chunk[calculateOffset(x, y, z - 1)]
          : BlockType.AIR;

        let blockInfront = !isFrontEdge
          ? chunk[calculateOffset(x, y, z + 1)]
          : BlockType.AIR;

        let blockToTheLeft = !isLeftEdge
          ? chunk[calculateOffset(x - 1, y, z)]
          : BlockType.AIR;
        let blockToTheRight = !isRightEdge
          ? chunk[calculateOffset(x + 1, y, z)]
          : BlockType.AIR;

        const textureIndexDefault = BLOCK_TEXTURES[block].DEFAULT ?? 0;
        const textureIndexSides = BLOCK_TEXTURES[block].SIDES;

        const textureIndexFront = BLOCK_TEXTURES[block].FRONT_FACE;
        const textureIndexBack = BLOCK_TEXTURES[block].BACK_FACE;
        const textureIndexTop = BLOCK_TEXTURES[block].TOP_FACE;
        const textureIndexBottom = BLOCK_TEXTURES[block].BOTTOM_FACE;
        const textureIndexLeft = BLOCK_TEXTURES[block].LEFT_FACE;
        const textureIndexRight = BLOCK_TEXTURES[block].RIGHT_FACE;

        if (NON_SOLID_BLOCKS.includes(blockAbove)) {
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
        if (NON_SOLID_BLOCKS.includes(blockBelow)) {
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

        if (NON_SOLID_BLOCKS.includes(blockInfront)) {
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

        if (NON_SOLID_BLOCKS.includes(blockBehind)) {
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

        if (NON_SOLID_BLOCKS.includes(blockToTheLeft)) {
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

        if (NON_SOLID_BLOCKS.includes(blockToTheRight)) {
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

