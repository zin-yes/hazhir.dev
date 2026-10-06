// Mirrors the noise half of net.minecraft.world.level.levelgen.RandomState: every `minecraft:noise` entry is
// instantiated lazily as `NormalNoise.create(root.fromHashOf(noiseId), parameters)` and cached per id.

import type { PositionalRandomFactory } from "../random/random-source";
import { XoroshiroRandomSource } from "../random/xoroshiro-random-source";
import { NormalNoise, type NoiseParameters } from "./normal-noise";
import { beginColdStart, defineColdStartLabel, endColdStart, recordColdStartUnits } from "../profiling/cold-start-ledger";
import { defineHotCounter, noteHot } from "../profiling/hot-counters";

const REGISTRY_HITS = defineHotCounter("noiseRegistry.cacheHits");
const CREATE_LABEL = defineColdStartLabel("noiseRegistry.createNoise");
const OCTAVES_LABEL = defineColdStartLabel("noiseRegistry.createNoise.octaves");

/** Resource ids without a namespace default to `minecraft:`, as ResourceLocation parsing does. */
export function normalizeResourceId(resourceId: string): string {
  return resourceId.includes(":") ? resourceId : `minecraft:${resourceId}`;
}

export class NoiseRegistry {
  private readonly instances = new Map<string, NormalNoise>();

  constructor(
    private readonly parametersById: Record<string, NoiseParameters>,
    readonly rootRandomFactory: PositionalRandomFactory,
  ) {}

  get(noiseId: string): NormalNoise {
    const resourceId = normalizeResourceId(noiseId);
    const cached = this.instances.get(resourceId);
    if (cached) {
      noteHot(REGISTRY_HITS);
      return cached;
    }
    const parameters = this.parametersById[resourceId];
    if (!parameters) throw new Error(`Unknown noise "${resourceId}" (not in the minecraft:noise registry)`);
    const coldStartToken = beginColdStart(CREATE_LABEL);
    const noise = NormalNoise.create(this.rootRandomFactory.fromHashOf(resourceId), parameters);
    endColdStart(CREATE_LABEL, coldStartToken);
    recordColdStartUnits(OCTAVES_LABEL, noise.improvedNoiseEvaluationsPerSample);
    this.instances.set(resourceId, noise);
    return noise;
  }
}

/** `RandomState.random` for Xoroshiro noise settings: `new XoroshiroRandomSource(seed).forkPositional()`. */
export function createRootRandomFactory(seed: bigint): PositionalRandomFactory {
  return new XoroshiroRandomSource(seed).forkPositional();
}
