import { describe, expect, test } from "bun:test";
import path from "path";
import sharp from "sharp";
import { BLOCK_TEXTURES, BlockType, Texture } from "../blocks";
import { TEXTURE_SIZE } from "../config";
import { PLANT_PIXEL_MASKS } from "../data/plant-pixel-masks";
import { type PlantMeshBuffers, emitPlantVoxels } from "./plant-voxels";

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

function meshPlant(block: BlockType): PlantMeshBuffers {
  const mesh: PlantMeshBuffers = {
    positions: [],
    normals: [],
    indices: [],
    uvs: [],
    textureIndices: [],
    lightLevels: [],
  };
  emitPlantVoxels(mesh, block, 0, 0, 0, BLOCK_TEXTURES[block].DEFAULT, 15);
  return mesh;
}

function opaquePixelsOf(block: BlockType): Set<string> {
  const fileName = Object.values(Texture)[BLOCK_TEXTURES[block].DEFAULT];
  const opaque = new Set<string>();
  PLANT_PIXEL_MASKS[fileName].forEach((row, rowIndex) =>
    [...row].forEach((character, columnIndex) => {
      if (character === "#") opaque.add(`${columnIndex},${rowIndex}`);
    })
  );
  return opaque;
}

function sampledPixels(mesh: PlantMeshBuffers): Set<string> {
  const sampled = new Set<string>();
  for (let vertex = 0; vertex < mesh.uvs.length / 2; vertex++) {
    const column = mesh.uvs[vertex * 2] * TEXTURE_SIZE - 0.5;
    const row = mesh.uvs[vertex * 2 + 1] * TEXTURE_SIZE - 0.5;
    sampled.add(`${column},${row}`);
  }
  return sampled;
}

describe("plant pixel masks", () => {
  test("match the alpha channel of every plant texture", async () => {
    for (const fileName of Object.keys(PLANT_PIXEL_MASKS)) {
      const { data, info } = await sharp(path.join(process.cwd(), "public/game", fileName))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rowsFromPng = Array.from({ length: info.height }, (_, row) =>
        Array.from({ length: info.width }, (_, column) =>
          data[(row * info.width + column) * 4 + 3] >= 128 ? "#" : "."
        ).join("")
      );
      expect(PLANT_PIXEL_MASKS[fileName]).toEqual(rowsFromPng);
    }
  });
});

describe("emitPlantVoxels", () => {
  for (const block of PLANT_BLOCKS) {
    describe(BlockType[block], () => {
      const mesh = meshPlant(block);
      const opaquePixels = opaquePixelsOf(block);

      test("only opaque pixels become voxels, and none are lost outside sheet crossings", () => {
        expect(opaquePixels.size).toBeGreaterThan(0);
        const sampled = sampledPixels(mesh);
        for (const pixel of sampled) expect(opaquePixels.has(pixel)).toBe(true);

        const crossingColumns = SHEET_CROSSING_COLUMNS[block] ?? [];
        for (const pixel of opaquePixels) {
          const column = Number(pixel.split(",")[0]);
          if (!crossingColumns.includes(column)) expect(sampled.has(pixel)).toBe(true);
        }
      });

      test("voxels are 1/16 cubes inside the block", () => {
        for (const coordinate of mesh.positions) {
          expect(coordinate).toBeGreaterThanOrEqual(0);
          expect(coordinate).toBeLessThanOrEqual(1);
          expect(Number.isInteger(coordinate * TEXTURE_SIZE)).toBe(true);
        }
      });

      test("indices stay within the emitted vertices", () => {
        const vertexCount = mesh.positions.length / 3;
        expect(Math.max(...mesh.indices)).toBeLessThan(vertexCount);
      });
    });
  }

  test("a lone pixel voxel exposes all six faces and shared faces are culled", () => {
    const sapling = meshPlant(BlockType.SAPLING);
    const faceCount = sapling.indices.length / 6;
    const opaqueCount = opaquePixelsOf(BlockType.SAPLING).size;
    expect(faceCount).toBeLessThan(opaqueCount * 2 * 6);
    expect(faceCount).toBeGreaterThanOrEqual(opaqueCount * 2);
  });
});
