// Node-only: merges Minecraft datapack directories into in-memory worldgen registries.
// Later directories override earlier ones file by file, the way datapack load order does.
// Used by tests and by the compile script; the browser never reads the filesystem.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type RegistryName =
  | "biome"
  | "configured_carver"
  | "configured_feature"
  | "density_function"
  | "noise"
  | "noise_settings"
  | "placed_feature"
  | "structure"
  | "structure_set"
  | "processor_list"
  | "template_pool";

export const REGISTRY_NAMES: RegistryName[] = [
  "biome",
  "configured_carver",
  "configured_feature",
  "density_function",
  "noise",
  "noise_settings",
  "placed_feature",
  "structure",
  "structure_set",
  "processor_list",
  "template_pool",
];

/** Registry name -> resource id ("namespace:path") -> parsed JSON. */
export type WorldgenRegistries = Record<RegistryName, Record<string, JsonObject>>;

/** Block and biome tags ("namespace:path" -> flattened list of ids, "#" references resolved). */
export type TagRegistry = Record<string, string[]>;

export interface DatapackLoadResult {
  registries: WorldgenRegistries;
  /** Parsed `data/minecraft/dimension/overworld.json`, which holds the multi-noise biome source. */
  overworldDimension: JsonObject | null;
  blockTags: TagRegistry;
  biomeTags: TagRegistry;
}

function listJsonFilesRecursively(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const collected: string[] = [];
  for (const entryName of readdirSync(directory)) {
    const entryPath = join(directory, entryName);
    if (statSync(entryPath).isDirectory()) collected.push(...listJsonFilesRecursively(entryPath));
    else if (entryName.endsWith(".json")) collected.push(entryPath);
  }
  return collected;
}

function readJsonFile(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function loadRegistryFromDataRoot(
  registries: WorldgenRegistries,
  dataRoot: string,
  registryName: RegistryName,
): void {
  if (!existsSync(dataRoot)) return;
  for (const namespace of readdirSync(dataRoot)) {
    const registryDirectory = join(dataRoot, namespace, "worldgen", registryName);
    for (const filePath of listJsonFilesRecursively(registryDirectory)) {
      const relativePath = filePath.slice(registryDirectory.length + 1, -".json".length);
      registries[registryName][`${namespace}:${relativePath}`] = readJsonFile(filePath);
    }
  }
}

function loadTagRegistry(dataRoots: string[], tagDirectoryPath: string[]): TagRegistry {
  const rawTags: Record<string, { values: string[]; replace: boolean }> = {};
  for (const dataRoot of dataRoots) {
    if (!existsSync(dataRoot)) continue;
    for (const namespace of readdirSync(dataRoot)) {
      const tagDirectory = join(dataRoot, namespace, "tags", ...tagDirectoryPath);
      for (const filePath of listJsonFilesRecursively(tagDirectory)) {
        const relativePath = filePath.slice(tagDirectory.length + 1, -".json".length);
        const parsed = readJsonFile(filePath) as { values?: JsonValue[]; replace?: boolean };
        const tagId = `${namespace}:${relativePath}`;
        const values = (parsed.values ?? []).map((value) =>
          typeof value === "string" ? value : String((value as JsonObject).id),
        );
        const existing = rawTags[tagId];
        rawTags[tagId] =
          parsed.replace || !existing
            ? { values, replace: Boolean(parsed.replace) }
            : { values: [...existing.values, ...values], replace: false };
      }
    }
  }
  const flattened: TagRegistry = {};
  const resolve = (tagId: string, visiting: Set<string>): string[] => {
    if (flattened[tagId]) return flattened[tagId];
    const raw = rawTags[tagId];
    if (!raw || visiting.has(tagId)) return [];
    visiting.add(tagId);
    const ids: string[] = [];
    for (const value of raw.values) {
      if (value.startsWith("#")) ids.push(...resolve(value.slice(1), visiting));
      else ids.push(value);
    }
    visiting.delete(tagId);
    return (flattened[tagId] = [...new Set(ids)]);
  };
  for (const tagId of Object.keys(rawTags)) resolve(tagId, new Set());
  return flattened;
}

/** Terralith 2.5.1 targets pack format 41 (Minecraft 1.20.6), so all three overlays are active, in order. */
export const TERRALITH_OVERLAY_DIRECTORIES = ["1-20-2-overlay", "1-20-3-overlay", "1-20-5-overlay"];

export function loadDatapacks(dataRootDirectories: string[]): DatapackLoadResult {
  const registries = Object.fromEntries(REGISTRY_NAMES.map((name) => [name, {}])) as unknown as WorldgenRegistries;
  let overworldDimension: JsonObject | null = null;
  for (const dataRoot of dataRootDirectories) {
    for (const registryName of REGISTRY_NAMES) loadRegistryFromDataRoot(registries, dataRoot, registryName);
    const dimensionPath = join(dataRoot, "minecraft", "dimension", "overworld.json");
    if (existsSync(dimensionPath)) overworldDimension = readJsonFile(dimensionPath);
  }
  return {
    registries,
    overworldDimension,
    blockTags: loadTagRegistry(dataRootDirectories, ["blocks"]),
    biomeTags: loadTagRegistry(dataRootDirectories, ["worldgen", "biome"]),
  };
}

/** Vanilla data first, then the Terralith base, then each Terralith overlay. */
export function loadTerralithOnVanilla(vanillaDataRoot: string, terralithPackRoot: string): DatapackLoadResult {
  return loadDatapacks([
    vanillaDataRoot,
    join(terralithPackRoot, "data"),
    ...TERRALITH_OVERLAY_DIRECTORIES.map((overlay) => join(terralithPackRoot, overlay, "data")),
  ]);
}
