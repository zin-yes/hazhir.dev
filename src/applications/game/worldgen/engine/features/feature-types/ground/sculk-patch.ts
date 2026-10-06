// Mirrors SculkPatchFeature (minecraft:sculk_patch): sculk charge cursors spread from the origin, then an optional
// catalyst and rare shriekers.

import { Direction } from "../../core/direction";
import { defineFeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { asObject, requireNumber } from "../../providers/json-fields";
import { addFeatureCounter, endFeatureStep, noteFeatureRejection, startFeatureStep } from "../../profiling/feature-profiling";
import type { IntProvider } from "../../providers/value-providers";
import { SculkSpreader } from "./sculk-spreader";
import { isCollisionShapeFullBlock, isFaceSturdy } from "./support/block-faces";

const fround = Math.fround;

export interface SculkPatchConfig {
  readonly chargeCount: number;
  readonly amountPerCharge: number;
  readonly spreadAttempts: number;
  readonly growthRounds: number;
  readonly spreadRounds: number;
  readonly extraRareGrowths: IntProvider;
  readonly catalystChance: number;
}

/** SculkPatchFeature.canSpreadFrom. */
function canSpreadFrom(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  if (info.name === "minecraft:sculk" || info.name === "minecraft:sculk_vein") return true;
  const isAirOrSourceWater = info.isAir || (info.name === "minecraft:water" && info.fluid === "water");
  if (!isAirOrSourceWater) return false;
  return Direction.VALUES.some((direction) => isCollisionShapeFullBlock(level, x + direction.stepX, y + direction.stepY, z + direction.stepZ));
}

export const sculkPatchFeature = defineFeatureType<SculkPatchConfig>({
  id: "minecraft:sculk_patch",
  parseConfig(json, parser) {
    const config = asObject(json, "sculk_patch config");
    return {
      chargeCount: requireNumber(config, "charge_count", "sculk_patch"),
      amountPerCharge: requireNumber(config, "amount_per_charge", "sculk_patch"),
      spreadAttempts: requireNumber(config, "spread_attempts", "sculk_patch"),
      growthRounds: requireNumber(config, "growth_rounds", "sculk_patch"),
      spreadRounds: requireNumber(config, "spread_rounds", "sculk_patch"),
      extraRareGrowths: parser.intProvider(config.extra_rare_growths, "sculk_patch.extra_rare_growths"),
      catalystChance: fround(requireNumber(config, "catalyst_chance", "sculk_patch")),
    };
  },
  place({ config, level, random, origin }) {
    if (!canSpreadFrom(level, origin.x, origin.y, origin.z)) {
      noteFeatureRejection("cannotSpreadFromOrigin");
      return false;
    }
    const spreader = new SculkSpreader();
    const rounds = config.spreadRounds + config.growthRounds;
    const spreadMark = startFeatureStep("feature.sculk_patch.spread", level);
    for (let round = 0; round < rounds; round++) {
      for (let charge = 0; charge < config.chargeCount; charge++) spreader.addCursors(origin, config.amountPerCharge);
      const spread = round < config.spreadRounds;
      for (let attempt = 0; attempt < config.spreadAttempts; attempt++) spreader.updateCursors(level, origin, random, spread);
      spreader.clear();
    }
    endFeatureStep("feature.sculk_patch.spread", level, spreadMark);
    addFeatureCounter("feature.sculk_patch.cursorUpdates", spreader.cursorUpdateCount);
    if (random.nextFloat() <= config.catalystChance && isCollisionShapeFullBlock(level, origin.x, origin.y - 1, origin.z)) {
      level.setBlock(origin.x, origin.y, origin.z, level.blockStates.defaultState("minecraft:sculk_catalyst"), 3);
    }
    const rareGrowthCount = config.extraRareGrowths.sample(random);
    for (let growth = 0; growth < rareGrowthCount; growth++) {
      const x = origin.x + (random.nextIntBounded(5) - 2);
      const z = origin.z + (random.nextIntBounded(5) - 2);
      if (!level.getBlockInfo(x, origin.y, z).isAir || !isFaceSturdy(level, x, origin.y - 1, z, Direction.UP)) continue;
      level.setBlock(x, origin.y, z, level.blockStates.withProperty(level.blockStates.defaultState("minecraft:sculk_shrieker"), "can_summon", "true"), 3);
    }
    return true;
  },
});
