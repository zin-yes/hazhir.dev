import { describe, expect, test } from "bun:test";
import { BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { extractBorderSlab } from "../chunk-borders";
import { generateChunkBlocks } from "../worldgen/chunk-generator";
import { initializeChunkLight, propagateChunkLight } from "./lighting";
import { generateMesh } from "./mesh";
import type { ChunkFaceBuffers } from "./mesh-types";
import {
  buildReferenceQuads,
  decodeSurfaceQuads,
  findCovering,
  indexByPlane,
  sampleRectangle,
  toPlaneRectangle,
  type PlaneRectangle,
  type SurfaceQuad,
} from "./mesh-reference.test-helper";

const SEED = 2024;
const TEST_TIMEOUT_MS = 120_000;
const SAMPLE_FRACTIONS: Array<[number, number]> = [
  [0.21, 0.34],
  [0.73, 0.18],
  [0.42, 0.81],
  [0.88, 0.92],
];
const TOLERANCE = 1e-6;

interface MeshInput {
  chunk: Uint8Array;
  light: Uint8Array;
  borders: ChunkFaceBuffers;
  borderLights: ChunkFaceBuffers;
}

function fractionalPart(value: number): number {
  return value - Math.floor(value);
}

function describeRectangle(rectangle: PlaneRectangle): string {
  return `${rectangle.planeKey} first ${rectangle.minFirst}-${rectangle.maxFirst} second ${rectangle.minSecond}-${rectangle.maxSecond}`;
}

/**
 * Samples the reference surface at points inside every reference quad and checks
 * the mesh has a quad there that shades identically, then samples the mesh and
 * checks the reference covers it, so neither side draws anything extra.
 */
function findSurfaceMismatches(meshQuads: SurfaceQuad[], referenceQuads: SurfaceQuad[]): string[] {
  const meshPlanes = indexByPlane(meshQuads);
  const referencePlanes = indexByPlane(referenceQuads);
  const mismatches: string[] = [];

  for (const reference of referenceQuads) {
    const referenceRectangle = toPlaneRectangle(reference);
    for (const [firstFraction, secondFraction] of SAMPLE_FRACTIONS) {
      const first = referenceRectangle.minFirst + (referenceRectangle.maxFirst - referenceRectangle.minFirst) * firstFraction;
      const second = referenceRectangle.minSecond + (referenceRectangle.maxSecond - referenceRectangle.minSecond) * secondFraction;
      const expected = sampleRectangle(referenceRectangle, first, second);
      const coveringRectangle = findCovering(meshPlanes, referenceRectangle.planeKey, first, second);
      if (!coveringRectangle) {
        mismatches.push(`missing mesh surface at ${describeRectangle(referenceRectangle)} (${first}, ${second})`);
        continue;
      }
      const actual = sampleRectangle(coveringRectangle, first, second);
      if (!expected || !actual) {
        mismatches.push(`unsampled point at ${describeRectangle(referenceRectangle)}`);
        continue;
      }
      const differences: string[] = [];
      if (actual.textureIndex !== expected.textureIndex) differences.push("texture");
      if (Math.abs(actual.ambientOcclusion - expected.ambientOcclusion) > TOLERANCE) differences.push("occlusion");
      if (Math.abs(actual.light - expected.light) > TOLERANCE) differences.push("light");
      if (Math.abs(fractionalPart(actual.u) - fractionalPart(expected.u)) > TOLERANCE) differences.push("u");
      if (Math.abs(fractionalPart(actual.v) - fractionalPart(expected.v)) > TOLERANCE) differences.push("v");
      if (differences.length > 0) {
        mismatches.push(`${differences.join("+")} differ at ${describeRectangle(referenceRectangle)} (${first}, ${second})`);
      }
    }
  }

  for (const mesh of meshQuads) {
    const meshRectangle = toPlaneRectangle(mesh);
    const firstSteps = Math.max(1, Math.ceil(meshRectangle.maxFirst - meshRectangle.minFirst));
    const secondSteps = Math.max(1, Math.ceil(meshRectangle.maxSecond - meshRectangle.minSecond));
    for (let firstStep = 0; firstStep < firstSteps; firstStep++) {
      for (let secondStep = 0; secondStep < secondSteps; secondStep++) {
        const first = meshRectangle.minFirst + (firstStep + 0.37) * ((meshRectangle.maxFirst - meshRectangle.minFirst) / firstSteps);
        const second = meshRectangle.minSecond + (secondStep + 0.61) * ((meshRectangle.maxSecond - meshRectangle.minSecond) / secondSteps);
        if (!findCovering(referencePlanes, meshRectangle.planeKey, first, second)) {
          mismatches.push(`extra mesh surface at ${describeRectangle(meshRectangle)} (${first}, ${second})`);
        }
      }
    }
  }
  return mismatches;
}

function meshAndCompare(input: MeshInput) {
  const mesh = generateMesh(
    input.chunk.slice().buffer,
    input.light.slice().buffer,
    input.borders,
    input.borderLights
  );
  const meshQuads = [...decodeSurfaceQuads(mesh.opaque), ...decodeSurfaceQuads(mesh.transparent)];
  const referenceQuads = buildReferenceQuads(input);
  return {
    meshQuads,
    referenceQuads,
    mismatches: findSurfaceMismatches(meshQuads, referenceQuads),
  };
}

function terrainInput(chunkX: number, chunkY: number, chunkZ: number): MeshInput {
  const chunk = generateChunkBlocks(SEED, chunkX, chunkY, chunkZ);
  const above = generateChunkBlocks(SEED, chunkX, chunkY + 1, chunkZ);
  const below = generateChunkBlocks(SEED, chunkX, chunkY - 1, chunkZ);
  const aboveLight = initializeChunkLight(above, SEED, chunkX, chunkY + 1, chunkZ).light;
  const belowLight = initializeChunkLight(below, SEED, chunkX, chunkY - 1, chunkZ, chunk).light;
  const initialized = initializeChunkLight(chunk, SEED, chunkX, chunkY, chunkZ, above, aboveLight);
  const light = propagateChunkLight(chunk, initialized.light, {}, {}, initialized.queue).centerLight;
  return {
    chunk,
    light,
    borders: { top: extractBorderSlab(above, "top"), bottom: extractBorderSlab(below, "bottom") },
    borderLights: {
      top: extractBorderSlab(aboveLight, "top"),
      bottom: extractBorderSlab(belowLight, "bottom"),
    },
  };
}

function cellIndex(x: number, y: number, z: number) {
  return x * CHUNK_HEIGHT * CHUNK_LENGTH + y * CHUNK_LENGTH + z;
}

// Deterministic pseudo random light blobs: smooth enough to merge in places, varied enough to break runs.
function noisyLight(chunk: Uint8Array): Uint8Array {
  const light = new Uint8Array(chunk.length);
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const blob = Math.floor(x / 5) * 7 + Math.floor(z / 6) * 3 + Math.floor(y / 4);
        const sky = (blob * 5) % 16;
        const block = (x * 3 + z) % 11 === 0 ? 9 : 0;
        light[cellIndex(x, y, z)] = (sky << 4) | block;
      }
    }
  }
  return light;
}

