// Log textures per tree species: ringed tops with a bark border and furrowed, species-decorated sides.

import { createRamp, rampColor, shiftAlongRamp, type Ramp, type Rgb } from "./color";
import { createLineNoise, createPercentileNoise, createValueNoise, TEXTURE_SIZE } from "./noise";
import { drawCrack, drawFlatLine, paintPercentileRamp, scatterPixels } from "./painters";
import { createRandom, type Random } from "./random";
import { Texture, type TextureDefinition } from "./texture";

interface BarkStyle {
  ramp: Ramp;
  weights: readonly number[];
  streakHeight: number;
  furrowSpacing: number;
  furrowBreakChance: number;
  furrowDepthSteps: number;
}

interface LogSpecies {
  name: string;
  bark: BarkStyle;
  heartRamp: Ramp;
  decorate?: (texture: Texture, random: Random, ramp: Ramp) => void;
}

function paintBark(random: Random, style: BarkStyle): Texture {
  const streaks = createPercentileNoise(random, [
    { cellWidth: 2, cellHeight: style.streakHeight, weight: 1 },
    { cellWidth: 4, cellHeight: 8, weight: 0.4 },
  ]);
  const texture = paintPercentileRamp(new Texture(), style.ramp, streaks, style.weights);
  const furrowJitter = createLineNoise(random, 4);
  for (let furrowIndex = 0; furrowIndex * style.furrowSpacing < TEXTURE_SIZE; furrowIndex++) {
    const furrowColumn = Math.round(furrowIndex * style.furrowSpacing + furrowJitter(furrowIndex * 3) * 1.6);
    for (let rowY = 0; rowY < TEXTURE_SIZE; rowY++) {
      if (random.chance(style.furrowBreakChance)) continue;
      const groove = texture.get(furrowColumn, rowY) as Rgb;
      const ridge = texture.get(furrowColumn - 1, rowY) as Rgb;
      texture.set(furrowColumn, rowY, shiftAlongRamp(style.ramp, groove, -style.furrowDepthSteps));
      texture.set(furrowColumn - 1, rowY, shiftAlongRamp(style.ramp, ridge, 1));
    }
  }
  return texture;
}

function paintLogSide(species: LogSpecies): Texture {
  const random = createRandom(`log_${species.name}_side`);
  const texture = paintBark(random, species.bark);
  species.decorate?.(texture, random, species.bark.ramp);
  return texture;
}

function paintLogTop(species: LogSpecies): Texture {
  const random = createRandom(`log_${species.name}_top`);
  const barkRamp = species.bark.ramp;
  const heartRamp = species.heartRamp;
  const wobble = createValueNoise(random, 8, 8);
  const barkTexture = paintBark(createRandom(`log_${species.name}_top_bark`), species.bark);
  return new Texture().paint((x, y) => {
    const edgeDistance = Math.min(x, y, TEXTURE_SIZE - 1 - x, TEXTURE_SIZE - 1 - y);
    if (edgeDistance === 0) return shiftAlongRamp(barkRamp, barkTexture.get(x, y) as Rgb, -1);
    if (edgeDistance === 1) return barkTexture.get(x, y) as Rgb;
    const offsetX = x - 7.5;
    const offsetY = y - 7.5;
    const squareDistance = Math.max(Math.abs(offsetX), Math.abs(offsetY));
    const ringDistance = squareDistance * 0.62 + Math.hypot(offsetX, offsetY) * 0.38 + (wobble(x, y) - 0.5) * 1.1;
    if (ringDistance < 1.1) return rampColor(heartRamp, 0);
    const ringIndex = Math.floor(ringDistance / 1.45);
    const level = ringIndex % 2 === 0 ? 2 : 1;
    const isOuterRing = ringDistance > 5.6;
    return rampColor(heartRamp, isOuterRing ? 0 + level : level + (x + y) % 2 * 0 + (ringDistance % 1.45 < 0.5 ? 1 : 0));
  });
}

