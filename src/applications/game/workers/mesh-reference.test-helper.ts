/**
 * Test-only reference mesher and quad sampler. The reference builds one quad per
 * visible cube face the plain way (no padding tricks, no bitmasks, no merging) so
 * tests can check that the production mesher draws the same surface.
 */
import {
  BLOCK_TEXTURES,
  BlockType,
  TRANSLUCENT_BLOCKS,
  TRANSPARENT_BLOCKS,
  getWaterLevel,
  isSlab,
  isStairs,
  isTopSlab,
  isWater,
} from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { CHUNK_UV_UNITS_PER_BLOCK, WORDS_PER_VERTEX, unpackVertex } from "../vertex-format";
import type { ChunkFaceBuffers } from "./mesh-types";
import { isPlantVoxelBlock } from "./plant-voxels";

export interface SurfaceCorner {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  ambientOcclusion: number;
  light: number;
}

/** Four corners in draw order: triangles (0 1 2) and (2 1 3). */
export interface SurfaceQuad {
  corners: SurfaceCorner[];
  textureIndex: number;
}

interface ReferenceInput {
  chunk: Uint8Array;
  light: Uint8Array;
  borders?: ChunkFaceBuffers;
  borderLights?: ChunkFaceBuffers;
}

const FACE_NORMALS = [
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [-1, 0, 0],
  [1, 0, 0],
];
const FACE_BORDER_NAMES: Array<keyof ChunkFaceBuffers> = ["top", "bottom", "front", "back", "left", "right"];
const FACE_TEXTURE_KEYS = ["TOP_FACE", "BOTTOM_FACE", "FRONT_FACE", "BACK_FACE", "LEFT_FACE", "RIGHT_FACE"] as const;
const FACE_FALLS_BACK_TO_SIDES = [false, false, true, true, true, true];

const FACE_CORNERS = [
  [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]],
  [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]],
  [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]],
  [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]],
];

// Texture coordinates per face corner as [u, v]; "top" and "bottom" are the block's rows.
const UV_ZERO = "zero";
const UV_ONE = "one";
const UV_ROW_TOP = "rowTop";
const UV_ROW_BOTTOM = "rowBottom";
const FACE_UV_CODES = [
  [[UV_ONE, UV_ONE], [UV_ZERO, UV_ONE], [UV_ONE, UV_ZERO], [UV_ZERO, UV_ZERO]],
  [[UV_ONE, UV_ZERO], [UV_ZERO, UV_ZERO], [UV_ONE, UV_ONE], [UV_ZERO, UV_ONE]],
  [[UV_ONE, UV_ROW_BOTTOM], [UV_ZERO, UV_ROW_BOTTOM], [UV_ONE, UV_ROW_TOP], [UV_ZERO, UV_ROW_TOP]],
  [[UV_ONE, UV_ROW_BOTTOM], [UV_ZERO, UV_ROW_BOTTOM], [UV_ONE, UV_ROW_TOP], [UV_ZERO, UV_ROW_TOP]],
  [[UV_ZERO, UV_ROW_TOP], [UV_ZERO, UV_ROW_BOTTOM], [UV_ONE, UV_ROW_TOP], [UV_ONE, UV_ROW_BOTTOM]],
  [[UV_ZERO, UV_ROW_TOP], [UV_ZERO, UV_ROW_BOTTOM], [UV_ONE, UV_ROW_TOP], [UV_ONE, UV_ROW_BOTTOM]],
];

const isTransparent = (block: number) => TRANSPARENT_BLOCKS.includes(block);
const isTranslucent = (block: number) => TRANSLUCENT_BLOCKS.includes(block);
const occludesAmbientLight = (block: number) =>
  block !== BlockType.AIR && !isTransparent(block) && !isTranslucent(block);

function isFaceCulled(block: number, neighbor: number, face: number): boolean {
  const isUp = face === 0;
  const isDown = face === 1;
  if (neighbor === BlockType.AIR) return false;
  if (isUp && isSlab(block) && !isTopSlab(block)) return false;
  if (isDown && isTopSlab(block)) return false;
  if (isDown && isSlab(neighbor) && !isTopSlab(neighbor)) return false;
  if (isUp && isTopSlab(neighbor)) return false;
  if (!isTransparent(neighbor)) return true;
  if (isSlab(block) && isSlab(neighbor) && !isUp && !isDown) return isTopSlab(block) === isTopSlab(neighbor);
  if (isWater(block) && isWater(neighbor)) return true;
  if (block === BlockType.GLASS && neighbor === BlockType.GLASS) return true;
  return false;
}

