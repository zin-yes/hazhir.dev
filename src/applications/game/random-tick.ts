/**
 * Random ticks pick uniformly random blocks, but only a few block types react.
 * Instead of rolling every pick and discarding the misses, this keeps a list of
 * the reacting blocks per chunk and only visits those the rolls actually hit.
 */
export class TickableBlockIndex {
  private cache = new WeakMap<
    Uint8Array,
    { version: number; indices: Uint32Array }
  >();

  /** Indices of the blocks that react to random ticks, rescanned when the chunk's version changes. */
  indicesFor(
    chunk: Uint8Array,
    version: number,
    reactsToTicks: (block: number) => boolean,
  ): Uint32Array {
    const cached = this.cache.get(chunk);
    if (cached && cached.version === version) return cached.indices;

    const found: number[] = [];
    for (let index = 0; index < chunk.length; index++) {
      if (reactsToTicks(chunk[index])) found.push(index);
    }
    const indices = Uint32Array.from(found);
    this.cache.set(chunk, { version, indices });
    return indices;
  }
}

/**
 * The reacting blocks hit by `picks` uniformly random picks among `blockCount`
 * blocks: each pick lands on one of them with probability tickable / blockCount.
 */
export function pickTickedBlocks(
  tickableIndices: Uint32Array,
  blockCount: number,
  picks: number,
  random: () => number = Math.random,
): number[] {
  const hits: number[] = [];
  if (tickableIndices.length === 0) return hits;
  const hitChance = tickableIndices.length / blockCount;
  for (let pick = 0; pick < picks; pick++) {
    if (random() < hitChance) {
      hits.push(tickableIndices[Math.floor(random() * tickableIndices.length)]);
    }
  }
  return hits;
}