// A floor with a pillar, a wall, a sunken pool with partial water levels, glass, leaves and slabs.
function kitchenSinkInput(): MeshInput {
  const chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
  const place = (x: number, y: number, z: number, block: BlockType) => {
    chunk[cellIndex(x, y, z)] = block;
  };
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let z = 0; z < CHUNK_LENGTH; z++) {
      for (let y = 0; y < 4; y++) place(x, y, z, y < 3 ? BlockType.STONE : BlockType.DIRT);
      place(x, 4, z, (x * 7 + z * 13) % 17 === 0 ? BlockType.COBBLESTONE : BlockType.GRASS);
    }
  }
  for (let x = 10; x < 18; x++) {
    for (let z = 10; z < 18; z++) {
      place(x, 4, z, x < 14 ? BlockType.WATER : BlockType.AIR);
      place(x, 3, z, BlockType.SAND);
    }
  }
  for (let z = 10; z < 14; z++) place(18, 4, z, BlockType.WATER_LEVEL_3);
  for (let x = 2; x < 9; x++) {
    place(x, 5, 20, BlockType.STONE);
    place(x, 6, 20, x % 2 === 0 ? BlockType.GLASS : BlockType.STONE);
  }
  place(5, 5, 5, BlockType.STONE);
  place(5, 6, 5, BlockType.STONE);
  for (let x = 22; x < 27; x++) {
    for (let z = 22; z < 27; z++) {
      place(x, 5, z, BlockType.LEAVES);
      if ((x + z) % 2 === 0) place(x, 6, z, BlockType.LEAVES);
    }
  }
  for (let x = 2; x < 8; x++) place(x, 5, 2, x % 2 === 0 ? BlockType.STONE_SLAB : BlockType.STONE_SLAB_TOP);
  place(20, 5, 3, BlockType.GLOWSTONE);
  place(0, 5, 0, BlockType.STONE);
  place(31, 5, 31, BlockType.STONE);

  const slab = (cells: number) => new Uint8Array(cells).fill(BlockType.STONE).buffer;
  const lightSlab = (cells: number) => new Uint8Array(cells).fill(0x77).buffer;
  return {
    chunk,
    light: noisyLight(chunk),
    borders: {
      top: new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH).buffer,
      left: slab(CHUNK_HEIGHT * CHUNK_LENGTH),
      front: slab(CHUNK_WIDTH * CHUNK_HEIGHT),
    },
    borderLights: {
      top: lightSlab(CHUNK_WIDTH * CHUNK_LENGTH),
      front: lightSlab(CHUNK_WIDTH * CHUNK_HEIGHT),
    },
  };
}

describe("greedy mesher against the per-face reference", () => {
  test(
    "a mixed chunk with slabs, partial water, glass, leaves and uneven light draws the reference surface",
    () => {
      const { meshQuads, referenceQuads, mismatches } = meshAndCompare(kitchenSinkInput());
      expect(referenceQuads.length).toBeGreaterThan(2000);
      expect(mismatches.slice(0, 5)).toEqual([]);
      expect(meshQuads.length).toBeLessThan(referenceQuads.length);
    },
    TEST_TIMEOUT_MS
  );

  test(
    "a forest chunk draws the reference surface",
    () => {
      const { referenceQuads, mismatches } = meshAndCompare(terrainInput(0, 2, 0));
      expect(referenceQuads.length).toBeGreaterThan(5000);
      expect(mismatches.slice(0, 5)).toEqual([]);
    },
    TEST_TIMEOUT_MS
  );

  test(
    "a chunk with a lake draws the reference surface in far fewer quads",
    () => {
      const { meshQuads, referenceQuads, mismatches } = meshAndCompare(terrainInput(-4, 2, 22));
      expect(mismatches.slice(0, 5)).toEqual([]);
      expect(referenceQuads.length).toBeGreaterThan(1500);
      expect(meshQuads.length).toBeLessThan(referenceQuads.length * 0.5);
    },
    TEST_TIMEOUT_MS
  );

  test(
    "a cave chunk with uneven light draws the reference surface",
    () => {
      const { referenceQuads, mismatches } = meshAndCompare(terrainInput(15, 1, 15));
      expect(referenceQuads.length).toBeGreaterThan(2000);
      expect(mismatches.slice(0, 5)).toEqual([]);
    },
    TEST_TIMEOUT_MS
  );
});
