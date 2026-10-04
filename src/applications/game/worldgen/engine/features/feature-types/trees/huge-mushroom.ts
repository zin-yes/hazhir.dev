// Mirrors AbstractHugeMushroomFeature with HugeRedMushroomFeature and HugeBrownMushroomFeature
// (minecraft:huge_red_mushroom, minecraft:huge_brown_mushroom).

import type { WorldGenLevel } from "../../level/world-gen-level";
import { defineFeatureType, type FeatureType } from "../../feature/feature-type";
import type { BlockStateProvider } from "../../providers/block-state-providers";
import { asObject, optionalNumber } from "../../providers/json-fields";
import type { RandomSource } from "../../../random";
import { BlockPos } from "../../core/block-pos";
import { endFeatureStep, startFeatureStep } from "../../profiling/feature-profiling";
import { isSolidRender } from "./block-behavior";
import { isDirtBlock, isLeavesBlock, isMushroomGrowBlock } from "./tree-world";
import { parseTreeStateProvider } from "./tree-world";

export interface HugeMushroomConfig {
  readonly capProvider: BlockStateProvider;
  readonly stemProvider: BlockStateProvider;
  readonly foliageRadius: number;
}

const BLOCK_UPDATE_FLAGS = 3;

function treeHeightOf(random: RandomSource): number {
  let height = random.nextIntBounded(3) + 4;
  if (random.nextIntBounded(12) === 0) height *= 2;
  return height;
}

function isValidPosition(level: WorldGenLevel, origin: BlockPos, height: number, config: HugeMushroomConfig, radiusForHeight: (height: number, radius: number) => number): boolean {
  if (origin.y < level.minY + 1 || origin.y + height + 1 >= level.minY + level.height) return false;
  const groundName = level.getBlockInfo(origin.x, origin.y - 1, origin.z).name;
  if (!isDirtBlock(level, groundName) && !isMushroomGrowBlock(level, groundName)) return false;
  for (let offsetY = 0; offsetY <= height; offsetY++) {
    const radius = radiusForHeight(offsetY, config.foliageRadius);
    for (let offsetX = -radius; offsetX <= radius; offsetX++) {
      for (let offsetZ = -radius; offsetZ <= radius; offsetZ++) {
        const info = level.getBlockInfo(origin.x + offsetX, origin.y + offsetY, origin.z + offsetZ);
        if (!info.isAir && !isLeavesBlock(level, info.name)) return false;
      }
    }
  }
  return true;
}

function placeStem(level: WorldGenLevel, random: RandomSource, origin: BlockPos, config: HugeMushroomConfig, height: number): void {
  for (let offsetY = 0; offsetY < height; offsetY++) {
    const y = origin.y + offsetY;
    if (isSolidRender(level, origin.x, y, origin.z)) continue;
    level.setBlock(origin.x, y, origin.z, config.stemProvider.getState(random, origin.x, origin.y, origin.z), BLOCK_UPDATE_FLAGS);
  }
}

function withMushroomFaces(level: WorldGenLevel, state: string, faces: ReadonlyArray<readonly [string, boolean]>): string {
  if (!faces.every(([property]) => level.blockStates.hasProperty(state, property))) return state;
  let result = state;
  for (const [property, value] of faces) result = level.blockStates.withProperty(result, property, value ? "true" : "false");
  return result;
}

function makeRedCap(level: WorldGenLevel, random: RandomSource, origin: BlockPos, height: number, config: HugeMushroomConfig): void {
  for (let offsetY = height - 3; offsetY <= height; offsetY++) {
    const capRadius = offsetY < height ? config.foliageRadius : config.foliageRadius - 1;
    const innerRadius = config.foliageRadius - 2;
    for (let offsetX = -capRadius; offsetX <= capRadius; offsetX++) {
      for (let offsetZ = -capRadius; offsetZ <= capRadius; offsetZ++) {
        const onXEdge = offsetX === -capRadius || offsetX === capRadius;
        const onZEdge = offsetZ === -capRadius || offsetZ === capRadius;
        if (offsetY < height && onXEdge === onZEdge) continue;
        const x = origin.x + offsetX;
        const y = origin.y + offsetY;
        const z = origin.z + offsetZ;
        if (isSolidRender(level, x, y, z)) continue;
        const state = withMushroomFaces(level, config.capProvider.getState(random, origin.x, origin.y, origin.z), [
          ["up", offsetY >= height - 1],
          ["west", offsetX < -innerRadius],
          ["east", offsetX > innerRadius],
          ["north", offsetZ < -innerRadius],
          ["south", offsetZ > innerRadius],
        ]);
        level.setBlock(x, y, z, state, BLOCK_UPDATE_FLAGS);
      }
    }
  }
}

