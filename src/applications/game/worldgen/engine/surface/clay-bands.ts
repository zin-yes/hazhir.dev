// Mirrors SurfaceSystem.generateBands / makeBands: the 192 layer terracotta stripe pattern for badlands.

import type { SurfaceRandomSource } from "./surface-types";

export const CLAY_BAND_COUNT = 192;

export const TERRACOTTA_STATES = {
  terracotta: "minecraft:terracotta",
  orange: "minecraft:orange_terracotta",
  yellow: "minecraft:yellow_terracotta",
  brown: "minecraft:brown_terracotta",
  red: "minecraft:red_terracotta",
  white: "minecraft:white_terracotta",
  lightGray: "minecraft:light_gray_terracotta",
};

function makeBands(random: SurfaceRandomSource, bands: string[], minimumSize: number, state: string): void {
  const bandCount = random.nextIntBetweenInclusive(6, 15);
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex++) {
    const size = minimumSize + random.nextIntBounded(3);
    const start = random.nextIntBounded(bands.length);
    for (let offset = 0; start + offset < bands.length && offset < size; offset++) {
      bands[start + offset] = state;
    }
  }
}

export function generateClayBands(random: SurfaceRandomSource): string[] {
  const bands = new Array<string>(CLAY_BAND_COUNT).fill(TERRACOTTA_STATES.terracotta);
  for (let index = 0; index < bands.length; index++) {
    index += random.nextIntBounded(5) + 1;
    if (index >= bands.length) continue;
    bands[index] = TERRACOTTA_STATES.orange;
  }
  makeBands(random, bands, 1, TERRACOTTA_STATES.yellow);
  makeBands(random, bands, 2, TERRACOTTA_STATES.brown);
  makeBands(random, bands, 1, TERRACOTTA_STATES.red);
  const whiteBandCount = random.nextIntBetweenInclusive(9, 15);
  let placedWhiteBands = 0;
  for (let index = 0; placedWhiteBands < whiteBandCount && index < bands.length; placedWhiteBands++, index += random.nextIntBounded(16) + 4) {
    bands[index] = TERRACOTTA_STATES.white;
    if (index - 1 > 0 && random.nextBoolean()) bands[index - 1] = TERRACOTTA_STATES.lightGray;
    if (index + 1 >= bands.length || !random.nextBoolean()) continue;
    bands[index + 1] = TERRACOTTA_STATES.lightGray;
  }
  return bands;
}
