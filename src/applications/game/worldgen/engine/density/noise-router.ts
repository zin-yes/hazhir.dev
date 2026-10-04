// Builds the seeded NoiseRouter for a noise_settings entry (RandomState.router()): every noise is
// NormalNoise.create(root.fromHashOf(noiseId), parameters) via NoiseRegistry, and old_blended_noise gets
// BlendedNoise seeded from root.fromHashOf("minecraft:terrain").

import { BlendedNoise, createRootRandomFactory, type NoiseParameters, NoiseRegistry } from "../noise";
import type { JsonObject, WorldgenRegistries } from "../registry/datapack-loader";
import { type NoiseRouter, type NoiseWiringSources, wireNoiseRouter } from "./router-wiring";

export type { NoiseRouter } from "./router-wiring";

function readNoiseParameters(noiseRegistry: Record<string, JsonObject>): Record<string, NoiseParameters> {
  const parametersById: Record<string, NoiseParameters> = {};
  for (const [noiseId, json] of Object.entries(noiseRegistry)) {
    parametersById[noiseId] = { firstOctave: json.firstOctave as number, amplitudes: json.amplitudes as number[] };
  }
  return parametersById;
}

/** The seeded noise instances RandomState hands out: NoiseRegistry noises and the "minecraft:terrain" BlendedNoise. */
export function createSeededNoiseSources(params: { registries: WorldgenRegistries; seed: bigint }): NoiseWiringSources {
  const rootRandomFactory = createRootRandomFactory(params.seed);
  const noiseRegistry = new NoiseRegistry(readNoiseParameters(params.registries.noise), rootRandomFactory);
  return {
    normalNoise: (noiseId) => noiseRegistry.get(noiseId),
    blendedNoise: (blendedParameters) =>
      new BlendedNoise(
        rootRandomFactory.fromHashOf("minecraft:terrain"),
        blendedParameters.xzScale,
        blendedParameters.yScale,
        blendedParameters.xzFactor,
        blendedParameters.yFactor,
        blendedParameters.smearScaleMultiplier,
      ),
  };
}

/** RandomState.router() for a seed: e.g. createNoiseRouter({registries, noiseSettingsId: "minecraft:overworld", seed}). */
export function createNoiseRouter(params: {
  registries: WorldgenRegistries;
  noiseSettingsId: string;
  seed: bigint;
}): NoiseRouter {
  const settings = params.registries.noise_settings[params.noiseSettingsId];
  if (settings === undefined) throw new Error(`Unknown noise settings "${params.noiseSettingsId}"`);
  if (settings.legacy_random_source === true) throw new Error("legacy_random_source noise settings are not supported");
  return wireNoiseRouter({
    densityFunctionsById: params.registries.density_function,
    noiseRouterJson: settings.noise_router as JsonObject,
    sources: createSeededNoiseSources(params),
  });
}