function makeBrownCap(level: WorldGenLevel, random: RandomSource, origin: BlockPos, height: number, config: HugeMushroomConfig): void {
  const radius = config.foliageRadius;
  for (let offsetX = -radius; offsetX <= radius; offsetX++) {
    for (let offsetZ = -radius; offsetZ <= radius; offsetZ++) {
      const westEdge = offsetX === -radius;
      const eastEdge = offsetX === radius;
      const northEdge = offsetZ === -radius;
      const southEdge = offsetZ === radius;
      const onXEdge = westEdge || eastEdge;
      const onZEdge = northEdge || southEdge;
      if (onXEdge && onZEdge) continue;
      const x = origin.x + offsetX;
      const y = origin.y + height;
      const z = origin.z + offsetZ;
      if (isSolidRender(level, x, y, z)) continue;
      const west = westEdge || (onZEdge && offsetX === 1 - radius);
      const east = eastEdge || (onZEdge && offsetX === radius - 1);
      const north = northEdge || (onXEdge && offsetZ === 1 - radius);
      const south = southEdge || (onXEdge && offsetZ === radius - 1);
      const state = withMushroomFaces(level, config.capProvider.getState(random, origin.x, origin.y, origin.z), [
        ["west", west],
        ["east", east],
        ["north", north],
        ["south", south],
      ]);
      level.setBlock(x, y, z, state, BLOCK_UPDATE_FLAGS);
    }
  }
}

function defineHugeMushroomType(
  id: string,
  radiusForHeight: (height: number, radius: number) => number,
  makeCap: (level: WorldGenLevel, random: RandomSource, origin: BlockPos, height: number, config: HugeMushroomConfig) => void,
): FeatureType<HugeMushroomConfig> {
  return defineFeatureType<HugeMushroomConfig>({
    id,
    parseConfig(json, parser) {
      const config = asObject(json, `${id} config`);
      return {
        capProvider: parseTreeStateProvider(parser, config.cap_provider, `${id}.cap_provider`),
        stemProvider: parseTreeStateProvider(parser, config.stem_provider, `${id}.stem_provider`),
        foliageRadius: optionalNumber(config, "foliage_radius", 2),
      };
    },
    place({ level, random, origin, config }) {
      const height = treeHeightOf(random);
      const position = BlockPos.of(origin);
      startFeatureStep("feature.hugeMushroom.spaceCheck");
      const hasSpace = isValidPosition(level, position, height, config, radiusForHeight);
      endFeatureStep("feature.hugeMushroom.spaceCheck");
      if (!hasSpace) return false;
      const capMark = startFeatureStep("feature.hugeMushroom.cap", level);
      makeCap(level, random, position, height, config);
      endFeatureStep("feature.hugeMushroom.cap", level, capMark);
      const stemMark = startFeatureStep("feature.hugeMushroom.stem", level);
      placeStem(level, random, position, config, height);
      endFeatureStep("feature.hugeMushroom.stem", level, stemMark);
      return true;
    },
  });
}

/** HugeRedMushroomFeature.getTreeRadiusForHeight(-1, -1, radius, height): never positive for the validity check. */
export const hugeRedMushroomFeature = defineHugeMushroomType("minecraft:huge_red_mushroom", () => 0, makeRedCap);
/** HugeBrownMushroomFeature.getTreeRadiusForHeight: height <= 3 ? 0 : radius. */
export const hugeBrownMushroomFeature = defineHugeMushroomType("minecraft:huge_brown_mushroom", (height, radius) => (height <= 3 ? 0 : radius), makeBrownCap);
