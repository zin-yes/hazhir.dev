import { describe, expect, test } from "bun:test";
import { BlockType } from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";
import { calculateOffset } from "../utils";
import { PLANT_NEIGHBOR_DIRECTIONS, VERTICES_PER_QUAD, WORDS_PER_VERTEX, unpackVertex } from "../vertex-format";
import { generateMesh } from "./mesh";

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

// Occlusion of the vertices of upward faces lying in plane y, at the given corner.
function topFaceOcclusionAt(vertexBuffer: ArrayBuffer, position: [number, number, number]) {
  const vertices = meshVertices(vertexBuffer);
  const values: number[] = [];
  for (let quadStart = 0; quadStart < vertices.length; quadStart += VERTICES_PER_QUAD) {
    const quad = vertices.slice(quadStart, quadStart + VERTICES_PER_QUAD);
    const isFlatInPlane = quad.every((vertex) => vertex.y === position[1]);
    if (!isFlatInPlane) continue;
    for (const vertex of quad) {
      const isAtPosition = vertex.x === position[0] && vertex.z === position[2];
      if (isAtPosition) values.push(vertex.ambientOcclusion);
    }
  }
  return values;
}

describe("generateMesh ambient occlusion", () => {
  const floor: Array<[number, number, number, BlockType]> = [];
  for (let x = 3; x <= 7; x++) {
    for (let z = 3; z <= 7; z++) floor.push([x, 4, z, BlockType.STONE]);
  }
  const mesh = meshFloorWithPillar([...floor, [5, 5, 5, BlockType.STONE]]);

  test("floor corners touching a pillar are darkened", () => {
    const values = topFaceOcclusionAt(mesh.opaque, [5, 5, 5]);
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const value of values) expect(value).toBe(2);
  });

  test("open floor stays fully bright", () => {
    const values = topFaceOcclusionAt(mesh.opaque, [3, 5, 3]);
    expect(values.length).toBeGreaterThanOrEqual(1);
    for (const value of values) expect(value).toBe(3);
  });

  test("a concave floor to wall seam is darker than a lone corner", () => {
    const wall: Array<[number, number, number, BlockType]> = [];
    for (let z = 3; z <= 7; z++) wall.push([5, 5, z, BlockType.STONE]);
    const seamMesh = meshFloorWithPillar([...floor, ...wall]);
    const seamValues = topFaceOcclusionAt(seamMesh.opaque, [5, 5, 5]);
    expect(Math.max(...seamValues)).toBeLessThan(3);
    expect(Math.min(...seamValues)).toBeLessThanOrEqual(2);
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

    const topFaceOfBlock = meshVertices(mesh.opaque).filter(
      (vertex) => vertex.y === 5 && vertex.x >= 4 && vertex.x <= 5 && vertex.z >= 5 && vertex.z <= 6
    );
    const lightByX = new Map<number, number>();
    for (const vertex of topFaceOfBlock) lightByX.set(vertex.x, vertex.light);

    expect(lightByX.get(4)).toBe(4);
    expect(lightByX.get(5)).toBeGreaterThan(4);
    expect(lightByX.get(5)).toBeLessThan(15);
    expect(Number.isInteger(lightByX.get(5)! * 4)).toBe(true);
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
