// Mirrors TreeFeature (minecraft:tree): height rolls, free-space check, optional roots, trunk, foliage, tree
// decorators, then the leaf distance and shape updates over the bounding box of everything the tree wrote.

import type { RandomSource } from "../../../random";
import { BlockPos } from "../../core/block-pos";
import { defineFeatureType, type FeaturePlaceContext } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { JavaHashPositionSet } from "./java-hash-position-set";
import { parseTreeConfig } from "./tree-config";
import { TreeDecoratorContext } from "./tree-decorators";
import { type FoliageSetter, type TreeConfig } from "./tree-placement";
import { type TreeBoundingBox, updateLeaves, updateShapeAtEdge } from "./tree-post-processing";
import { isVine } from "./tree-world";

/** TreeFeature.BLOCK_UPDATE_FLAGS: the flags every tree write passes to WorldGenLevel.setBlock. */
const BLOCK_UPDATE_FLAGS = 19;

interface TreePlacementSets {
  readonly roots: JavaHashPositionSet;
  readonly logs: JavaHashPositionSet;
  readonly leaves: JavaHashPositionSet;
  readonly decorations: JavaHashPositionSet;
}

function createRecordingSetter(level: WorldGenLevel, set: JavaHashPositionSet) {
  return (x: number, y: number, z: number, state: string): boolean => {
    set.add(x, y, z);
    return level.setBlock(x, y, z, state, BLOCK_UPDATE_FLAGS);
  };
}

/** TreeFeature.getMaxFreeTreeHeight. */
function getMaxFreeTreeHeight(level: WorldGenLevel, treeHeight: number, trunkOrigin: BlockPos, config: TreeConfig): number {
  for (let offsetY = 0; offsetY <= treeHeight + 1; offsetY++) {
    const size = config.minimumSize.getSizeAtHeight(treeHeight, offsetY);
    for (let offsetX = -size; offsetX <= size; offsetX++) {
      for (let offsetZ = -size; offsetZ <= size; offsetZ++) {
        const x = trunkOrigin.x + offsetX;
        const y = trunkOrigin.y + offsetY;
        const z = trunkOrigin.z + offsetZ;
        if (config.trunkPlacer.isFree(level, x, y, z) && (config.ignoreVines || !isVine(level.getBlockInfo(x, y, z)))) continue;
        return offsetY - 2;
      }
    }
  }
  return treeHeight;
}

function doPlace(level: WorldGenLevel, random: RandomSource, origin: BlockPos, sets: TreePlacementSets, foliageSetter: FoliageSetter, config: TreeConfig): boolean {
  const treeHeight = config.trunkPlacer.getTreeHeight(random);
  const foliageHeight = config.foliagePlacer.foliageHeight(random, treeHeight);
  const trunkHeightBelowFoliage = treeHeight - foliageHeight;
  const foliageRadius = config.foliagePlacer.foliageRadius(random, trunkHeightBelowFoliage);
  const trunkOrigin = config.rootPlacer ? config.rootPlacer.getTrunkOrigin(origin, random) : origin;
  const lowestY = Math.min(origin.y, trunkOrigin.y);
  const highestY = Math.max(origin.y, trunkOrigin.y) + treeHeight + 1;
  if (lowestY < level.minY + 1 || highestY > level.minY + level.height) return false;
  const minClippedHeight = config.minimumSize.minClippedHeight;
  const freeTreeHeight = getMaxFreeTreeHeight(level, treeHeight, trunkOrigin, config);
  if (freeTreeHeight < treeHeight && (minClippedHeight === undefined || freeTreeHeight < minClippedHeight)) return false;
  const setRootBlock = createRecordingSetter(level, sets.roots);
  const setTrunkBlock = createRecordingSetter(level, sets.logs);
  if (config.rootPlacer && !config.rootPlacer.placeRoots({ level, random, config, setRootBlock }, origin, trunkOrigin)) return false;
  const attachments = config.trunkPlacer.placeTrunk({ level, random, config, setTrunkBlock }, freeTreeHeight, trunkOrigin);
  for (const attachment of attachments) {
    config.foliagePlacer.createFoliage({ level, random, config, foliageSetter }, freeTreeHeight, attachment, foliageHeight, foliageRadius);
  }
  return true;
}

function boundingBoxOf(sets: TreePlacementSets): TreeBoundingBox | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const set of [sets.roots, sets.logs, sets.leaves, sets.decorations]) {
    for (const position of set.values()) {
      if (position.x < minX) minX = position.x;
      if (position.y < minY) minY = position.y;
      if (position.z < minZ) minZ = position.z;
      if (position.x > maxX) maxX = position.x;
      if (position.y > maxY) maxY = position.y;
      if (position.z > maxZ) maxZ = position.z;
    }
  }
  return minX === Infinity ? undefined : { minX, minY, minZ, maxX, maxY, maxZ };
}

function placeTree({ level, random, origin, config }: FeaturePlaceContext<TreeConfig>): boolean {
  const sets: TreePlacementSets = { roots: new JavaHashPositionSet(), logs: new JavaHashPositionSet(), leaves: new JavaHashPositionSet(), decorations: new JavaHashPositionSet() };
  const foliageRecorder = createRecordingSetter(level, sets.leaves);
  const foliageSetter: FoliageSetter = {
    set: (x, y, z, state) => foliageRecorder(x, y, z, state),
    isSet: (x, y, z) => sets.leaves.contains(x, y, z),
  };
  const originPosition = BlockPos.of(origin);
  const placed = doPlace(level, random, originPosition, sets, foliageSetter, config);
  if (!placed || (sets.logs.isEmpty() && sets.leaves.isEmpty())) return false;
  if (config.decorators.length > 0) {
    const decoratorContext = new TreeDecoratorContext(level, createRecordingSetter(level, sets.decorations), random, originPosition, sets.logs, sets.leaves, sets.roots);
    for (const decorator of config.decorators) decorator.place(decoratorContext);
  }
  const box = boundingBoxOf(sets);
  if (!box) return false;
  const shape = updateLeaves(level, box, sets.logs, sets.decorations, sets.roots);
  updateShapeAtEdge(level, shape, box.minX, box.minY, box.minZ);
  return true;
}

export const treeFeature = defineFeatureType<TreeConfig>({
  id: "minecraft:tree",
  parseConfig: parseTreeConfig,
  place: placeTree,
});
