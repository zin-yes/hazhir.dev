// Cheap ground-height lookups (noise fill only, no biomes-to-surface work) for lighting estimates and spawning.

import { GAME_Y_OFFSET } from "./constants";
import { getTerrainOnlyGenerator } from "./overworld-world";

/** Game y of the highest solid block in a column, ignoring water, plants and trees. */
export function createSurfaceHeightSampler(seed: number): (blockX: number, blockZ: number) => number {
  const generator = getTerrainOnlyGenerator(seed);
  return (blockX, blockZ) => generator.surfaceHeight(blockX, blockZ, "OCEAN_FLOOR_WG") - 1 + GAME_Y_OFFSET;
}