const birchDashes = (texture: Texture, random: Random, ramp: Ramp) => {
  const dashBody: Rgb = [38, 35, 33];
  for (let dash = 0; dash < 8; dash++) {
    const dashX = random.integer(0, TEXTURE_SIZE - 1);
    const dashY = Math.floor((dash * TEXTURE_SIZE) / 8) + random.integer(0, 1);
    const length = random.integer(2, 4);
    drawFlatLine(texture, dashX, dashY, dashX + length - 1, dashY, dashBody);
    if (random.chance(0.6)) texture.set(dashX + 1, dashY + 1, rampColor(ramp, 1));
    if (random.chance(0.5)) texture.set(dashX + length, dashY, [96, 90, 84]);
  }
};

const jungleMossAndKnots = (texture: Texture, random: Random) => {
  const mossColors = createRamp("#33501a", "#47681f", "#5d8228");
  for (let patch = 0; patch < 5; patch++) {
    const patchX = random.integer(0, TEXTURE_SIZE - 1);
    const patchY = random.integer(0, TEXTURE_SIZE - 1);
    for (const [offsetX, offsetY] of [[0, 0], [1, 0], [0, 1], [-1, 1], [1, 1]].slice(0, random.integer(3, 5))) {
      texture.set(patchX + offsetX, patchY + offsetY, random.pick(mossColors));
    }
  }
  for (const knot of [{ knotX: 4, knotY: 4 }, { knotX: 11, knotY: 11 }]) {
    texture.set(knot.knotX, knot.knotY - 1, [112, 88, 58]);
    texture.set(knot.knotX + 1, knot.knotY - 1, [112, 88, 58]);
    texture.set(knot.knotX, knot.knotY, [28, 20, 12]);
    texture.set(knot.knotX + 1, knot.knotY, [40, 30, 18]);
    texture.set(knot.knotX, knot.knotY + 1, [84, 64, 42]);
    texture.set(knot.knotX + 1, knot.knotY + 1, [84, 64, 42]);
  }
  for (let vine = 0; vine < 3; vine++) {
    drawCrack(texture, random, random.integer(0, 15), random.integer(0, 8), random.integer(4, 7), 0, 1, [70, 108, 40], 0.5);
  }
};

const cherryLenticels = (texture: Texture, random: Random, ramp: Ramp) => {
  for (let rowIndex = 0; rowIndex < 5; rowIndex++) {
    for (let columnIndex = 0; columnIndex < 2; columnIndex++) {
      const lenticelX = columnIndex * 8 + random.integer(0, 5);
      const lenticelY = rowIndex * 3 + 1;
      drawFlatLine(texture, lenticelX, lenticelY, lenticelX + random.integer(1, 2), lenticelY, [176, 148, 148]);
      texture.set(lenticelX, lenticelY + 1, rampColor(ramp, 0));
    }
  }
};

const driftwoodCracks = (texture: Texture, random: Random, ramp: Ramp) => {
  for (let crack = 0; crack < 5; crack++) {
    drawCrack(texture, random, random.integer(0, 15), random.integer(0, 12), random.integer(4, 7), 0, 1, rampColor(ramp, 0), 0.25);
  }
  scatterPixels(texture, random, 9, () => rampColor(ramp, 4));
};

const palmRingsAndScars = (texture: Texture, random: Random, ramp: Ramp) => {
  for (const ringRow of [2, 6, 10, 14]) {
    for (let columnX = 0; columnX < TEXTURE_SIZE; columnX++) {
      if (random.chance(0.85)) texture.set(columnX, ringRow, rampColor(ramp, 0));
      if (random.chance(0.35)) texture.set(columnX, ringRow + 1, rampColor(ramp, 4));
    }
  }
  for (let scar = 0; scar < 7; scar++) {
    const scarX = random.integer(1, 13);
    const scarY = random.integer(0, 13);
    texture.set(scarX, scarY, rampColor(ramp, 0));
    texture.set(scarX + 1, scarY + 1, rampColor(ramp, 0));
    texture.set(scarX + 1, scarY, rampColor(ramp, 4));
  }
};

