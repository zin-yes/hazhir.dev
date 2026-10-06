// Mirrors ReplaceBlobsFeature, registered as minecraft:netherrack_replace_blobs (vanilla basalt and blackstone blobs;
// Terralith reuses it to recolor terracotta and stone bands). ReplaceSphereConfiguration: target and replace states
// plus a radius provider. The target is matched by block (BlockState.is(Block)), not by exact state.

import { defineFeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { asObject } from "../../providers/json-fields";
import type { IntProvider } from "../../providers/value-providers";
import { addFeatureCounter, endFeatureStep, noteFeatureRejection, startFeatureStep } from "../../profiling/feature-profiling";
import { withinManhattan } from "./block-iteration";
import { parseBlockStateIgnoringUnknownProperties } from "./config-fields";

export interface ReplaceBlobsConfig {
  readonly targetBlockName: string;
  readonly replaceState: string;
  readonly radius: IntProvider;
}

/** ReplaceBlobsFeature.findTarget: first matching block walking down from the (clamped) origin. */
function findTarget(level: WorldGenLevel, x: number, startY: number, z: number, targetBlockName: string): number | undefined {
  let y = startY;
  while (y > level.minY + 1) {
    if (level.getBlockInfo(x, y, z).name === targetBlockName) return y;
    y--;
  }
  return undefined;
}

export const replaceBlobsFeature = defineFeatureType<ReplaceBlobsConfig>({
  id: "minecraft:netherrack_replace_blobs",
  parseConfig(json, parser) {
    const config = asObject(json, "netherrack_replace_blobs config");
    const target = parseBlockStateIgnoringUnknownProperties(config.target, parser, "netherrack_replace_blobs.target");
    return {
      targetBlockName: parser.blockStates.info(target).name,
      replaceState: parseBlockStateIgnoringUnknownProperties(config.state, parser, "netherrack_replace_blobs.state"),
      radius: parser.intProvider(config.radius, "netherrack_replace_blobs.radius"),
    };
  },
  place({ level, random, origin, config }) {
    const clampedY = Math.min(Math.max(origin.y, level.minY + 1), level.minY + level.height - 1);
    startFeatureStep("feature.replace_blobs.find");
    const targetY = findTarget(level, origin.x, clampedY, origin.z, config.targetBlockName);
    endFeatureStep("feature.replace_blobs.find");
    if (targetY === undefined) {
      noteFeatureRejection("noTargetBlock");
      return false;
    }
    const target = { x: origin.x, y: targetY, z: origin.z };
    const radiusX = config.radius.sample(random);
    const radiusY = config.radius.sample(random);
    const radiusZ = config.radius.sample(random);
    const maxRadius = Math.max(radiusX, Math.max(radiusY, radiusZ));
    let replacedAny = false;
    let scannedCellCount = 0;
    const replaceMark = startFeatureStep("feature.replace_blobs.replace", level);
    for (const position of withinManhattan(target, radiusX, radiusY, radiusZ)) {
      const manhattanDistance = Math.abs(position.x - target.x) + Math.abs(position.y - target.y) + Math.abs(position.z - target.z);
      if (manhattanDistance > maxRadius) break;
      scannedCellCount++;
      if (level.getBlockInfo(position.x, position.y, position.z).name !== config.targetBlockName) continue;
      level.setBlock(position.x, position.y, position.z, config.replaceState, 3);
      replacedAny = true;
    }
    endFeatureStep("feature.replace_blobs.replace", level, replaceMark);
    addFeatureCounter("feature.replace_blobs.scannedCells", scannedCellCount);
    return replacedAny;
  },
});
