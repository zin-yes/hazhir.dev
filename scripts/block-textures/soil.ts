// Ground-cover textures: grass turf and fringed sides, podzol, dirt variants, mud, peat, moss, sands and ash.

import * as path from "path";
import { createRamp, mixColors, rampColor, shiftAlongRamp, type Ramp, type Rgb } from "./color";
import {
  createCellField,
  createLineNoise,
  createPercentileField,
  createPercentileNoise,
  TEXTURE_SIZE,
} from "./noise";
import { drawFlatLine, paintPercentileRamp, scatterPixels, scatterShapes, SMALL_BLOB_SHAPES } from "./painters";
import { createRandom, type Random } from "./random";
import { Texture, type TextureDefinition } from "./texture";

const DIRT_TEXTURE_PATH = path.join(process.cwd(), "public/game/dirt.png");
const BLACK: Rgb = [0, 0, 0];

interface TurfPalette {
  ramp: Ramp;
  weights: readonly number[];
  bladeCount: number;
}

function paintTurf(seedText: string, palette: TurfPalette): Texture {
  const random = createRandom(seedText);
  const clumps = createPercentileNoise(random, [
    { cellWidth: 4, weight: 1 },
    { cellWidth: 2, weight: 0.7 },
  ]);
  const texture = paintPercentileRamp(new Texture(), palette.ramp, clumps, palette.weights);
  const lastIndex = palette.ramp.length - 1;
  for (let blade = 0; blade < palette.bladeCount; blade++) {
    const bladeX = random.integer(0, TEXTURE_SIZE - 1);
    const bladeY = random.integer(0, TEXTURE_SIZE - 1);
    texture.set(bladeX, bladeY, rampColor(palette.ramp, lastIndex - (blade % 2)));
    texture.set(bladeX, bladeY + 1, rampColor(palette.ramp, lastIndex - 2));
    if (blade % 3 === 0) texture.set(bladeX + 1, bladeY + 2, rampColor(palette.ramp, 0));
  }
  scatterPixels(texture, random, palette.bladeCount / 2, () => rampColor(palette.ramp, 0));
  return texture;
}

function createFringeDepths(random: Random, minimumDepth: number, maximumDepth: number): number[] {
  const rawDepth = createLineNoise(random, 4);
  const depths = Array.from({ length: TEXTURE_SIZE }, (_, column) =>
    Math.round(minimumDepth + rawDepth(column) * (maximumDepth - minimumDepth))
  );
  for (let column = 0; column < TEXTURE_SIZE; column++) {
    const roll = random.next();
    if (roll < 0.22) depths[column] = Math.min(depths[column] + random.integer(1, 2), maximumDepth + 2);
    else if (roll < 0.34) depths[column] = Math.max(minimumDepth - 1, depths[column] - 1);
  }
  return depths;
}

function overlayFringe(target: Texture, turf: Texture, ramp: Ramp, depths: readonly number[]): void {
  depths.forEach((depth, column) => {
    for (let row = 0; row < depth; row++) {
      const turfColor = turf.get(column, row) as Rgb;
      const isLowestPixel = row === depth - 1;
      target.set(column, row, isLowestPixel ? shiftAlongRamp(ramp, turfColor, -1) : turfColor);
    }
  });
}

function shadeSoilUnderFringe(target: Texture, depths: readonly number[]): void {
  depths.forEach((depth, column) => {
    const soilColor = target.get(column, depth);
    if (soilColor) target.set(column, depth, mixColors(soilColor, BLACK, 0.22));
  });
}

async function paintFringedSide(
  seedText: string,
  turf: Texture,
  ramp: Ramp,
  depthRange: readonly [number, number]
): Promise<Texture> {
  const random = createRandom(seedText);
  const side = await Texture.loadPng(DIRT_TEXTURE_PATH);
  const depths = createFringeDepths(random, depthRange[0], depthRange[1]);
  overlayFringe(side, turf, ramp, depths);
  shadeSoilUnderFringe(side, depths);
  return side;
}