function textureOf(block: number, face: number): number {
  const textures = BLOCK_TEXTURES[block];
  const faceTexture = textures[FACE_TEXTURE_KEYS[face]];
  if (faceTexture) return faceTexture;
  if (FACE_FALLS_BACK_TO_SIDES[face] && textures.SIDES) return textures.SIDES;
  return textures.DEFAULT ?? 0;
}

/** True for blocks the mesher draws as ordinary (possibly short) cubes. */
export function isCubeLikeBlock(block: number): boolean {
  return block !== BlockType.AIR && !isPlantVoxelBlock(block) && !isStairs(block);
}

export function buildReferenceQuads({ chunk, light, borders = {}, borderLights = {} }: ReferenceInput): SurfaceQuad[] {
  const slabs = (group: ChunkFaceBuffers) =>
    FACE_BORDER_NAMES.map((face) => (group[face] ? new Uint8Array(group[face]!) : undefined));
  const blockSlabs = slabs(borders);
  const lightSlabs = slabs(borderLights);

  // Cell value from the chunk, else from the slab of the one neighbor chunk it lies in.
  const readCell = (
    chunkValues: Uint8Array,
    slabValues: Array<Uint8Array | undefined>,
    x: number,
    y: number,
    z: number
  ): number | undefined => {
    const isInside = x >= 0 && x < CHUNK_WIDTH && y >= 0 && y < CHUNK_HEIGHT && z >= 0 && z < CHUNK_LENGTH;
    if (isInside) return chunkValues[x * CHUNK_HEIGHT * CHUNK_LENGTH + y * CHUNK_LENGTH + z];
    const outsideAxes = Number(x < 0 || x >= CHUNK_WIDTH) + Number(y < 0 || y >= CHUNK_HEIGHT) + Number(z < 0 || z >= CHUNK_LENGTH);
    if (outsideAxes > 1) return undefined;
    if (y >= CHUNK_HEIGHT) return slabValues[0]?.[x * CHUNK_LENGTH + z];
    if (y < 0) return slabValues[1]?.[x * CHUNK_LENGTH + z];
    if (z >= CHUNK_LENGTH) return slabValues[2]?.[x * CHUNK_HEIGHT + y];
    if (z < 0) return slabValues[3]?.[x * CHUNK_HEIGHT + y];
    if (x < 0) return slabValues[4]?.[y * CHUNK_LENGTH + z];
    return slabValues[5]?.[y * CHUNK_LENGTH + z];
  };
  const blockAt = (x: number, y: number, z: number) => readCell(chunk, blockSlabs, x, y, z) ?? BlockType.AIR;
  const lightLevelAt = (x: number, y: number, z: number): number | undefined => {
    const packed = readCell(light, lightSlabs, x, y, z);
    return packed === undefined ? undefined : Math.max(packed >> 4, packed & 15);
  };

  const quads: SurfaceQuad[] = [];
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const block = blockAt(x, y, z);
        if (!isCubeLikeBlock(block)) continue;
        const ownLevel = lightLevelAt(x, y, z)!;
        const receivesOcclusion = !isTranslucent(block);

        let height = 1;
        if (isSlab(block)) height = 0.5;
        else if (isWater(block) && !isWater(blockAt(x, y + 1, z))) height = Math.round((getWaterLevel(block) / 9) * 16) / 16;
        const bottom = y + (isTopSlab(block) ? 0.5 : 0);
        const top = bottom + height;
        let rowTopV = 0;
        let rowBottomV = 1;
        if (isSlab(block)) {
          if (isTopSlab(block)) rowBottomV = 0.5;
          else rowTopV = 0.5;
        }

        FACE_NORMALS.forEach((normal, face) => {
          if (isFaceCulled(block, blockAt(x + normal[0], y + normal[1], z + normal[2]), face)) return;
          const faceNeighbor = [x + normal[0], y + normal[1], z + normal[2]] as const;
          const faceLevel = occludesAmbientLight(blockAt(...faceNeighbor))
            ? ownLevel
            : (lightLevelAt(...faceNeighbor) ?? ownLevel);
          const [firstTangent, secondTangent] = [0, 1, 2].filter((axis) => normal[axis] === 0);

          const corners: SurfaceCorner[] = FACE_CORNERS[face].map((flags, cornerIndex) => {
            const firstStep = [0, 0, 0];
            firstStep[firstTangent] = flags[firstTangent] === 1 ? 1 : -1;
            const secondStep = [0, 0, 0];
            secondStep[secondTangent] = flags[secondTangent] === 1 ? 1 : -1;
            const sampleOffsets = [
              [normal[0] + firstStep[0], normal[1] + firstStep[1], normal[2] + firstStep[2]],
              [normal[0] + secondStep[0], normal[1] + secondStep[1], normal[2] + secondStep[2]],
              [
                normal[0] + firstStep[0] + secondStep[0],
                normal[1] + firstStep[1] + secondStep[1],
                normal[2] + firstStep[2] + secondStep[2],
              ],
            ];
            const sampleBlocked = sampleOffsets.map(([dx, dy, dz]) => occludesAmbientLight(blockAt(x + dx, y + dy, z + dz)));

            let ambientOcclusion = 3;
            if (receivesOcclusion) {
              ambientOcclusion = sampleBlocked[0] && sampleBlocked[1] ? 0 : 3 - sampleBlocked.filter(Boolean).length;
            }
            let lightSum = faceLevel;
            let lightCells = 1;
            sampleOffsets.forEach(([dx, dy, dz], sample) => {
              if (sampleBlocked[sample]) return;
              const level = lightLevelAt(x + dx, y + dy, z + dz);
              if (level === undefined) return;
              lightSum += level;
              lightCells++;
            });

            const [uCode, vCode] = FACE_UV_CODES[face][cornerIndex];
            const v = vCode === UV_ONE ? 1 : vCode === UV_ROW_TOP ? rowTopV : vCode === UV_ROW_BOTTOM ? rowBottomV : 0;
            return {
              x: x + flags[0],
              y: flags[1] ? top : bottom,
              z: z + flags[2],
              u: uCode === UV_ONE ? 1 : 0,
              v,
              ambientOcclusion,
              light: Math.round((lightSum * 4) / lightCells) / 4,
            };
          });

          const flipDiagonal =
            corners[0].ambientOcclusion + corners[3].ambientOcclusion >
            corners[1].ambientOcclusion + corners[2].ambientOcclusion;
          quads.push({
            corners: flipDiagonal ? [corners[1], corners[3], corners[0], corners[2]] : corners,
            textureIndex: textureOf(block, face),
          });
        });
      }
    }
  }
  return quads;
}

