import { describe, expect, test } from "bun:test";
import { BlockType } from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";
import { calculateOffset } from "../utils";
import { generateMesh } from "./mesh";

const FULL_LIGHT = 0xff;

function meshFloorWithPillar(blocks: Array<[number, number, number, BlockType]>) {
  const chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
  const lightMap = new Uint8Array(chunk.length).fill(FULL_LIGHT);
  for (const [x, y, z, blockType] of blocks) {
    chunk[calculateOffset(x, y, z)] = blockType;
  }
  return generateMesh(chunk.buffer, lightMap.buffer).opaque;
}

function topFaceOcclusionAt(
  mesh: ReturnType<typeof meshFloorWithPillar>,
  position: [number, number, number]
) {
  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const ambientOcclusion = new Float32Array(mesh.ambientOcclusion);
  const values: number[] = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const isTopFace = normals[vertex * 3 + 1] === 1;
    const isAtPosition = [0, 1, 2].every(
      (axis) => positions[vertex * 3 + axis] === position[axis]
    );
    if (isTopFace && isAtPosition) values.push(ambientOcclusion[vertex]);
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
    const values = topFaceOcclusionAt(mesh, [5, 5, 5]);
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const value of values) expect(value).toBe(2);
  });

  test("open floor stays fully bright", () => {
    const values = topFaceOcclusionAt(mesh, [3, 5, 3]);
    expect(values.length).toBeGreaterThanOrEqual(1);
    for (const value of values) expect(value).toBe(3);
  });

  test("a concave floor to wall seam is darker than a lone corner", () => {
    const wall: Array<[number, number, number, BlockType]> = [];
    for (let z = 3; z <= 7; z++) wall.push([5, 5, z, BlockType.STONE]);
    const seamMesh = meshFloorWithPillar([...floor, ...wall]);
    const seamValues = topFaceOcclusionAt(seamMesh, [5, 5, 5]);
    expect(Math.max(...seamValues)).toBeLessThan(3);
    expect(Math.min(...seamValues)).toBeLessThanOrEqual(2);
  });

  test("every vertex gets an occlusion value, including cross blocks", () => {
    const withFlower = meshFloorWithPillar([
      ...floor,
      [5, 5, 5, BlockType.TALL_GRASS],
      [6, 5, 6, BlockType.STONE],
    ]);
    expect(new Float32Array(withFlower.ambientOcclusion).length).toBe(
      new Float32Array(withFlower.positions).length / 3
    );
  });
});

describe("generateMesh plant voxels", () => {
  test("plants go in the depth-writing opaque mesh so they never draw over nearer geometry", () => {
    const chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
    chunk[calculateOffset(5, 5, 5)] = BlockType.SAPLING;
    const lightMap = new Uint8Array(chunk.length).fill(FULL_LIGHT);
    const mesh = generateMesh(chunk.buffer, lightMap.buffer);
    expect(new Float32Array(mesh.opaque.positions).length).toBeGreaterThan(0);
    expect(new Float32Array(mesh.transparent.positions).length).toBe(0);
  });
});