const LUSH = {
  ramp: createRamp("#14502a", "#1c6a30", "#26843a", "#34a044", "#52bd58"),
  weights: [0.16, 0.3, 0.3, 0.17, 0.07],
  bladeCount: 14,
};
const DRY = {
  ramp: createRamp("#6e6424", "#847829", "#9b8c32", "#b2a040", "#cab656"),
  weights: [0.14, 0.3, 0.32, 0.17, 0.07],
  bladeCount: 14,
};
const COLD = {
  ramp: createRamp("#245648", "#2f6c58", "#3c8268", "#4f997a", "#69b190"),
  weights: [0.16, 0.3, 0.3, 0.17, 0.07],
  bladeCount: 14,
};
const MEADOW = {
  ramp: createRamp("#4f8a1e", "#65a226", "#7cba30", "#95d03f", "#b1e35c"),
  weights: [0.12, 0.28, 0.32, 0.2, 0.08],
  bladeCount: 14,
};

const SNOW_RAMP = createRamp("#c3d4e6", "#d5e3f0", "#e6eff7", "#f3f8fc", "#ffffff");
const FROST_GRASS_RAMP = createRamp("#4a7a6a", "#5d8f7c", "#76a592", "#93bfab");

function paintMeadowTop(): Texture {
  const texture = paintTurf("grass_meadow_top", MEADOW);
  const random = createRandom("grass_meadow_flowers");
  const blossomColors: Rgb[] = [
    [250, 248, 236],
    [255, 226, 64],
    [244, 150, 186],
    [255, 250, 205],
  ];
  const stemShadow = rampColor(MEADOW.ramp, 0);
  for (let flower = 0; flower < 6; flower++) {
    const flowerX = random.integer(0, TEXTURE_SIZE - 1);
    const flowerY = random.integer(0, TEXTURE_SIZE - 2);
    texture.set(flowerX, flowerY, blossomColors[flower % blossomColors.length]);
    texture.set(flowerX, flowerY + 1, stemShadow);
  }
  return texture;
}

function paintSnowTop(): Texture {
  const random = createRandom("grass_snowy_top");
  const drifts = createPercentileNoise(random, [
    { cellWidth: 8, weight: 1 },
    { cellWidth: 4, weight: 0.8 },
    { cellWidth: 2, weight: 0.3 },
  ]);
  const texture = paintPercentileRamp(new Texture(), SNOW_RAMP, drifts, [0.1, 0.17, 0.25, 0.3, 0.18]);
  scatterShapes(texture, random, 5, SMALL_BLOB_SHAPES.slice(0, 3), () => rampColor(FROST_GRASS_RAMP, random.integer(1, 3)));
  scatterPixels(texture, random, 8, () => rampColor(SNOW_RAMP, 0));
  return texture;
}

async function paintSnowySide(): Promise<Texture> {
  const random = createRandom("grass_snowy_side");
  const side = await Texture.loadPng(DIRT_TEXTURE_PATH);
  const frostGrassTurf = paintTurf("grass_snowy_frost", {
    ramp: FROST_GRASS_RAMP,
    weights: [0.2, 0.35, 0.3, 0.15],
    bladeCount: 8,
  });
  const frostDepths = createFringeDepths(random, 5, 6);
  overlayFringe(side, frostGrassTurf, FROST_GRASS_RAMP, frostDepths);
  shadeSoilUnderFringe(side, frostDepths);
  const snowDepths = createFringeDepths(random, 3, 4).map((depth, column) => Math.min(depth, frostDepths[column] - 1));
  overlayFringe(side, paintSnowTop(), SNOW_RAMP, snowDepths);
  return side;
}

function paintPodzolTop(): Texture {
  const random = createRandom("podzol_top");
  const ramp = createRamp("#4f3119", "#61401f", "#744e27", "#8a6030", "#a07038");
  const litter = createPercentileNoise(random, [
    { cellWidth: 4, weight: 0.6 },
    { cellWidth: 2, weight: 1 },
  ]);
  const texture = paintPercentileRamp(new Texture(), ramp, litter, [0.14, 0.3, 0.32, 0.18, 0.06]);
  for (let needle = 0; needle < 12; needle++) {
    const startX = random.integer(0, TEXTURE_SIZE - 1);
    const startY = random.integer(0, TEXTURE_SIZE - 1);
    const heading = random.pick([
      [1, 1],
      [1, -1],
      [1, 0],
    ]);
    const length = random.integer(2, 3);
    drawFlatLine(
      texture,
      startX,
      startY,
      startX + heading[0] * length,
      startY + heading[1] * length,
      rampColor(ramp, needle % 3 === 0 ? 4 : 3)
    );
    texture.set(startX + heading[0] * (length + 1), startY + heading[1] * (length + 1), rampColor(ramp, 0));
  }
  scatterPixels(texture, random, 5, () => rampColor(ramp, 0));
  return texture;
}