const acaciaOrangePatches = (texture: Texture, random: Random) => {
  const orange = createRamp("#a8642f", "#bf7a3a", "#d08c48");
  for (let patch = 0; patch < 6; patch++) {
    const patchX = random.integer(0, 15);
    const patchY = random.integer(0, 14);
    texture.set(patchX, patchY, random.pick(orange));
    texture.set(patchX, patchY + 1, random.pick(orange));
    if (random.chance(0.5)) texture.set(patchX + 1, patchY + 1, orange[0]);
  }
};

const redwoodFlakes = (texture: Texture, random: Random, ramp: Ramp) => {
  for (let flake = 0; flake < 8; flake++) {
    const flakeX = random.integer(0, 15);
    const flakeY = random.integer(0, 12);
    texture.set(flakeX, flakeY, rampColor(ramp, 4));
    texture.set(flakeX, flakeY + 1, rampColor(ramp, 3));
    texture.set(flakeX + 1, flakeY + 2, rampColor(ramp, 0));
  }
};

const mangroveRoughness = (texture: Texture, random: Random, ramp: Ramp) => {
  scatterPixels(texture, random, 14, () => rampColor(ramp, random.integer(0, 1)));
  scatterPixels(texture, random, 8, () => rampColor(ramp, 4));
  for (let scar = 0; scar < 3; scar++) {
    drawCrack(texture, random, random.integer(0, 15), random.integer(0, 10), 4, 0, 1, [58, 28, 22], 0.5);
  }
};

const baobabWrinkles = (texture: Texture, random: Random, ramp: Ramp) => {
  for (let wrinkle = 0; wrinkle < 7; wrinkle++) {
    const startX = random.integer(0, 12);
    const startY = random.integer(1, 14);
    const length = random.integer(3, 5);
    for (let offset = 0; offset < length; offset++) {
      const arch = offset === 0 || offset === length - 1 ? 1 : 0;
      texture.set(startX + offset, startY + arch, rampColor(ramp, 0));
    }
    texture.set(startX + 1, startY + 2, rampColor(ramp, 4));
  }
};

