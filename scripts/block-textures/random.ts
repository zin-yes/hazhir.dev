// Seeded deterministic PRNG so every texture regenerates byte-identical.

export interface Random {
  next(): number;
  range(minimum: number, maximum: number): number;
  integer(minimumInclusive: number, maximumInclusive: number): number;
  chance(probability: number): boolean;
  pick<Item>(items: readonly Item[]): Item;
  shuffle<Item>(items: readonly Item[]): Item[];
}

export function hashSeedText(seedText: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seedText.length; index++) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRandom(seedText: string): Random {
  let state = hashSeedText(seedText);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const range = (minimum: number, maximum: number) => minimum + next() * (maximum - minimum);
  const integer = (minimumInclusive: number, maximumInclusive: number) =>
    Math.floor(range(minimumInclusive, maximumInclusive + 1));
  return {
    next,
    range,
    integer,
    chance: (probability) => next() < probability,
    pick: (items) => items[integer(0, items.length - 1)],
    shuffle: (items) => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index--) {
        const swapIndex = integer(0, index);
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
      }
      return copy;
    },
  };
}
