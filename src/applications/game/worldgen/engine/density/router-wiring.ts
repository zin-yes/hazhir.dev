// NoiseRouter contract and the noise wiring pass. Mirrors RandomState's NoiseWiringHelper: noises and
// old_blended_noise get their seeded instances, and the router keeps its markers and holders for NoiseChunk to wire.
// Noise sources are injected so this file has no dependency on engine/noise.

import type { JsonObject, JsonValue } from "../registry/datapack-loader";
import { beginColdStart, defineColdStartLabel, endColdStart } from "../profiling/cold-start-ledger";
import { DensityFunctionCompiler } from "./compiler";
import { type DensityNode, MemoizingDensityVisitor, NoiseHolder, type NormalNoiseSampler } from "./density-function";
import { type BlendedNoiseParameters, type BlendedNoiseSampler, OldBlendedNoiseNode } from "./nodes/noise-nodes";

export interface NoiseRouter {
  barrier: DensityNode;
  fluidLevelFloodedness: DensityNode;
  fluidLevelSpread: DensityNode;
  lava: DensityNode;
  temperature: DensityNode;
  vegetation: DensityNode;
  continents: DensityNode;
  erosion: DensityNode;
  depth: DensityNode;
  ridges: DensityNode;
  initialDensityWithoutJaggedness: DensityNode;
  finalDensity: DensityNode;
  veinToggle: DensityNode;
  veinRidged: DensityNode;
  veinGap: DensityNode;
}

/** NoiseRouter record field order (mapAll visits them in this order) with their JSON names. */
export const NOISE_ROUTER_FIELDS: readonly (readonly [keyof NoiseRouter, string])[] = [
  ["barrier", "barrier"],
  ["fluidLevelFloodedness", "fluid_level_floodedness"],
  ["fluidLevelSpread", "fluid_level_spread"],
  ["lava", "lava"],
  ["temperature", "temperature"],
  ["vegetation", "vegetation"],
  ["continents", "continents"],
  ["erosion", "erosion"],
  ["depth", "depth"],
  ["ridges", "ridges"],
  ["initialDensityWithoutJaggedness", "initial_density_without_jaggedness"],
  ["finalDensity", "final_density"],
  ["veinToggle", "vein_toggle"],
  ["veinRidged", "vein_ridged"],
  ["veinGap", "vein_gap"],
];

export interface NoiseWiringSources {
  normalNoise(noiseId: string): NormalNoiseSampler;
  blendedNoise(parameters: BlendedNoiseParameters): BlendedNoiseSampler;
}

/** RandomState's NoiseWiringHelper: binds noises and old_blended_noise; everything else passes through. */
export class NoiseWiringVisitor extends MemoizingDensityVisitor {
  constructor(private readonly sources: NoiseWiringSources) {
    super();
  }

  visitNoise(noise: NoiseHolder): NoiseHolder {
    return new NoiseHolder(noise.noiseId, this.sources.normalNoise(noise.noiseId));
  }

  protected wrapNew(node: DensityNode): DensityNode {
    if (node instanceof OldBlendedNoiseNode) {
      return new OldBlendedNoiseNode(node.parameters, this.sources.blendedNoise(node.parameters));
    }
    return node;
  }
}

const WIRE_ROUTER_LABEL = defineColdStartLabel("world.wireNoiseRouter");

/** Compiles and wires a noise_router JSON object against arbitrary noise sources (tests inject fakes here). */
export function wireNoiseRouter(params: {
  densityFunctionsById: Record<string, JsonValue>;
  noiseRouterJson: JsonObject;
  sources: NoiseWiringSources;
}): NoiseRouter {
  const coldStartToken = beginColdStart(WIRE_ROUTER_LABEL);
  const compiler = new DensityFunctionCompiler(params.densityFunctionsById);
  const wiring = new NoiseWiringVisitor(params.sources);
  const router = {} as NoiseRouter;
  for (const [fieldName, jsonName] of NOISE_ROUTER_FIELDS) {
    const json = params.noiseRouterJson[jsonName];
    if (json === undefined) throw new Error(`noise_router is missing "${jsonName}"`);
    router[fieldName] = wiring.map(compiler.compileHolderHelper(json, `noise_router.${jsonName}`));
  }
  endColdStart(WIRE_ROUTER_LABEL, coldStartToken, compiler.compiledReferenceCount);
  return router;
}