async function paintCoarseDirt(): Promise<Texture> {
  const random = createRandom("coarse_dirt");
  const texture = await Texture.loadPng(DIRT_TEXTURE_PATH);
  const pebbleLight = createRamp("#9a8c7a", "#8a7d6b");
  const pebbleBody = createRamp("#74685a", "#675c4f");
  const pebbleShadow = createRamp("#3e342b", "#4a3f34");
  const occupied = new Set<string>();
  let pebblesPlaced = 0;
  while (pebblesPlaced < 8) {
    const pebbleX = random.integer(0, TEXTURE_SIZE - 1);
    const pebbleY = random.integer(0, TEXTURE_SIZE - 1);
    const tooClose = [...occupied].some((key) => {
      const [otherX, otherY] = key.split(",").map(Number);
      const wrapDistance = (first: number, second: number) =>
        Math.min(Math.abs(first - second), TEXTURE_SIZE - Math.abs(first - second));
      return wrapDistance(otherX, pebbleX) < 4 && wrapDistance(otherY, pebbleY) < 4;
    });
    if (tooClose) continue;
    occupied.add(`${pebbleX},${pebbleY}`);
    pebblesPlaced++;
    const wide = random.chance(0.5);
    texture.set(pebbleX, pebbleY, random.pick(pebbleLight));
    texture.set(pebbleX + 1, pebbleY, random.pick(pebbleBody));
    texture.set(pebbleX, pebbleY + 1, random.pick(pebbleBody));
    texture.set(pebbleX + 1, pebbleY + 1, random.pick(pebbleShadow));
    if (wide) {
      texture.set(pebbleX + 2, pebbleY, random.pick(pebbleBody));
      texture.set(pebbleX + 2, pebbleY + 1, random.pick(pebbleShadow));
    }
  }
  return texture;
}

function paintMud(): Texture {
  const random = createRandom("mud");
  const ramp = createRamp("#2e231b", "#3a2c21", "#493827", "#5a4533");
  const puddles = createPercentileNoise(random, [
    { cellWidth: 8, cellHeight: 8, weight: 1 },
    { cellWidth: 4, cellHeight: 4, weight: 0.5 },
  ]);
  const texture = paintPercentileRamp(new Texture(), ramp, puddles, [0.3, 0.32, 0.24, 0.14]);
  const sheenBody: Rgb = [92, 84, 82];
  const sheenCore: Rgb = [138, 128, 120];
  for (const [startX, startY, length] of [
    [2, 3, 3],
    [10, 6, 4],
    [5, 11, 3],
    [12, 13, 2],
  ]) {
    for (let offset = 0; offset < length; offset++) {
      const isCore = offset === 1;
      texture.set(startX + offset, startY, isCore ? sheenCore : sheenBody);
    }
    texture.set(startX + length, startY + 1, rampColor(ramp, 0));
  }
  scatterPixels(texture, random, 6, () => rampColor(ramp, 0));
  scatterPixels(texture, random, 4, () => rampColor(ramp, 3));
  return texture;
}

function paintPeat(): Texture {
  const random = createRandom("peat");
  const ramp = createRamp("#1c140f", "#261c15", "#32261b", "#43331f", "#564229");
  const fibers = createPercentileNoise(random, [
    { cellWidth: 4, cellHeight: 2, weight: 1 },
    { cellWidth: 2, cellHeight: 2, weight: 0.5 },
  ]);
  const texture = paintPercentileRamp(new Texture(), ramp, fibers, [0.24, 0.32, 0.26, 0.13, 0.05]);
  for (let fiber = 0; fiber < 11; fiber++) {
    const startX = random.integer(0, TEXTURE_SIZE - 1);
    const startY = random.integer(0, TEXTURE_SIZE - 1);
    const length = random.integer(3, 5);
    const driftDirection = random.pick([-1, 1]);
    const fiberColor = rampColor(ramp, fiber % 4 === 0 ? 4 : 3);
    for (let offset = 0; offset < length; offset++) {
      texture.set(startX + offset, startY + (offset > length / 2 ? driftDirection : 0), fiberColor);
    }
    texture.set(startX + 1, startY + 2, rampColor(ramp, 0));
  }
  return texture;
}

