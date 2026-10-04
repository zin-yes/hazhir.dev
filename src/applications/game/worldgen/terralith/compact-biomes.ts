// Compact biome table: only the fields world generation reads (surface temperature rules, feature and carver
// lists), with ids replaced by indices into shared tables. Biome effects, spawners and colors are dropped.
//
// Encoded shape:
//   { featureIds: string[], carverIds: string[], stepLists: number[][],
//     biomes: { [biomeId]: [temperature, downfall, hasPrecipitation(0|1), isFrozenModifier(0|1),
//                           featureStepListIndices: number[], airCarverIndices: number[], liquidCarverIndices: number[]] } }
// `stepLists` holds each distinct list of feature indices once (most biomes share the ore and underground steps).

import type { JsonObject, JsonValue } from "../engine/registry/datapack-loader";

export interface CompactBiomeTable {
  featureIds: string[];
  carverIds: string[];
  stepLists: number[][];
  biomes: Record<string, [number, number, number, number, number[], number[], number[]]>;
}

/** Registry ids as a list with the implicit `minecraft:` namespace spelled out (datapacks may omit it). */
function asIdList(value: JsonValue | undefined): string[] {
  if (value === undefined) return [];
  const ids = typeof value === "string" ? [value] : (value as string[]);
  return ids.map((id) => (id.includes(":") ? id : `minecraft:${id}`));
}

function internIndex(table: string[], indexById: Map<string, number>, id: string): number {
  let index = indexById.get(id);
  if (index === undefined) {
    index = table.length;
    table.push(id);
    indexById.set(id, index);
  }
  return index;
}

export function encodeBiomes(biomeRegistry: Record<string, JsonObject>): CompactBiomeTable {
  const featureIds: string[] = [];
  const carverIds: string[] = [];
  const stepLists: number[][] = [];
  const featureIndexById = new Map<string, number>();
  const carverIndexById = new Map<string, number>();
  const stepListIndexByKey = new Map<string, number>();
  const biomes: CompactBiomeTable["biomes"] = {};

  for (const biomeId of Object.keys(biomeRegistry).sort()) {
    const biome = biomeRegistry[biomeId]!;
    const modifier = biome.temperature_modifier ?? "none";
    if (modifier !== "none" && modifier !== "frozen") throw new Error(`Biome ${biomeId} has unsupported temperature_modifier "${String(modifier)}"`);

    const stepListIndices = ((biome.features as JsonValue[] | undefined) ?? []).map((stepFeatures) => {
      const featureIndices = asIdList(stepFeatures as JsonValue).map((id) => internIndex(featureIds, featureIndexById, id));
      const key = featureIndices.join(",");
      let stepListIndex = stepListIndexByKey.get(key);
      if (stepListIndex === undefined) {
        stepListIndex = stepLists.length;
        stepLists.push(featureIndices);
        stepListIndexByKey.set(key, stepListIndex);
      }
      return stepListIndex;
    });

    const carvers = (biome.carvers as JsonObject | undefined) ?? {};
    const toCarverIndices = (value: JsonValue | undefined) => asIdList(value).map((id) => internIndex(carverIds, carverIndexById, id));
    biomes[biomeId] = [
      Number(biome.temperature),
      Number(biome.downfall),
      biome.has_precipitation ? 1 : 0,
      modifier === "frozen" ? 1 : 0,
      stepListIndices,
      toCarverIndices(carvers.air),
      toCarverIndices(carvers.liquid),
    ];
  }
  return { featureIds, carverIds, stepLists, biomes };
}

/** Restores the vanilla biome JSON shape for the fields kept by `encodeBiomes`. */
export function decodeBiomes(table: CompactBiomeTable): Record<string, JsonObject> {
  const biomes: Record<string, JsonObject> = {};
  for (const [biomeId, entry] of Object.entries(table.biomes)) {
    const [temperature, downfall, hasPrecipitation, isFrozenModifier, stepListIndices, airCarvers, liquidCarvers] = entry;
    const carvers: JsonObject = {};
    if (airCarvers.length > 0) carvers.air = airCarvers.map((index) => table.carverIds[index]!);
    if (liquidCarvers.length > 0) carvers.liquid = liquidCarvers.map((index) => table.carverIds[index]!);
    const biome: JsonObject = {
      temperature,
      downfall,
      has_precipitation: hasPrecipitation === 1,
      carvers,
      features: stepListIndices.map((stepListIndex) => table.stepLists[stepListIndex]!.map((featureIndex) => table.featureIds[featureIndex]!)),
    };
    if (isFrozenModifier === 1) biome.temperature_modifier = "frozen";
    biomes[biomeId] = biome;
  }
  return biomes;
}
