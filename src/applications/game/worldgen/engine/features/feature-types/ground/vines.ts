// Mirrors VinesFeature (minecraft:vines): a vine on the first non-downward face of the origin that has an
// attachable neighbor (VineBlock.isAcceptableNeighbour is MultifaceBlock.canAttachTo).

import { Direction } from "../../core/direction";
import { defineFeatureType } from "../../feature/feature-type";
import { canAttachTo } from "./support/block-faces";

export const vinesFeature = defineFeatureType<undefined>({
  id: "minecraft:vines",
  parseConfig: () => undefined,
  place({ level, origin }) {
    if (!level.isEmptyBlock(origin.x, origin.y, origin.z)) return false;
    for (const direction of Direction.VALUES) {
      if (direction === Direction.DOWN) continue;
      if (!canAttachTo(level, direction, origin.x + direction.stepX, origin.y + direction.stepY, origin.z + direction.stepZ)) continue;
      const vine = level.blockStates.withProperty(level.blockStates.defaultState("minecraft:vine"), direction.name, "true");
      level.setBlock(origin.x, origin.y, origin.z, vine, 2);
      return true;
    }
    return false;
  },
});
