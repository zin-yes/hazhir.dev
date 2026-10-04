// Mirrors net.minecraft.world.level.biome.MultiNoiseBiomeSource backed by Climate.ParameterList / Climate.RTree.
import type { JsonObject } from "../registry/datapack-loader";
import { ClimateRTree } from "./climate-rtree";
import {
  findBestParameterPointBruteForce,
  parseParameterPoints,
  targetToParameterArray,
  type ParameterPoint,
  type TargetPoint,
} from "./climate-parameter-list";

export class MultiNoiseBiomeSource {
  private readonly parameterPoints: ParameterPoint[];
  private readonly searchTree: ClimateRTree;

  /** @param biomeSourceJson the `generator.biome_source` object of a dimension (type minecraft:multi_noise with a direct `biomes` list).
   *  `reuseLastLeaf` enables vanilla's last-leaf search hint (faster for spatially coherent queries; ties then depend on query order). */
  constructor(biomeSourceJson: JsonObject, options: { reuseLastLeaf?: boolean } = {}) {
    this.parameterPoints = parseParameterPoints(biomeSourceJson);
    this.searchTree = new ClimateRTree(this.parameterPoints, options.reuseLastLeaf ?? false);
  }

  get parameterPointCount(): number {
    return this.parameterPoints.length;
  }

  findBiome(target: TargetPoint): string {
    return this.parameterPoints[this.findParameterPointIndex(target)].biome;
  }

  /** findBiome for quantized climate values passed directly (the offset dimension targets 0, as in TargetPoint). */
  findBiomeForClimate(temperature: number, humidity: number, continentalness: number, erosion: number, depth: number, weirdness: number): string {
    return this.parameterPoints[this.searchTree.searchClimate(temperature, humidity, continentalness, erosion, depth, weirdness, 0)].biome;
  }

  findParameterPointIndex(target: TargetPoint): number {
    return this.searchTree.search(targetToParameterArray(target));
  }

  /** R-tree searches and node distance evaluations since the last call (profiler counters), then resets them. */
  drainSearchStatistics(): { searches: number; nodeDistanceEvaluations: number } {
    return this.searchTree.drainSearchStatistics();
  }

  /** Exhaustive reference search (lowest index wins ties), exposed for verification. */
  findBiomeBruteForce(target: TargetPoint): { index: number; biome: string; fitness: number } {
    const best = findBestParameterPointBruteForce(this.parameterPoints, target);
    return { index: best.index, biome: this.parameterPoints[best.index].biome, fitness: best.fitness };
  }

  getParameterPoints(): readonly ParameterPoint[] {
    return this.parameterPoints;
  }
}
