import { describe, expect, test } from "bun:test";
import { BlockType } from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";
import { calculateOffset } from "../utils";
import { PLANT_NEIGHBOR_DIRECTIONS, WORDS_PER_VERTEX, unpackVertex } from "../vertex-format";
import { generateMesh } from "./mesh";
import {
  decodeSurfaceQuads,
  findCovering,
  indexByPlane,
  sampleRectangle,
} from "./mesh-reference.test-helper";

const FULL_LIGHT = 0xff;

function meshFloorWithPillar(blocks: Array<[number, number, number, BlockType]>) {
  const chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
  const lightMap = new Uint8Array(chunk.length).fill(FULL_LIGHT);
  for (const [x, y, z, blockType] of blocks) {
    chunk[calculateOffset(x, y, z)] = blockType;
  }
  return generateMesh(chunk.buffer, lightMap.buffer);
}

function meshVertices(vertexBuffer: ArrayBuffer) {
  const words = new Uint32Array(vertexBuffer);
  const vertices = [];
  for (let vertex = 0; vertex < words.length / WORDS_PER_VERTEX; vertex++) {
    vertices.push(unpackVertex(words[vertex * 2], words[vertex * 2 + 1]));
  }
  return vertices;
}

const JUST_INSIDE = 0.001;

// Shading of the upward facing surface in plane y at the block position (x, z).
function topSurfaceAt(vertexBuffer: ArrayBuffer, y: number, x: number, z: number) {
  const planes = indexByPlane(decodeSurfaceQuads(vertexBuffer));
  const rectangle = findCovering(planes, `1:${y}:1`, x, z);
  if (!rectangle) throw new Error(`no top surface at ${x}, ${y}, ${z}`);
  return sampleRectangle(rectangle, x, z)!;
}

function topQuadsInPlane(vertexBuffer: ArrayBuffer, y: number) {
  return decodeSurfaceQuads(vertexBuffer).filter(
    (quad) => quad.corners.every((corner) => corner.y === y) && quad.corners[0].y === y
  );
}

describe("generateMesh ambient occlusion", () => {
  const floor: Array<[number, number, number, BlockType]> = [];
  for (let x = 3; x <= 7; x++) {
    for (let z = 3; z <= 7; z++) floor.push([x, 4, z, BlockType.STONE]);
  }
  const mesh = meshFloorWithPillar([...floor, [5, 5, 5, BlockType.STONE]]);

  test("floor corners touching a pillar are darkened", () => {
    const touchingPoints: Array<[number, number]> = [
      [5 - JUST_INSIDE, 5 - JUST_INSIDE],
      [5 - JUST_INSIDE, 5 + JUST_INSIDE],
      [5 + JUST_INSIDE, 5 - JUST_INSIDE],
    ];
    for (const [x, z] of touchingPoints) {
      expect(topSurfaceAt(mesh.opaque, 5, x, z).ambientOcclusion).toBeCloseTo(2, 1);
    }
  });

  test("open floor stays fully bright", () => {
    expect(topSurfaceAt(mesh.opaque, 5, 3 + JUST_INSIDE, 3 + JUST_INSIDE).ambientOcclusion).toBe(3);
  });

  test("a concave floor to wall seam is darker than a lone corner", () => {
    const wall: Array<[number, number, number, BlockType]> = [];
    for (let z = 3; z <= 7; z++) wall.push([5, 5, z, BlockType.STONE]);
    const seamMesh = meshFloorWithPillar([...floor, ...wall]);
    const seamValues = [
      topSurfaceAt(seamMesh.opaque, 5, 5 - JUST_INSIDE, 5 - JUST_INSIDE).ambientOcclusion,
      topSurfaceAt(seamMesh.opaque, 5, 5 - JUST_INSIDE, 5 + JUST_INSIDE).ambientOcclusion,
    ];
    expect(Math.max(...seamValues)).toBeLessThan(3);
    expect(Math.min(...seamValues)).toBeLessThanOrEqual(1.1);
  });

  test("every quad vertex carries an occlusion value within range, even with plants nearby", () => {
    const withFlower = meshFloorWithPillar([
      ...floor,
      [5, 5, 5, BlockType.TALL_GRASS],
      [6, 5, 6, BlockType.STONE],
    ]);
    const vertices = meshVertices(withFlower.opaque);
    expect(vertices.length).toBeGreaterThan(0);
    for (const vertex of vertices) expect(vertex.ambientOcclusion).toBeLessThanOrEqual(3);
  });
});

