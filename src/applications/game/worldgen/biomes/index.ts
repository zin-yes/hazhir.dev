import { BiomeId, type BiomeDefinition } from "./biome-types";
import { COLD_BIOMES } from "./cold-biomes";
import { HIGHLAND_BIOMES } from "./highland-biomes";
import { TEMPERATE_BIOMES } from "./temperate-biomes";
import { WARM_BIOMES } from "./warm-biomes";
import { WATER_BIOMES } from "./water-biomes";

export { BiomeId } from "./biome-types";
export type { BiomeDefinition } from "./biome-types";

const ALL_BIOMES = [
  ...WATER_BIOMES,
  ...TEMPERATE_BIOMES,
  ...COLD_BIOMES,
  ...WARM_BIOMES,
  ...HIGHLAND_BIOMES,
];

export const BIOME_DEFINITIONS: Record<BiomeId, BiomeDefinition> = Object.fromEntries(
  ALL_BIOMES.map((biome) => [biome.id, biome]),
) as Record<BiomeId, BiomeDefinition>;