/** Decodes a vertex buffer into quads of block-unit corners; u and v stay unwrapped. */
export function decodeSurfaceQuads(vertexBuffer: ArrayBuffer): SurfaceQuad[] {
  const words = new Uint32Array(vertexBuffer);
  const quads: SurfaceQuad[] = [];
  for (let quadStart = 0; quadStart < words.length; quadStart += 4 * WORDS_PER_VERTEX) {
    const corners: SurfaceCorner[] = [];
    let textureIndex = 0;
    for (let corner = 0; corner < 4; corner++) {
      const vertex = unpackVertex(
        words[quadStart + corner * WORDS_PER_VERTEX],
        words[quadStart + corner * WORDS_PER_VERTEX + 1],
        CHUNK_UV_UNITS_PER_BLOCK
      );
      textureIndex = vertex.textureIndex;
      corners.push({
        x: vertex.x,
        y: vertex.y,
        z: vertex.z,
        u: vertex.u,
        v: vertex.v,
        ambientOcclusion: vertex.ambientOcclusion,
        light: vertex.light,
      });
    }
    quads.push({ corners, textureIndex });
  }
  return quads;
}

/** An axis aligned quad as a rectangle in its plane, with the attributes to interpolate. */
export interface PlaneRectangle {
  planeKey: string;
  minFirst: number;
  maxFirst: number;
  minSecond: number;
  maxSecond: number;
  firstAxis: number;
  secondAxis: number;
  quad: SurfaceQuad;
}

const coordinateOf = (corner: SurfaceCorner, axis: number) => [corner.x, corner.y, corner.z][axis];