function paintMoss(): Texture {
  const random = createRandom("moss");
  const ramp = createRamp("#233a14", "#2f4d1b", "#3d6623", "#4f8230", "#659c3d", "#82b855");
  const clumpField = createCellField(random, 4, { jitter: 0.7 });
  const grain = createPercentileNoise(random, [{ cellWidth: 2, weight: 1 }]);
  const clumpHeight = createPercentileField((x, y) => {
    const cell = clumpField(x, y);
    const dome = 1 - cell.nearestDistance / 3.2;
    const lighting = -(cell.offsetX + cell.offsetY) / 6;
    return dome * 0.75 + lighting * 0.55 + grain(x, y) * 0.22 + cell.cellIndex * 0.004;
  });
  const texture = paintPercentileRamp(new Texture(), ramp, clumpHeight, [0.14, 0.2, 0.24, 0.22, 0.14, 0.06]);
  scatterPixels(texture, random, 4, () => [176, 206, 108]);
  return texture;
}

function paintRedSand(): Texture {
  const random = createRandom("red_sand");
  const ramp = createRamp("#b24f25", "#c05a2b", "#cc6a32", "#d97d40", "#e69457");
  const drift = createPercentileNoise(random, [
    { cellWidth: 8, cellHeight: 4, weight: 1 },
    { cellWidth: 4, cellHeight: 2, weight: 0.8 },
  ]);
  const texture = paintPercentileRamp(new Texture(), ramp, drift, [0.08, 0.28, 0.36, 0.2, 0.08]);
  scatterPixels(texture, random, 14, () => rampColor(ramp, 4));
  scatterPixels(texture, random, 12, () => rampColor(ramp, 0));
  scatterShapes(texture, random, 4, SMALL_BLOB_SHAPES.slice(0, 2), () => [240, 168, 112]);
  return texture;
}

function paintAsh(): Texture {
  const random = createRandom("ash");
  const ramp = createRamp("#767579", "#88878b", "#9b9a9e", "#adadb0", "#c0c0c3");
  const softness = createPercentileNoise(random, [
    { cellWidth: 8, weight: 1 },
    { cellWidth: 4, weight: 0.9 },
    { cellWidth: 2, weight: 0.4 },
  ]);
  const texture = paintPercentileRamp(new Texture(), ramp, softness, [0.14, 0.25, 0.3, 0.21, 0.1]);
  scatterPixels(texture, random, 5, () => [66, 64, 70]);
  scatterShapes(texture, random, 3, SMALL_BLOB_SHAPES.slice(0, 2), () => [88, 86, 92]);
  scatterPixels(texture, random, 5, () => [214, 213, 216]);
  return texture;
}

export async function soilTextures(): Promise<TextureDefinition[]> {
  const turfVariants = { lush: LUSH, dry: DRY, cold: COLD } as const;
  const definitions: TextureDefinition[] = [];
  for (const [variantName, palette] of Object.entries(turfVariants)) {
    definitions.push({ fileName: `grass_${variantName}_top.png`, draw: () => paintTurf(`grass_${variantName}_top`, palette) });
    definitions.push({
      fileName: `grass_${variantName}_side.png`,
      draw: () =>
        paintFringedSide(
          `grass_${variantName}_side`,
          paintTurf(`grass_${variantName}_top`, palette),
          palette.ramp,
          [4, 5]
        ),
    });
  }
  definitions.push(
    { fileName: "grass_meadow_top.png", draw: paintMeadowTop },
    {
      fileName: "grass_meadow_side.png",
      draw: () => paintFringedSide("grass_meadow_side", paintMeadowTop(), MEADOW.ramp, [4, 5]),
    },
    { fileName: "grass_snowy_top.png", draw: paintSnowTop },
    { fileName: "grass_snowy_side.png", draw: paintSnowySide },
    { fileName: "podzol_top.png", draw: paintPodzolTop },
    {
      fileName: "podzol_side.png",
      draw: () =>
        paintFringedSide(
          "podzol_side",
          paintPodzolTop(),
          createRamp("#4f3119", "#61401f", "#744e27", "#8a6030", "#a07038"),
          [3, 5]
        ),
    },
    { fileName: "coarse_dirt.png", draw: paintCoarseDirt },
    { fileName: "mud.png", draw: paintMud },
    { fileName: "peat.png", draw: paintPeat },
    { fileName: "moss.png", draw: paintMoss },
    { fileName: "red_sand.png", draw: paintRedSand },
    { fileName: "ash.png", draw: paintAsh }
  );
  return definitions;
}
