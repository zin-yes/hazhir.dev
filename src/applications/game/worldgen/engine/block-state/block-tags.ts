// Block tag membership (BlockState.is(TagKey<Block>)) over the flattened tag registry produced by the datapack
// loader ("namespace:path" -> block ids, nested "#tag" references already resolved).

export type BlockTagRegistry = Record<string, string[]>;

export class BlockTagIndex {
  private readonly membersByTag = new Map<string, ReadonlySet<string>>();
  /** Members by the tag id exactly as callers spell it, so repeated lookups skip normalization. */
  private readonly membersByTagSpelling = new Map<string, ReadonlySet<string>>();

  constructor(private readonly tags: BlockTagRegistry) {}

  /** Accepts "minecraft:dirt", "#minecraft:dirt" or "dirt". Unknown tags are empty, as in vanilla. */
  members(tagId: string): ReadonlySet<string> {
    const known = this.membersByTagSpelling.get(tagId);
    if (known !== undefined) return known;
    const normalizedTagId = normalizeTagId(tagId);
    let members = this.membersByTag.get(normalizedTagId);
    if (!members) {
      members = new Set(this.tags[normalizedTagId] ?? []);
      this.membersByTag.set(normalizedTagId, members);
    }
    this.membersByTagSpelling.set(tagId, members);
    return members;
  }

  is(blockName: string, tagId: string): boolean {
    return this.members(tagId).has(blockName);
  }

  hasTag(tagId: string): boolean {
    return this.tags[normalizeTagId(tagId)] !== undefined;
  }
}

export function normalizeTagId(tagId: string): string {
  const withoutHash = tagId.startsWith("#") ? tagId.slice(1) : tagId;
  return withoutHash.includes(":") ? withoutHash : `minecraft:${withoutHash}`;
}

export function normalizeBlockId(blockId: string): string {
  return blockId.includes(":") ? blockId : `minecraft:${blockId}`;
}