export function toPlaneRectangle(quad: SurfaceQuad): PlaneRectangle {
  const planeAxis = [0, 1, 2].find((axis) => quad.corners.every((corner) => coordinateOf(corner, axis) === coordinateOf(quad.corners[0], axis)));
  if (planeAxis === undefined) throw new Error("quad is not axis aligned");
  const [firstAxis, secondAxis] = [0, 1, 2].filter((axis) => axis !== planeAxis);
  const [first, second, third] = quad.corners;
  const edgeOne = [0, 1, 2].map((axis) => coordinateOf(second, axis) - coordinateOf(first, axis));
  const edgeTwo = [0, 1, 2].map((axis) => coordinateOf(third, axis) - coordinateOf(first, axis));
  const normal = [
    edgeOne[1] * edgeTwo[2] - edgeOne[2] * edgeTwo[1],
    edgeOne[2] * edgeTwo[0] - edgeOne[0] * edgeTwo[2],
    edgeOne[0] * edgeTwo[1] - edgeOne[1] * edgeTwo[0],
  ];
  const direction = Math.sign(normal[planeAxis]);
  const firsts = quad.corners.map((corner) => coordinateOf(corner, firstAxis));
  const seconds = quad.corners.map((corner) => coordinateOf(corner, secondAxis));
  return {
    planeKey: `${planeAxis}:${coordinateOf(first, planeAxis)}:${direction}`,
    minFirst: Math.min(...firsts),
    maxFirst: Math.max(...firsts),
    minSecond: Math.min(...seconds),
    maxSecond: Math.max(...seconds),
    firstAxis,
    secondAxis,
    quad,
  };
}

export interface SurfaceSample {
  textureIndex: number;
  ambientOcclusion: number;
  light: number;
  u: number;
  v: number;
}

/** Attributes at a point of the quad's plane, interpolated over the triangles (0 1 2) and (2 1 3) like the GPU does. */
export function sampleRectangle(rectangle: PlaneRectangle, first: number, second: number): SurfaceSample | undefined {
  const { quad, firstAxis, secondAxis } = rectangle;
  const triangles = [
    [0, 1, 2],
    [2, 1, 3],
  ];
  for (const [aIndex, bIndex, cIndex] of triangles) {
    const a = quad.corners[aIndex];
    const b = quad.corners[bIndex];
    const c = quad.corners[cIndex];
    const [aFirst, aSecond] = [coordinateOf(a, firstAxis), coordinateOf(a, secondAxis)];
    const [bFirst, bSecond] = [coordinateOf(b, firstAxis), coordinateOf(b, secondAxis)];
    const [cFirst, cSecond] = [coordinateOf(c, firstAxis), coordinateOf(c, secondAxis)];
    const determinant = (bSecond - cSecond) * (aFirst - cFirst) + (cFirst - bFirst) * (aSecond - cSecond);
    const weightA = ((bSecond - cSecond) * (first - cFirst) + (cFirst - bFirst) * (second - cSecond)) / determinant;
    const weightB = ((cSecond - aSecond) * (first - cFirst) + (aFirst - cFirst) * (second - cSecond)) / determinant;
    const weightC = 1 - weightA - weightB;
    const epsilon = -1e-9;
    if (weightA < epsilon || weightB < epsilon || weightC < epsilon) continue;
    const blend = (attribute: (corner: SurfaceCorner) => number) =>
      weightA * attribute(a) + weightB * attribute(b) + weightC * attribute(c);
    return {
      textureIndex: quad.textureIndex,
      ambientOcclusion: blend((corner) => corner.ambientOcclusion),
      light: blend((corner) => corner.light),
      u: blend((corner) => corner.u),
      v: blend((corner) => corner.v),
    };
  }
  return undefined;
}

export function indexByPlane(quads: SurfaceQuad[]): Map<string, PlaneRectangle[]> {
  const planes = new Map<string, PlaneRectangle[]>();
  for (const quad of quads) {
    const rectangle = toPlaneRectangle(quad);
    const list = planes.get(rectangle.planeKey);
    if (list) list.push(rectangle);
    else planes.set(rectangle.planeKey, [rectangle]);
  }
  return planes;
}

export function findCovering(
  planes: Map<string, PlaneRectangle[]>,
  planeKey: string,
  first: number,
  second: number
): PlaneRectangle | undefined {
  return planes
    .get(planeKey)
    ?.find(
      (rectangle) =>
        first > rectangle.minFirst &&
        first < rectangle.maxFirst &&
        second > rectangle.minSecond &&
        second < rectangle.maxSecond
    );
}
