import { getTerrainOnlyGenerator } from "../../worldgen/overworld-world";
import { loadTerralithRegistries } from "../../worldgen/terralith/load-terralith-registries";

const SAMPLE_HEIGHT_ABOVE_SEA_LEVEL = 3;
const FALLBACK_DOWNFALL = 0.5;
const MAX_CACHED_SEEDS = 2;

const downfallByBiomeNameBySeed = new Map<number, Map<string, number>>();

function downfallCacheForSeed(seed: number): Map<string, number> {
  let downfallByBiomeName = downfallByBiomeNameBySeed.get(seed);
  if (downfallByBiomeName === undefined) {
    if (downfallByBiomeNameBySeed.size >= MAX_CACHED_SEEDS) {
      downfallByBiomeNameBySeed.delete(downfallByBiomeNameBySeed.keys().next().value as number);
    }
    downfallByBiomeName = new Map();
    downfallByBiomeNameBySeed.set(seed, downfallByBiomeName);
  }
  return downfallByBiomeName;
}

function lookupDownfall(biomeName: string): number {
  const { registries } = loadTerralithRegistries();
  const biomeDefinition = registries.biome[biomeName] ?? registries.biome[`minecraft:${biomeName}`];
  const downfall = Number(biomeDefinition?.downfall);
  return Number.isFinite(downfall) ? downfall : FALLBACK_DOWNFALL;
}

/**
 * Biome downfall (0..1 scaled to 0..255) on a square grid of world positions, row-major with
 * index = cellZ * gridCells + cellX. Cell centers sit at origin + cell * cellSizeBlocks, so grids whose origins
 * are multiples of cellSizeBlocks agree at shared world points.
 */
export function sampleHumidityGrid(
  seed: number,
  originBlockX: number,
  originBlockZ: number,
  cellSizeBlocks: number,
  gridCells: number,
): Uint8Array {
  const generator = getTerrainOnlyGenerator(seed);
  const sampleY = generator.settings.seaLevel + SAMPLE_HEIGHT_ABOVE_SEA_LEVEL;
  const downfallByBiomeName = downfallCacheForSeed(seed);
  const humidityBytes = new Uint8Array(gridCells * gridCells);
  for (let cellZ = 0; cellZ < gridCells; cellZ++) {
    for (let cellX = 0; cellX < gridCells; cellX++) {
      const biomeName = generator.biomeAt(
        originBlockX + cellX * cellSizeBlocks,
        sampleY,
        originBlockZ + cellZ * cellSizeBlocks,
      );
      let downfall = downfallByBiomeName.get(biomeName);
      if (downfall === undefined) {
        downfall = lookupDownfall(biomeName);
        downfallByBiomeName.set(biomeName, downfall);
      }
      humidityBytes[cellZ * gridCells + cellX] = Math.round(Math.min(1, Math.max(0, downfall)) * 255);
    }
  }
  return humidityBytes;
}
