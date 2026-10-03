import { describe, expect, test } from "bun:test";
import path from "path";
import sharp from "sharp";
import { BLOCK_TEXTURES, BlockType, Texture } from "../blocks";
import { TEXTURE_SIZE } from "../config";
import { PLANT_PIXEL_MASKS } from "../data/plant-pixel-masks";
import { WORDS_PER_VERTEX, unpackVertex } from "../vertex-format";
import {
  buildPlantBillboardTemplate,
  buildPlantTemplate,
} from "./plant-voxels";

const PLANT_BLOCKS = [
  BlockType.TALL_GRASS,
  BlockType.ANEMONE_FLOWER,
  BlockType.PONPON_FLOWER,
  BlockType.SAPLING,
  BlockType.BELLIS_FLOWER,
  BlockType.FORGETMENOTS_FLOWER,
];

// Where two sheets share a cell only one pixel can own it, so these columns may lose a voxel.
const SHEET_CROSSING_COLUMNS: Partial<Record<BlockType, number[]>> = {
  [BlockType.TALL_GRASS]: [7, 8],
  [BlockType.ANEMONE_FLOWER]: [7, 8],
  [BlockType.PONPON_FLOWER]: [7, 8],
  [BlockType.SAPLING]: [7, 8],
  [BlockType.FORGETMENOTS_FLOWER]: [5, 10],
};

function templateVertices(block: BlockType) {
  const template = buildPlantTemplate(block);
  const words = new Uint32Array(template.vertexBuffer);
  const vertices = [];
  for (let vertex = 0; vertex < words.length / WORDS_PER_VERTEX; vertex++) {
    vertices.push(unpackVertex(words[vertex * 2], words[vertex * 2 + 1]));
  }
  return { template, vertices };
}

function opaquePixelsOf(block: BlockType): Set<string> {
  const fileName = Object.values(Texture)[BLOCK_TEXTURES[block].DEFAULT];
  const opaque = new Set<string>();
  PLANT_PIXEL_MASKS[fileName].forEach((row, rowIndex) =>
    [...row].forEach((character, columnIndex) => {
      if (character === "#") opaque.add(`${columnIndex},${rowIndex}`);
    }),
  );
  return opaque;
}

function sampledPixels(
  vertices: ReturnType<typeof templateVertices>["vertices"],
): Set<string> {
  const sampled = new Set<string>();
  for (const vertex of vertices) {
    const column = vertex.u * TEXTURE_SIZE - 0.5;
    const row = vertex.v * TEXTURE_SIZE - 0.5;
    sampled.add(`${column},${row}`);
  }
  return sampled;
}

describe("plant pixel masks", () => {
  test("match the alpha channel of every plant texture", async () => {
    for (const fileName of Object.keys(PLANT_PIXEL_MASKS)) {
      const { data, info } = await sharp(
        path.join(process.cwd(), "public/game", fileName),
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rowsFromPng = Array.from({ length: info.height }, (_, row) =>
        Array.from({ length: info.width }, (_, column) =>
          data[(row * info.width + column) * 4 + 3] >= 128 ? "#" : ".",
        ).join(""),
      );
      expect(PLANT_PIXEL_MASKS[fileName]).toEqual(rowsFromPng);
    }
  });
});

describe("buildPlantTemplate", () => {
  for (const block of PLANT_BLOCKS) {
    describe(BlockType[block], () => {
      const { template, vertices } = templateVertices(block);
      const opaquePixels = opaquePixelsOf(block);

      test("only opaque pixels become voxels, and none are lost outside sheet crossings", () => {
        expect(opaquePixels.size).toBeGreaterThan(0);
        const sampled = sampledPixels(vertices);
        for (const pixel of sampled) expect(opaquePixels.has(pixel)).toBe(true);

        const crossingColumns = SHEET_CROSSING_COLUMNS[block] ?? [];
        for (const pixel of opaquePixels) {
          const column = Number(pixel.split(",")[0]);
          if (!crossingColumns.includes(column))
            expect(sampled.has(pixel)).toBe(true);
        }
      });

      test("voxels are 1/16 cubes inside the block", () => {
        for (const vertex of vertices) {
          for (const coordinate of [vertex.x, vertex.y, vertex.z]) {
            expect(coordinate).toBeGreaterThanOrEqual(0);
            expect(coordinate).toBeLessThanOrEqual(1);
          }
        }
      });

      test("every vertex belongs to a whole quad and uses the plant texture", () => {
        expect(vertices.length).toBe(template.quadCount * 4);
        for (const vertex of vertices) {
          expect(vertex.textureIndex).toBe(BLOCK_TEXTURES[block].DEFAULT);
        }
      });
    });
  }

  test("faces buried between neighboring voxels are culled", () => {
    const { template } = templateVertices(BlockType.SAPLING);
    const opaqueCount = opaquePixelsOf(BlockType.SAPLING).size;
    expect(template.quadCount).toBeLessThan(opaqueCount * 2 * 6);
    expect(template.quadCount).toBeGreaterThanOrEqual(opaqueCount * 2);
  });

  test("voxels pressed against other voxels are darker than isolated ones", () => {
    const { vertices } = templateVertices(BlockType.TALL_GRASS);
    const occlusionValues = new Set(
      vertices.map((vertex) => vertex.ambientOcclusion),
    );
    expect(Math.min(...occlusionValues)).toBeLessThan(3);
    expect(Math.max(...occlusionValues)).toBe(3);
  });
});

describe("buildPlantBillboardTemplate", () => {
  test("draws each sheet from both sides, with far fewer quads than the voxel plant", () => {
    expect(buildPlantBillboardTemplate(BlockType.TALL_GRASS).quadCount).toBe(4);
    expect(
      buildPlantBillboardTemplate(BlockType.FORGETMENOTS_FLOWER).quadCount,
    ).toBe(8);
    expect(buildPlantBillboardTemplate(BlockType.BELLIS_FLOWER).quadCount).toBe(
      2,
    );
    for (const block of PLANT_BLOCKS) {
      expect(buildPlantBillboardTemplate(block).quadCount).toBeLessThan(
        buildPlantTemplate(block).quadCount,
      );
    }
  });

  test("the sheets span the whole texture inside the block", () => {
    const words = new Uint32Array(
      buildPlantBillboardTemplate(BlockType.SAPLING).vertexBuffer,
    );
    const vertices = [];
    for (let vertex = 0; vertex < words.length / WORDS_PER_VERTEX; vertex++) {
      vertices.push(unpackVertex(words[vertex * 2], words[vertex * 2 + 1]));
    }
    expect(Math.min(...vertices.map((vertex) => vertex.u))).toBe(0);
    expect(Math.max(...vertices.map((vertex) => vertex.u))).toBe(1);
    expect(Math.min(...vertices.map((vertex) => vertex.v))).toBe(0);
    expect(Math.max(...vertices.map((vertex) => vertex.v))).toBe(1);
    for (const vertex of vertices) {
      for (const coordinate of [vertex.x, vertex.y, vertex.z]) {
        expect(coordinate).toBeGreaterThanOrEqual(0);
        expect(coordinate).toBeLessThanOrEqual(1);
      }
    }
  });
});
