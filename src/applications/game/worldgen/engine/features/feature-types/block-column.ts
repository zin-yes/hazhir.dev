// Mirrors BlockColumnFeature (minecraft:block_column): stacked layers of sampled heights along a direction,
// truncated (from the tip or the base) where allowed_placement stops holding.

import type { Direction } from "../core/direction";
import { defineFeatureType } from "../feature/feature-type";
import type { BlockPredicate } from "../providers/block-predicates";
import type { BlockStateProvider } from "../providers/block-state-providers";
import { asArray, asObject, optionalBoolean } from "../providers/json-fields";
import type { IntProvider } from "../providers/value-providers";

export interface BlockColumnConfig {
  readonly layers: ReadonlyArray<{ readonly height: IntProvider; readonly provider: BlockStateProvider }>;
  readonly direction: Direction;
  readonly allowedPlacement: BlockPredicate;
  readonly prioritizeTip: boolean;
}

/** BlockColumnFeature.truncate: remove `total - placeable` blocks, from the first layer when prioritizing the tip. */
function truncate(layerHeights: number[], totalHeight: number, placeableHeight: number, prioritizeTip: boolean): void {
  let toRemove = totalHeight - placeableHeight;
  const step = prioritizeTip ? 1 : -1;
  const start = prioritizeTip ? 0 : layerHeights.length - 1;
  const end = prioritizeTip ? layerHeights.length : -1;
  for (let index = start; index !== end && toRemove > 0; index += step) {
    const removed = Math.min(layerHeights[index]!, toRemove);
    layerHeights[index] = layerHeights[index]! - removed;
    toRemove -= removed;
  }
}

export const blockColumnFeature = defineFeatureType<BlockColumnConfig>({
  id: "minecraft:block_column",
  parseConfig(json, parser) {
    const config = asObject(json, "block_column config");
    return {
      layers: asArray(config.layers, "block_column.layers").map((layerJson, index) => {
        const layer = asObject(layerJson, `block_column.layers[${index}]`);
        return {
          height: parser.intProvider(layer.height, `block_column.layers[${index}].height`),
          provider: parser.blockStateProvider(layer.provider, `block_column.layers[${index}].provider`),
        };
      }),
      direction: parser.direction(config.direction, "block_column.direction"),
      allowedPlacement: parser.blockPredicate(config.allowed_placement, "block_column.allowed_placement"),
      prioritizeTip: optionalBoolean(config, "prioritize_tip", false),
    };
  },
  place({ config, level, random, origin }) {
    const layerHeights = config.layers.map((layer) => layer.height.sample(random));
    const totalHeight = layerHeights.reduce((sum, height) => sum + height, 0);
    if (totalHeight === 0) return false;
    const { stepX, stepY, stepZ } = config.direction;
    // The check position starts one step past the origin, exactly as the Java code (which never tests the origin).
    let checkX = origin.x + stepX;
    let checkY = origin.y + stepY;
    let checkZ = origin.z + stepZ;
    for (let placeable = 0; placeable < totalHeight; placeable++) {
      if (!config.allowedPlacement.test(level, checkX, checkY, checkZ)) {
        truncate(layerHeights, totalHeight, placeable, config.prioritizeTip);
        break;
      }
      checkX += stepX;
      checkY += stepY;
      checkZ += stepZ;
    }
    let placeX = origin.x;
    let placeY = origin.y;
    let placeZ = origin.z;
    for (let layerIndex = 0; layerIndex < config.layers.length; layerIndex++) {
      const layer = config.layers[layerIndex]!;
      for (let index = 0; index < layerHeights[layerIndex]!; index++) {
        level.setBlock(placeX, placeY, placeZ, layer.provider.getState(random, placeX, placeY, placeZ), 2);
        placeX += stepX;
        placeY += stepY;
        placeZ += stepZ;
      }
    }
    return true;
  },
});
