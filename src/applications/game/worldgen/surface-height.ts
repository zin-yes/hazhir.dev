// Cheap ground-height lookups (noise fill only, no biomes-to-surface work) for lighting estimates, spawning and distant
// terrain: one block column at a time from the cell-corner densities, without filling chunks.

import { GAME_Y_OFFSET } from "./constants";
import { getTerrainHeightSampler, getTerrainOnlyGenerator } from "./overworld-world";

/** Game y of the highest solid block in a column, ignoring water, plants and trees. */
export function createSurfaceHeightSampler(seed: number): (blockX: number, blockZ: number) => number {
  const heights = getTerrainHeightSampler(seed);
  if (heights !== null) return (blockX, blockZ) => heights.oceanFloorHeight(blockX, blockZ) - 1 + GAME_Y_OFFSET;
  const generator = getTerrainOnlyGenerator(seed);
  return (blockX, blockZ) => generator.surfaceHeight(blockX, blockZ, "OCEAN_FLOOR_WG") - 1 + GAME_Y_OFFSET;
}
