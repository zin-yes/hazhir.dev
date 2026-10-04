// Mirrors BambooFeature (minecraft:bamboo): a podzol disc around the origin (with probability), then a stalk of
// 5..16 bamboo blocks capped by large and small leaves.

import { defineFeatureType } from "../../feature/feature-type";
import { asObject, requireNumber } from "../../providers/json-fields";

const fround = Math.fround;

const BAMBOO_TRUNK = "minecraft:bamboo[age=1,leaves=none,stage=0]";
const BAMBOO_FINAL_LARGE = "minecraft:bamboo[age=1,leaves=large,stage=1]";
const BAMBOO_TOP_LARGE = "minecraft:bamboo[age=1,leaves=large,stage=0]";
const BAMBOO_TOP_SMALL = "minecraft:bamboo[age=1,leaves=small,stage=0]";

export const bambooFeature = defineFeatureType<{ readonly probability: number }>({
  id: "minecraft:bamboo",
  parseConfig(json) {
    return { probability: fround(requireNumber(asObject(json, "bamboo config"), "probability", "bamboo")) };
  },
  place({ config, level, random, origin }) {
    if (!level.isEmptyBlock(origin.x, origin.y, origin.z)) return false;
    if (level.survival.canSurvive(level.blockStates.defaultState("minecraft:bamboo"), level, origin.x, origin.y, origin.z)) {
      const stalkHeight = random.nextIntBounded(12) + 5;
      if (random.nextFloat() < config.probability) {
        const podzolRadius = random.nextIntBounded(4) + 1;
        for (let x = origin.x - podzolRadius; x <= origin.x + podzolRadius; x++) {
          for (let z = origin.z - podzolRadius; z <= origin.z + podzolRadius; z++) {
            const deltaX = x - origin.x;
            const deltaZ = z - origin.z;
            if (deltaX * deltaX + deltaZ * deltaZ > podzolRadius * podzolRadius) continue;
            const surfaceY = level.getHeight("WORLD_SURFACE", x, z) - 1;
            if (level.blockTags.is(level.getBlockInfo(x, surfaceY, z).name, "minecraft:dirt")) level.setBlock(x, surfaceY, z, "minecraft:podzol[snowy=false]", 2);
          }
        }
      }
      let y = origin.y;
      for (let placed = 0; placed < stalkHeight && level.isEmptyBlock(origin.x, y, origin.z); placed++) {
        level.setBlock(origin.x, y, origin.z, BAMBOO_TRUNK, 2);
        y++;
      }
      if (y - origin.y >= 3) {
        level.setBlock(origin.x, y, origin.z, BAMBOO_FINAL_LARGE, 2);
        level.setBlock(origin.x, y - 1, origin.z, BAMBOO_TOP_LARGE, 2);
        level.setBlock(origin.x, y - 2, origin.z, BAMBOO_TOP_SMALL, 2);
      }
    }
    return true;
  },
});
