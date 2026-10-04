// net.minecraft.Util.shuffle / shuffledCopy / getRandom over a RandomSource.

import type { RandomSource } from "../../../../random";

/** Util.shuffle: for (i = size; i > 1; i--) swap(i - 1, random.nextInt(i)). */
export function shuffleInPlace<Value>(list: Value[], random: RandomSource): void {
  for (let remaining = list.length; remaining > 1; remaining--) {
    const swapIndex = random.nextIntBounded(remaining);
    const kept = list[remaining - 1]!;
    list[remaining - 1] = list[swapIndex]!;
    list[swapIndex] = kept;
  }
}

/** Util.shuffledCopy / Util.toShuffledList. */
export function shuffledCopy<Value>(source: readonly Value[], random: RandomSource): Value[] {
  const copy = [...source];
  shuffleInPlace(copy, random);
  return copy;
}

/** Util.getRandom(array or list, random): one nextInt(size) draw. */
export function randomElementOf<Value>(list: readonly Value[], random: RandomSource): Value {
  return list[random.nextIntBounded(list.length)]!;
}
