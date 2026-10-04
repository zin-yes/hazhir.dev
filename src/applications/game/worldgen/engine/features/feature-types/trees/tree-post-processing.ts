// The last part of TreeFeature.place: TreeFeature.updateLeaves (leaf `distance` from the nearest log, a bucketed
// breadth first search over a BitSetDiscreteVoxelShape) and StructureTemplate.updateShapeAtEdge (neighbor
// updates along the faces of the placed tree). Of the neighbor updates only the ones that can change a block in
// a tree's surroundings are ported: plants, torches, carpets and the like that become air when their support
// disappears (directions recorded from the real classes, survival from SurvivalRules) and DoublePlantBlock's
// orphaned-half rule, plus VineBlock.updateShape. Leaves and waterlogged blocks only schedule ticks there.

import { blockNameOf } from "../../../chunk";
import { Direction } from "../../core/direction";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { updateShapeAirMask } from "./block-behavior";
import { JavaHashPositionSet } from "./java-hash-position-set";
import { BitSetVoxelShape } from "./voxel-shape";
import { isLogBlock } from "./tree-world";

const BLOCK_UPDATE_FLAGS_KNOWN_SHAPE = 19;
const SHAPE_UPDATE_FLAGS = 3 & ~1;
const MAX_LEAF_DISTANCE = 7;
const AIR_STATE = "minecraft:air";

export interface TreeBoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

function isInside(box: TreeBoundingBox, x: number, y: number, z: number): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && z >= box.minZ && z <= box.maxZ;
}

/** LeavesBlock.getOptionalDistanceAt: 0 for logs, the `distance` property for blocks that have one. */
function optionalDistanceAt(level: WorldGenLevel, state: string, name: string): number | undefined {
  if (isLogBlock(level, name)) return 0;
  if (level.blockStates.hasProperty(state, "distance")) return Number(level.blockStates.propertiesOf(state).distance);
  return undefined;
}

export function updateLeaves(
  level: WorldGenLevel,
  box: TreeBoundingBox,
  logs: JavaHashPositionSet,
  decorations: JavaHashPositionSet,
  roots: JavaHashPositionSet,
): BitSetVoxelShape {
  const shape = new BitSetVoxelShape(box.maxX - box.minX + 1, box.maxY - box.minY + 1, box.maxZ - box.minZ + 1);
  const pendingByDistance: JavaHashPositionSet[] = [];
  for (let distance = 0; distance < MAX_LEAF_DISTANCE; distance++) pendingByDistance.push(new JavaHashPositionSet());
  for (const set of [decorations, roots]) {
    for (const position of set.values()) {
      if (isInside(box, position.x, position.y, position.z)) shape.fill(position.x - box.minX, position.y - box.minY, position.z - box.minZ);
    }
  }
  for (const log of logs.values()) pendingByDistance[0]!.add(log.x, log.y, log.z);
  let currentDistance = 0;
  while (currentDistance < MAX_LEAF_DISTANCE) {
    const position = pendingByDistance[currentDistance]!.pollFirst();
    if (!position) {
      currentDistance++;
      continue;
    }
    if (!isInside(box, position.x, position.y, position.z)) continue;
    if (currentDistance !== 0) {
      const state = level.getBlockState(position.x, position.y, position.z);
      level.setBlock(position.x, position.y, position.z, level.blockStates.withProperty(state, "distance", String(currentDistance)), BLOCK_UPDATE_FLAGS_KNOWN_SHAPE);
    }
    shape.fill(position.x - box.minX, position.y - box.minY, position.z - box.minZ);
    for (const direction of Direction.VALUES) {
      const neighborX = position.x + direction.stepX;
      const neighborY = position.y + direction.stepY;
      const neighborZ = position.z + direction.stepZ;
      if (!isInside(box, neighborX, neighborY, neighborZ) || shape.isFull(neighborX - box.minX, neighborY - box.minY, neighborZ - box.minZ)) continue;
      const neighborState = level.getBlockState(neighborX, neighborY, neighborZ);
      const neighborDistance = optionalDistanceAt(level, neighborState, level.getBlockInfo(neighborX, neighborY, neighborZ).name);
      if (neighborDistance === undefined) continue;
      const candidateDistance = Math.min(neighborDistance, currentDistance + 1);
      if (candidateDistance >= MAX_LEAF_DISTANCE) continue;
      pendingByDistance[candidateDistance]!.add(neighborX, neighborY, neighborZ);
      currentDistance = Math.min(currentDistance, candidateDistance);
    }
  }
  return shape;
}

