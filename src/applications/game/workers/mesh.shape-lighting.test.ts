import { describe, expect, test } from "bun:test";
import { BLOCK_TEXTURES, BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { calculateOffset } from "../utils";
import { initializeChunkLight, propagateChunkLight } from "./lighting";
import { generateMesh } from "./mesh";
import { type SurfaceQuad, decodeSurfaceQuads } from "./mesh-reference.test-helper";

const CELLS = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;
const SKY_ABOVE = new Uint8Array(CELLS).fill(0xf0);
const AIR_ABOVE = new Uint8Array(CELLS);
const MAX_LEVEL = 15;
const FULLY_OPEN = 3;
const FLOOR_HEIGHT = 3;
const SURFACE_Y = FLOOR_HEIGHT + 1;
const BLOCK_X = 8;
const BLOCK_Z = 8;

type PlacedBlock = [number, number, number, BlockType];

/** Meshes with the light the real engine produces, where opaque cells hold no light at all. */
function meshUnderOpenSky(blocks: PlacedBlock[]) {
  const chunk = new Uint8Array(CELLS);
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let z = 0; z < CHUNK_LENGTH; z++) chunk[calculateOffset(x, FLOOR_HEIGHT, z)] = BlockType.STONE;
  }
  for (const [x, y, z, block] of blocks) chunk[calculateOffset(x, y, z)] = block;
  const { light, queue } = initializeChunkLight(chunk, 0, 0, 10, 0, AIR_ABOVE, SKY_ABOVE);
  const { centerLight } = propagateChunkLight(chunk, light, {}, {}, queue);
  return generateMesh(chunk.buffer, centerLight.buffer);
}

/** Quads of one block, told apart from the stone around it by texture so neighbors on the cell boundary never count. */
function quadsOfBlock(opaque: ArrayBuffer, block: BlockType): SurfaceQuad[] {
  const textures = new Set(Object.values(BLOCK_TEXTURES[block]).filter((texture): texture is number => typeof texture === "number"));
  const quads = decodeSurfaceQuads(opaque).filter(
    (quad) =>
      textures.has(quad.textureIndex) &&
      quad.corners.every(
        (corner) =>
          corner.x >= BLOCK_X &&
          corner.x <= BLOCK_X + 1 &&
          corner.y >= SURFACE_Y &&
          corner.y <= SURFACE_Y + 1 &&
          corner.z >= BLOCK_Z &&
          corner.z <= BLOCK_Z + 1
      )
  );
  expect(quads.length).toBeGreaterThan(0);
  return quads;
}

const isFlatAtHeight = (quad: SurfaceQuad, height: number) =>
  quad.corners.every((corner) => corner.y === SURFACE_Y + height);
const isHorizontalAboveFloor = (quad: SurfaceQuad) =>
  quad.corners.every((corner) => corner.y === quad.corners[0].y) && quad.corners[0].y > SURFACE_Y;
const lowestCornerLight = (quads: SurfaceQuad[]) =>
  Math.min(...quads.flatMap((quad) => quad.corners.map((corner) => corner.light)));
const darkestCornerOcclusion = (quads: SurfaceQuad[]) =>
  Math.min(...quads.flatMap((quad) => quad.corners.map((corner) => corner.ambientOcclusion)));

const tallWallBehind = (): PlacedBlock[] =>
  [0, 1, 2].map((height): PlacedBlock => [BLOCK_X, SURFACE_Y + height, BLOCK_Z - 1, BlockType.STONE]);

describe("slab and stair light under open sky is never taken from an opaque cell", () => {
  test("a bottom slab roofed by stone keeps its own light on its exposed top", () => {
    const mesh = meshUnderOpenSky([
      [BLOCK_X, SURFACE_Y, BLOCK_Z, BlockType.PLANKS_SLAB],
      [BLOCK_X, SURFACE_Y + 1, BLOCK_Z, BlockType.STONE],
      [BLOCK_X + 1, SURFACE_Y + 1, BLOCK_Z, BlockType.STONE],
    ]);
    const exposedTop = quadsOfBlock(mesh.opaque, BlockType.PLANKS_SLAB).filter((quad) => isFlatAtHeight(quad, 0.5));
    expect(exposedTop.length).toBeGreaterThan(0);
    expect(lowestCornerLight(exposedTop)).toBeGreaterThanOrEqual(MAX_LEVEL - 4);
  });

  test("a top slab resting on a stone block keeps its own light on its exposed underside", () => {
    const mesh = meshUnderOpenSky([
      [BLOCK_X, SURFACE_Y, BLOCK_Z, BlockType.PLANKS_SLAB_TOP],
      [BLOCK_X, SURFACE_Y - 1, BLOCK_Z, BlockType.STONE],
      [BLOCK_X + 1, SURFACE_Y - 1, BLOCK_Z, BlockType.STONE],
    ]);
    const underside = quadsOfBlock(mesh.opaque, BlockType.PLANKS_SLAB_TOP).filter((quad) => isFlatAtHeight(quad, 0.5));
    expect(underside.length).toBeGreaterThan(0);
    expect(lowestCornerLight(underside)).toBeGreaterThanOrEqual(MAX_LEVEL - 4);
  });

  for (const stairs of [
    BlockType.PLANKS_STAIRS_NORTH,
    BlockType.PLANKS_STAIRS_SOUTH,
    BlockType.PLANKS_STAIRS_EAST,
    BlockType.PLANKS_STAIRS_WEST,
  ]) {
    test(`${BlockType[stairs]} under a roof is lit like the open air beside it`, () => {
      const mesh = meshUnderOpenSky([
        [BLOCK_X, SURFACE_Y, BLOCK_Z, stairs],
        [BLOCK_X, SURFACE_Y + 1, BLOCK_Z, BlockType.STONE],
      ]);
      expect(lowestCornerLight(quadsOfBlock(mesh.opaque, stairs))).toBeGreaterThanOrEqual(MAX_LEVEL - 4);
    });
  }
});

describe("slab and stair ambient occlusion matches the cubes around them", () => {
  test("a slab pressed into a wall is darkened where it meets the wall", () => {
    const mesh = meshUnderOpenSky([[BLOCK_X, SURFACE_Y, BLOCK_Z, BlockType.PLANKS_SLAB], ...tallWallBehind()]);
    const topOfSlab = quadsOfBlock(mesh.opaque, BlockType.PLANKS_SLAB).filter((quad) => isFlatAtHeight(quad, 0.5));
    expect(darkestCornerOcclusion(topOfSlab)).toBeLessThan(FULLY_OPEN);
  });

  test("a stair pressed into a wall is darkened where it meets the wall", () => {
    const mesh = meshUnderOpenSky([[BLOCK_X, SURFACE_Y, BLOCK_Z, BlockType.PLANKS_STAIRS_NORTH], ...tallWallBehind()]);
    const treadsAndTops = quadsOfBlock(mesh.opaque, BlockType.PLANKS_STAIRS_NORTH).filter(isHorizontalAboveFloor);
    expect(darkestCornerOcclusion(treadsAndTops)).toBeLessThan(FULLY_OPEN);
  });

  test("a stair in the open stays fully bright on its treads", () => {
    const mesh = meshUnderOpenSky([[BLOCK_X, SURFACE_Y, BLOCK_Z, BlockType.PLANKS_STAIRS_NORTH]]);
    const treadsAndTops = quadsOfBlock(mesh.opaque, BlockType.PLANKS_STAIRS_NORTH).filter(isHorizontalAboveFloor);
    expect(darkestCornerOcclusion(treadsAndTops)).toBe(FULLY_OPEN);
  });
});