describe("generateMesh smooth light", () => {
  test("a top face between dim and bright air blends light across its vertices", () => {
    const chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
    const lightMap = new Uint8Array(chunk.length).fill(FULL_LIGHT);
    for (let x = 3; x <= 7; x++) {
      for (let z = 3; z <= 7; z++) {
        chunk[calculateOffset(x, 4, z)] = BlockType.STONE;
        if (x <= 4) lightMap[calculateOffset(x, 5, z)] = 0x44;
      }
    }
    const mesh = generateMesh(chunk.buffer, lightMap.buffer);

    expect(topSurfaceAt(mesh.opaque, 5, 4 + JUST_INSIDE, 5.5).light).toBeCloseTo(4, 1);
    const blended = topSurfaceAt(mesh.opaque, 5, 5 - JUST_INSIDE, 5.5).light;
    expect(blended).toBeGreaterThan(4);
    expect(blended).toBeLessThan(15);
  });
});

describe("generateMesh greedy merging", () => {
  function meshFloor(blockAt: (x: number, z: number) => BlockType, lightAt: (x: number, z: number) => number) {
    const chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
    const lightMap = new Uint8Array(chunk.length).fill(FULL_LIGHT);
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        chunk[calculateOffset(x, 4, z)] = blockAt(x, z);
        lightMap[calculateOffset(x, 5, z)] = lightAt(x, z);
      }
    }
    return generateMesh(chunk.buffer, lightMap.buffer);
  }

  test("an open floor of one block type is a single quad tiling its texture across 32 blocks", () => {
    const mesh = meshFloor(() => BlockType.STONE, () => FULL_LIGHT);
    const topQuads = topQuadsInPlane(mesh.opaque, 5);
    expect(topQuads.length).toBe(1);
    const unwrapped = topQuads[0].corners.flatMap((corner) => [corner.u, corner.v]);
    expect(Math.max(...unwrapped)).toBe(CHUNK_WIDTH);
    expect(Math.min(...unwrapped)).toBe(0);
  });

  test("blocks with different textures do not merge", () => {
    const mesh = meshFloor((x) => (x < 16 ? BlockType.STONE : BlockType.DIRT), () => FULL_LIGHT);
    expect(topQuadsInPlane(mesh.opaque, 5).length).toBe(2);
  });

  test("faces with different light do not merge", () => {
    const mesh = meshFloor(
      () => BlockType.STONE,
      (x) => (x < 16 ? 0xf0 : 0x80)
    );
    expect(topQuadsInPlane(mesh.opaque, 5).length).toBeGreaterThan(1);
  });

  test("a still water surface merges into one quad at its partial height", () => {
    const mesh = meshFloor(() => BlockType.WATER, () => FULL_LIGHT);
    const surface = decodeSurfaceQuads(mesh.transparent).filter((quad) =>
      quad.corners.every((corner) => corner.y === 4 + 14 / 16)
    );
    expect(surface.length).toBe(1);
  });
});

describe("generateMesh plants", () => {
  function meshWithSaplingOnStone(light: number) {
    const chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
    chunk[calculateOffset(5, 4, 5)] = BlockType.STONE;
    chunk[calculateOffset(5, 5, 5)] = BlockType.SAPLING;
    const lightMap = new Uint8Array(chunk.length).fill(light);
    return generateMesh(chunk.buffer, lightMap.buffer);
  }

  test("a plant becomes one instance and adds no chunk vertices of its own", () => {
    const mesh = meshWithSaplingOnStone(FULL_LIGHT);
    const saplingBatch = mesh.plants.find((batch) => batch.blockType === BlockType.SAPLING);
    expect(saplingBatch).toBeDefined();
    expect(new Uint32Array(saplingBatch!.instances).length).toBe(1);

    const stoneOnly = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
    stoneOnly[calculateOffset(5, 4, 5)] = BlockType.STONE;
    const stoneMesh = generateMesh(
      stoneOnly.buffer,
      new Uint8Array(stoneOnly.length).fill(FULL_LIGHT).buffer
    );
    expect(mesh.opaque.byteLength).toBe(stoneMesh.opaque.byteLength);
  });

  test("the instance records the plant's block, light and which neighbors are solid", () => {
    const mesh = meshWithSaplingOnStone(0x0a);
    const instance = new Uint32Array(mesh.plants[0].instances)[0];
    const blockX = instance & 31;
    const blockY = (instance >>> 5) & 31;
    const blockZ = (instance >>> 10) & 31;
    const light = (instance >>> 15) & 15;
    const neighborMask = (instance >>> 19) & 63;

    expect([blockX, blockY, blockZ]).toEqual([5, 5, 5]);
    expect(light).toBe(10);
    const belowDirection = PLANT_NEIGHBOR_DIRECTIONS.findIndex(
      ([dx, dy, dz]) => dx === 0 && dy === -1 && dz === 0
    );
    expect(neighborMask).toBe(1 << belowDirection);
  });

  test("a chunk with nothing but air produces no geometry", () => {
    const chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
    const mesh = generateMesh(chunk.buffer, new Uint8Array(chunk.length).fill(FULL_LIGHT).buffer);
    expect(mesh.opaque.byteLength).toBe(0);
    expect(mesh.transparent.byteLength).toBe(0);
    expect(mesh.plants).toEqual([]);
  });
});