const LOG_SPECIES: LogSpecies[] = [
  {
    name: "birch",
    bark: { ramp: createRamp("#b9b3a4", "#cdc8ba", "#ddd9cc", "#ebe8de", "#f5f3ec"), weights: [0.1, 0.22, 0.32, 0.24, 0.12], streakHeight: 8, furrowSpacing: 7, furrowBreakChance: 0.7, furrowDepthSteps: 1 },
    heartRamp: createRamp("#a89868", "#c4b482", "#d6c796", "#e4d8ae"),
    decorate: birchDashes,
  },
  {
    name: "spruce",
    bark: { ramp: createRamp("#2c241e", "#382e26", "#453a30", "#544739", "#665746"), weights: [0.18, 0.3, 0.28, 0.16, 0.08], streakHeight: 8, furrowSpacing: 3.5, furrowBreakChance: 0.15, furrowDepthSteps: 2 },
    heartRamp: createRamp("#5e4328", "#7a5a38", "#8d6b45", "#a07b52"),
  },
  {
    name: "acacia",
    bark: { ramp: createRamp("#544840", "#665850", "#786a5e", "#8b7b6c", "#9d8c7a"), weights: [0.14, 0.28, 0.3, 0.2, 0.08], streakHeight: 8, furrowSpacing: 4, furrowBreakChance: 0.4, furrowDepthSteps: 1 },
    heartRamp: createRamp("#a2602c", "#bd7a3c", "#d08f4e", "#e0a362"),
    decorate: (texture, random) => acaciaOrangePatches(texture, random),
  },
  {
    name: "jungle",
    bark: { ramp: createRamp("#3a2c1a", "#493824", "#594530", "#6a5439", "#7c6444"), weights: [0.16, 0.3, 0.3, 0.16, 0.08], streakHeight: 8, furrowSpacing: 5, furrowBreakChance: 0.35, furrowDepthSteps: 1 },
    heartRamp: createRamp("#6e5230", "#876840", "#9c7b4e", "#b08e5e"),
    decorate: (texture, random) => jungleMossAndKnots(texture, random),
  },
  {
    name: "cherry",
    bark: { ramp: createRamp("#352530", "#44313c", "#533c47", "#654a54", "#785a62"), weights: [0.14, 0.3, 0.32, 0.17, 0.07], streakHeight: 8, furrowSpacing: 6, furrowBreakChance: 0.6, furrowDepthSteps: 1 },
    heartRamp: createRamp("#a56c72", "#bb8486", "#cc9a9a", "#dcb0ac"),
    decorate: cherryLenticels,
  },
  {
    name: "dead",
    bark: { ramp: createRamp("#76726a", "#8a867d", "#9d998f", "#b0aca1", "#c3bfb3"), weights: [0.12, 0.26, 0.32, 0.22, 0.08], streakHeight: 12, furrowSpacing: 5, furrowBreakChance: 0.55, furrowDepthSteps: 1 },
    heartRamp: createRamp("#8e8a80", "#a29e93", "#b5b1a5", "#c8c4b7"),
    decorate: driftwoodCracks,
  },
  {
    name: "palm",
    bark: { ramp: createRamp("#7c5e3a", "#8f6f45", "#a2814f", "#b4935d", "#c6a56d"), weights: [0.14, 0.28, 0.3, 0.2, 0.08], streakHeight: 4, furrowSpacing: 8, furrowBreakChance: 0.8, furrowDepthSteps: 1 },
    heartRamp: createRamp("#a88454", "#be9b65", "#d0ad76", "#e0c088"),
    decorate: palmRingsAndScars,
  },
  {
    name: "mangrove",
    bark: { ramp: createRamp("#4a241d", "#5c2f25", "#6e3a2c", "#814635", "#95543f"), weights: [0.16, 0.3, 0.28, 0.18, 0.08], streakHeight: 4, furrowSpacing: 4.5, furrowBreakChance: 0.3, furrowDepthSteps: 1 },
    heartRamp: createRamp("#8a4430", "#a05a40", "#b46f50", "#c58462"),
    decorate: mangroveRoughness,
  },
  {
    name: "redwood",
    bark: { ramp: createRamp("#55200f", "#6b2a16", "#82371c", "#984528", "#ae5836"), weights: [0.18, 0.28, 0.28, 0.18, 0.08], streakHeight: 16, furrowSpacing: 5, furrowBreakChance: 0.08, furrowDepthSteps: 2 },
    heartRamp: createRamp("#8e3a22", "#a64c2e", "#bb613c", "#cd7a50"),
    decorate: redwoodFlakes,
  },
  {
    name: "baobab",
    bark: { ramp: createRamp("#766b55", "#877b62", "#988c71", "#a99d80", "#b9ae92"), weights: [0.1, 0.24, 0.34, 0.22, 0.1], streakHeight: 4, furrowSpacing: 9, furrowBreakChance: 0.85, furrowDepthSteps: 1 },
    heartRamp: createRamp("#a89868", "#bcab7c", "#cdbd90", "#ddcea4"),
    decorate: baobabWrinkles,
  },
];

export async function woodTextures(): Promise<TextureDefinition[]> {
  return LOG_SPECIES.flatMap((species): TextureDefinition[] => [
    { fileName: `log_${species.name}_top.png`, draw: () => paintLogTop(species) },
    { fileName: `log_${species.name}_side.png`, draw: () => paintLogSide(species) },
  ]);
}
