// Test support (Node only): flattened block tags with default-namespace normalization, as TagLoader resolves them:
// "#base_stone_overworld" is "#minecraft:base_stone_overworld" and "basalt" is "minecraft:basalt". Terralith writes
// tag references and block ids without a namespace (island_blocks, valid_blocks), and the shared datapack loader
// keeps them verbatim, which silently drops those entries from the flattened tag.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TERRALITH_OVERLAY_DIRECTORIES, type TagRegistry } from "../../../../registry/datapack-loader";

const SCRATCH_DIRECTORY =
  process.env.WORLDGEN_SCRATCH ?? "/private/tmp/claude-501/-Users-hazhir-code-zin-yes-hazhir-dev/72290beb-a2c3-4424-af2e-7aec7d1ca7d0/scratchpad";

function withDefaultNamespace(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

function listJsonFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listJsonFiles(path);
    return path.endsWith(".json") ? [path] : [];
  });
}

export function loadNormalizedBlockTags(): TagRegistry {
  const dataRoots = [
    join(SCRATCH_DIRECTORY, "mc", "vanilla", "data"),
    join(SCRATCH_DIRECTORY, "Terralith", "data"),
    ...TERRALITH_OVERLAY_DIRECTORIES.map((overlay) => join(SCRATCH_DIRECTORY, "Terralith", overlay, "data")),
  ];
  const rawTags: Record<string, string[]> = {};
  for (const dataRoot of dataRoots) {
    if (!existsSync(dataRoot)) continue;
    for (const namespace of readdirSync(dataRoot)) {
      const tagDirectory = join(dataRoot, namespace, "tags", "blocks");
      for (const filePath of listJsonFiles(tagDirectory)) {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { values?: Array<string | { id: string }>; replace?: boolean };
        const tagId = `${namespace}:${filePath.slice(tagDirectory.length + 1, -".json".length)}`;
        const values = (parsed.values ?? []).map((value) => (typeof value === "string" ? value : value.id));
        rawTags[tagId] = parsed.replace || !rawTags[tagId] ? values : [...rawTags[tagId]!, ...values];
      }
    }
  }
  const flattened: TagRegistry = {};
  const resolve = (tagId: string, visiting: Set<string>): string[] => {
    if (flattened[tagId]) return flattened[tagId]!;
    const values = rawTags[tagId];
    if (!values || visiting.has(tagId)) return [];
    visiting.add(tagId);
    const ids: string[] = [];
    for (const value of values) {
      if (value.startsWith("#")) ids.push(...resolve(withDefaultNamespace(value.slice(1)), visiting));
      else ids.push(withDefaultNamespace(value));
    }
    visiting.delete(tagId);
    return (flattened[tagId] = [...new Set(ids)]);
  };
  for (const tagId of Object.keys(rawTags)) resolve(tagId, new Set());
  return flattened;
}