/** DoublePlantBlock.updateShape (with BushBlock.updateShape: a block that cannot survive becomes air). */
function updateDoublePlantShape(level: WorldGenLevel, state: string, direction: Direction, neighborState: string, x: number, y: number, z: number): string {
  const half = level.blockStates.propertiesOf(state).half;
  const neighborIsOtherHalfOfSamePlant = blockNameOf(neighborState) === blockNameOf(state) && level.blockStates.propertiesOf(neighborState).half !== half;
  const lowerHalfLooksUp = (half === "lower") === (direction === Direction.UP);
  if (direction.axis === "y" && lowerHalfLooksUp && !neighborIsOtherHalfOfSamePlant) return AIR_STATE;
  if (half === "lower" && direction === Direction.DOWN && !level.survival.canSurvive(state, level, x, y, z)) return AIR_STATE;
  if (!level.survival.canSurvive(state, level, x, y, z)) return AIR_STATE;
  return state;
}

const VINE_NAME = "minecraft:vine";

/** MultifaceBlock.canAttachTo: the neighbor's face toward the vine is full (support shape, or the full collision cube of leaves). */
function isAcceptableVineNeighbour(level: WorldGenLevel, x: number, y: number, z: number, faceOfVine: Direction): boolean {
  const info = level.getBlockInfo(x, y, z);
  return info.isLeaves || (info.sturdyFaces & (1 << faceOfVine.opposite.ordinal)) !== 0;
}

/** VineBlock.updateShape: faces without support (or a vine above holding the same face) are dropped; no face left means air. */
function updateVineShape(level: WorldGenLevel, state: string, direction: Direction, x: number, y: number, z: number): string {
  if (direction === Direction.DOWN) return state;
  const catalog = level.blockStates;
  let updated = state;
  if (catalog.propertiesOf(updated).up === "true") {
    updated = catalog.withProperty(updated, "up", isAcceptableVineNeighbour(level, x, y + 1, z, Direction.DOWN) ? "true" : "false");
  }
  let aboveState: string | undefined;
  for (const face of Direction.HORIZONTAL) {
    if (catalog.propertiesOf(updated)[face.name] !== "true") continue;
    let supported = isAcceptableVineNeighbour(level, x + face.stepX, y, z + face.stepZ, face);
    if (!supported) {
      aboveState ??= level.getBlockState(x, y + 1, z);
      supported = blockNameOf(aboveState) === VINE_NAME && catalog.propertiesOf(aboveState)[face.name] === "true";
    }
    updated = catalog.withProperty(updated, face.name, supported ? "true" : "false");
  }
  const properties = catalog.propertiesOf(updated);
  const hasFaces = Direction.HORIZONTAL.some((face) => properties[face.name] === "true") || properties.up === "true";
  return hasFaces ? updated : AIR_STATE;
}

/** BlockState.updateShape for the blocks that turn into air when their support goes (see block-behavior.ts). */
function updateShapeOf(level: WorldGenLevel, state: string, direction: Direction, neighborState: string, x: number, y: number, z: number): string {
  if (blockNameOf(state) === VINE_NAME) return updateVineShape(level, state, direction, x, y, z);
  if (level.blockStates.info(state).isDoublePlant) return updateDoublePlantShape(level, state, direction, neighborState, x, y, z);
  const airMask = updateShapeAirMask(level, state);
  if (airMask === 0 || (airMask & (1 << direction.ordinal)) === 0) return state;
  return level.survival.canSurvive(state, level, x, y, z) ? state : AIR_STATE;
}

/** StructureTemplate.updateShapeAtEdge(level, 3, shape, minX, minY, minZ). */
export function updateShapeAtEdge(level: WorldGenLevel, shape: BitSetVoxelShape, minX: number, minY: number, minZ: number): void {
  shape.forAllFaces((direction, localX, localY, localZ) => {
    const x = minX + localX;
    const y = minY + localY;
    const z = minZ + localZ;
    const neighborX = x + direction.stepX;
    const neighborY = y + direction.stepY;
    const neighborZ = z + direction.stepZ;
    const state = level.getBlockState(x, y, z);
    const neighborState = level.getBlockState(neighborX, neighborY, neighborZ);
    const updatedState = updateShapeOf(level, state, direction, neighborState, x, y, z);
    if (updatedState !== state) level.setBlock(x, y, z, updatedState, SHAPE_UPDATE_FLAGS);
    const updatedNeighbor = updateShapeOf(level, neighborState, direction.opposite, updatedState, neighborX, neighborY, neighborZ);
    if (updatedNeighbor !== neighborState) level.setBlock(neighborX, neighborY, neighborZ, updatedNeighbor, SHAPE_UPDATE_FLAGS);
  });
}
