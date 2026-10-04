// Mirrors BlockPileFeature (minecraft:block_pile): a blob of the provided block, thicker toward the origin, placed
// on blocks that have a sturdy top face.

import { Direction } from "../../core/direction";
import { defineFeatureType } from "../../feature/feature-type";
import type { BlockStateProvider } from "../../providers/block-state-providers";
import { asObject } from "../../providers/json-fields";
import { isFaceSturdy } from "./support/block-faces";

const fround = Math.fround;

export const blockPileFeature = defineFeatureType<{ readonly stateProvider: BlockStateProvider }>({
  id: "minecraft:block_pile",
  parseConfig(json, parser) {
    return { stateProvider: parser.blockStateProvider(asObject(json, "block_pile config").state_provider, "block_pile.state_provider") };
  },
  place({ config, level, random, origin }) {
    if (origin.y < level.minY + 5) return false;
    const radiusX = 2 + random.nextIntBounded(2);
    const radiusZ = 2 + random.nextIntBounded(2);
    // BlockPos.betweenClosed iterates x fastest, then y, then z.
    for (let z = origin.z - radiusZ; z <= origin.z + radiusZ; z++) {
      for (let y = origin.y; y <= origin.y + 1; y++) {
        for (let x = origin.x - radiusX; x <= origin.x + radiusX; x++) {
          const deltaX = origin.x - x;
          const deltaZ = origin.z - z;
          const squaredDistance = fround(deltaX * deltaX + deltaZ * deltaZ);
          const firstDraw = fround(random.nextFloat() * 10);
          const secondDraw = fround(random.nextFloat() * 6);
          if (squaredDistance <= fround(firstDraw - secondDraw)) {
            tryPlaceBlock(x, y, z);
          } else if (random.nextFloat() < 0.031) {
            tryPlaceBlock(x, y, z);
          }
        }
      }
    }
    return true;

    function tryPlaceBlock(x: number, y: number, z: number): void {
      if (!level.isEmptyBlock(x, y, z) || !mayPlaceOn(x, y, z)) return;
      level.setBlock(x, y, z, config.stateProvider.getState(random, x, y, z), 4);
    }

    function mayPlaceOn(x: number, y: number, z: number): boolean {
      if (level.getBlockInfo(x, y - 1, z).name === "minecraft:dirt_path") return random.nextBoolean();
      return isFaceSturdy(level, x, y - 1, z, Direction.UP);
    }
  },
});
