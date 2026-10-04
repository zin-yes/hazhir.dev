// Compact overworld dimension: the multi-noise biome source lists thousands of parameter points as verbose objects.
// Encoded as `[biomeIndex, temperature, humidity, continentalness, erosion, depth, weirdness, offset]` rows (each
// parameter keeps its original number or [min, max] form) plus a biome id table. Everything else is kept as is.

import type { JsonObject, JsonValue } from "../engine/registry/datapack-loader";

const PARAMETER_NAMES = ["temperature", "humidity", "continentalness", "erosion", "depth", "weirdness", "offset"] as const;

export function encodeDimension(dimension: JsonObject): JsonObject {
  const generator = dimension.generator as JsonObject;
  const biomeSource = generator.biome_source as JsonObject;
  const biomeIds: string[] = [];
  const biomeIndexById = new Map<string, number>();
  const rows = (biomeSource.biomes as JsonObject[]).map((entry) => {
    const biomeId = entry.biome as string;
    let biomeIndex = biomeIndexById.get(biomeId);
    if (biomeIndex === undefined) {
      biomeIndex = biomeIds.length;
      biomeIds.push(biomeId);
      biomeIndexById.set(biomeId, biomeIndex);
    }
    const parameters = entry.parameters as JsonObject;
    return [
      biomeIndex,
      ...PARAMETER_NAMES.map((name) => {
        const value = parameters[name];
        if (value === undefined) throw new Error(`Biome source entry for ${biomeId} has no "${name}" parameter`);
        return value;
      }),
    ];
  });
  return { ...dimension, generator: { ...generator, biome_source: { ...biomeSource, biomes: rows, biome_ids: biomeIds } } };
}

export function decodeDimension(encoded: JsonObject): JsonObject {
  const generator = encoded.generator as JsonObject;
  const { biome_ids: biomeIds, biomes: rows, ...biomeSourceRest } = generator.biome_source as JsonObject;
  const biomes = (rows as JsonValue[][]).map((row) => ({
    biome: (biomeIds as string[])[row[0] as number]!,
    parameters: Object.fromEntries(PARAMETER_NAMES.map((name, index) => [name, row[index + 1]!])),
  }));
  return { ...encoded, generator: { ...generator, biome_source: { ...biomeSourceRest, biomes } } };
}
