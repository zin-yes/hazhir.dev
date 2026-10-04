// Mirrors SpringFeature (minecraft:spring_feature): a fluid source where exactly `rock_count` of the five horizontal
// and downward neighbors are valid blocks and `hole_count` of them are empty.

import { defineFeatureType } from "../../feature/feature-type";
import type { BlockSet } from "../../providers/block-predicates";
import { asObject, optionalBoolean, optionalNumber } from "../../providers/json-fields";
import { parseFluidStateAsLegacyBlock } from "./support/fluid-state";

export interface SpringConfig {
  /** FluidState.createLegacyBlock of the configured fluid state. */
  readonly legacyBlockState: string;
  readonly requiresBlockBelow: boolean;
  readonly rockCount: number;
  readonly holeCount: number;
  readonly validBlocks: BlockSet;
}

const NEIGHBOR_OFFSETS = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, -1, 0],
] as const;

export const springFeature = defineFeatureType<SpringConfig>({
  id: "minecraft:spring_feature",
  parseConfig(json, parser) {
    const config = asObject(json, "spring_feature config");
    return {
      legacyBlockState: parseFluidStateAsLegacyBlock(config.state, "spring_feature.state"),
      requiresBlockBelow: optionalBoolean(config, "requires_block_below", true),
      rockCount: optionalNumber(config, "rock_count", 4),
      holeCount: optionalNumber(config, "hole_count", 1),
      validBlocks: parser.blockSet(config.valid_blocks, "spring_feature.valid_blocks"),
    };
  },
  place({ config, level, origin }) {
    const { x, y, z } = origin;
    const isValid = (blockX: number, blockY: number, blockZ: number) => config.validBlocks.contains(level, level.getBlockInfo(blockX, blockY, blockZ).name);
    if (!isValid(x, y + 1, z)) return false;
    if (config.requiresBlockBelow && !isValid(x, y - 1, z)) return false;
    const current = level.getBlockInfo(x, y, z);
    if (!current.isAir && !config.validBlocks.contains(level, current.name)) return false;
    let rockCount = 0;
    let holeCount = 0;
    for (const [offsetX, offsetY, offsetZ] of NEIGHBOR_OFFSETS) if (isValid(x + offsetX, y + offsetY, z + offsetZ)) rockCount++;
    for (const [offsetX, offsetY, offsetZ] of NEIGHBOR_OFFSETS) if (level.isEmptyBlock(x + offsetX, y + offsetY, z + offsetZ)) holeCount++;
    if (rockCount !== config.rockCount || holeCount !== config.holeCount) return false;
    level.setBlock(x, y, z, config.legacyBlockState, 2);
    return true;
  },
});
