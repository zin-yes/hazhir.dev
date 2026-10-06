// Cheap point sampler for the carvers' biome lookups: climate functions evaluated at one quart cell (the stripped,
// uncached Climate.Sampler vanilla's RandomState uses), memoized in a bounded map. The carvers read the biome of a
// 17 x 17 chunk neighbourhood, so sampling whole chunk biome grids for them would be about 1000 times more work.
// The biome source has no last-leaf hint, so ties between equally good parameter points are resolved deterministically.

import {
  addWorkerCounter,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import type { MultiNoiseBiomeSource } from "../biome-source";
import { createClimateSampler, type NoiseRouter } from "../density";

const MAX_MEMOIZED_POINTS = 4096;

export function createPointBiomeSampler(
  router: NoiseRouter,
  biomeSource: MultiNoiseBiomeSource,
): (quartX: number, quartY: number, quartZ: number) => string {
  const climateSampler = createClimateSampler(router);
  const biomeByPoint = new Map<string, string>();
  return (quartX, quartY, quartZ) => {
    const key = `${quartX},${quartY},${quartZ}`;
    let biomeId = biomeByPoint.get(key);
    const isProfiling = isWorkerProfiling();
    if (isProfiling) addWorkerCounter(biomeId === undefined ? "carverBiomeCacheMisses" : "carverBiomeCacheHits", 1);
    if (biomeId === undefined) {
      if (isProfiling) startWorkerSection("biome.samplePoint");
      biomeId = biomeSource.findBiome(climateSampler.sample(quartX, quartY, quartZ));
      if (isProfiling) {
        endWorkerSection();
        const { searches, nodeDistanceEvaluations } = biomeSource.drainSearchStatistics();
        addWorkerCounter("carverBiomeRTreeSearches", searches);
        addWorkerCounter("carverBiomeRTreeNodeVisits", nodeDistanceEvaluations);
      }
      if (biomeByPoint.size >= MAX_MEMOIZED_POINTS) biomeByPoint.clear();
      biomeByPoint.set(key, biomeId);
    }
    return biomeId;
  };
}
