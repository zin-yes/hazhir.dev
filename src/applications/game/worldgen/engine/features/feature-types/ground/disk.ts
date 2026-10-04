// Mirrors DiskFeature (minecraft:disk): every column within a horizontal radius of the origin has its blocks
// matching `target` replaced, from origin y + half_height down to origin y - half_height.

import { defineFeatureType } from "../../feature/feature-type";
import type { BlockPredicate } from "../../providers/block-predicates";
import { asObject, requireNumber } from "../../providers/json-fields";
import type { IntProvider } from "../../providers/value-providers";
import { parseRuleBasedBlockStateProvider, type RuleBasedBlockStateProvider } from "./rule-based-block-state-provider";

export interface DiskConfig {
  readonly stateProvider: RuleBasedBlockStateProvider;
  readonly target: BlockPredicate;
  readonly radius: IntProvider;
  readonly halfHeight: number;
}

export const diskFeature = defineFeatureType<DiskConfig>({
  id: "minecraft:disk",
  parseConfig(json, parser) {
    const config = asObject(json, "disk config");
    return {
      stateProvider: parseRuleBasedBlockStateProvider(config.state_provider, parser, "disk.state_provider"),
      target: parser.blockPredicate(config.target, "disk.target"),
      radius: parser.intProvider(config.radius, "disk.radius"),
      halfHeight: requireNumber(config, "half_height", "disk"),
    };
  },
  place({ config, level, random, origin }) {
    let placedAny = false;
    const topY = origin.y + config.halfHeight;
    const bottomExclusiveY = origin.y - config.halfHeight - 1;
    const radius = config.radius.sample(random);
    // BlockPos.betweenClosed iterates x fastest, then z (the y extent is a single layer).
    for (let z = origin.z - radius; z <= origin.z + radius; z++) {
      for (let x = origin.x - radius; x <= origin.x + radius; x++) {
        const deltaX = x - origin.x;
        const deltaZ = z - origin.z;
        if (deltaX * deltaX + deltaZ * deltaZ > radius * radius) continue;
        for (let y = topY; y > bottomExclusiveY; y--) {
          if (!config.target.test(level, x, y, z)) continue;
          level.setBlock(x, y, z, config.stateProvider.getState(level, random, x, y, z), 2);
          placedAny = true;
        }
      }
    }
    return placedAny;
  },
});
