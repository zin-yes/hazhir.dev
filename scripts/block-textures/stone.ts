// Mineral and ice textures: limestone, slate, obsidian, sulfur, salt, ice, snow, travertine, magma, basalt and sandstone strata.

import { createRamp, rampByDistribution, rampColor, shiftAlongRamp, type Ramp, type Rgb } from "./color";
import {
  createCellField,
  createLineNoise,
  createPercentileField,
  createPercentileNoise,
  createValueNoise,
  TEXTURE_SIZE,
} from "./noise";
import {
  drawCrack,
  drawFlatLine,
  paintPercentileRamp,
  scatterPixels,
  scatterShapes,
  SMALL_BLOB_SHAPES,
} from "./painters";
import { createRandom } from "./random";
import { Texture, type TextureDefinition } from "./texture";

function cellTone(cellIndex: number): number {
  return (cellIndex * 0.6180339887) % 1;
}

function paintLimestone(): Texture {
  const random = createRandom("limestone");
  const ramp = createRamp("#a9a28c", "#bcb59f", "#cdc7b2", "#dbd6c3", "#e8e4d5");
  const layerBands = createValueNoise(random, 16, 3);
  const grain = createPercentileNoise(random, [{ cellWidth: 4, cellHeight: 2, weight: 1 }]);
  const layered = createPercentileField((x, y) => layerBands(x, y) * 0.65 + grain(x, y) * 0.35);
  const texture = paintPercentileRamp(new Texture(), ramp, layered, [0.1, 0.24, 0.32, 0.24, 0.1]);
  for (let pit = 0; pit < 6; pit++) {
    const pitX = random.integer(0, TEXTURE_SIZE - 1);
    const pitY = random.integer(0, TEXTURE_SIZE - 1);
    texture.set(pitX, pitY, rampColor(ramp, 0));
    if (pit % 2 === 0) texture.set(pitX + 1, pitY, rampColor(ramp, 1));
    texture.set(pitX + 1, pitY + 1, rampColor(ramp, 4));
  }
  scatterPixels(texture, random, 6, () => rampColor(ramp, 1));
  return texture;
}

function paintSlate(): Texture {
  const random = createRandom("slate");
  const ramp = createRamp("#232a35", "#2e3644", "#3a4455", "#485367", "#5b687d");
  const texture = Texture.filled(rampColor(ramp, 1));
  const rowLevel = createLineNoise(random, 4);
  const shadowRuns: { startX: number; length: number; rowY: number }[] = [];
  for (let rowY = 0; rowY < TEXTURE_SIZE; rowY++) {
    const baseLevel = 0.6 + rowLevel(rowY) * 2.6;
    let cursorX = random.integer(0, 5);
    const rowStart = cursorX;
    while (cursorX < rowStart + TEXTURE_SIZE) {
      const length = random.integer(3, 7);
      const level = Math.round(baseLevel + random.range(-1, 1));
      for (let offset = 0; offset < length; offset++) {
        texture.set(cursorX + offset, rowY, rampColor(ramp, offset === 0 ? level + 1 : level));
      }
      if (random.chance(0.55)) shadowRuns.push({ startX: cursorX, length, rowY });
      cursorX += length;
    }
  }
  for (const run of shadowRuns) {
    for (let offset = 1; offset < run.length; offset++) {
      const below = texture.get(run.startX + offset, run.rowY + 1);
      if (below) texture.set(run.startX + offset, run.rowY + 1, shiftAlongRamp(ramp, below, -1));
    }
  }
  scatterPixels(texture, random, 5, () => rampColor(ramp, 4));
  return texture;
}

function paintObsidian(): Texture {
  const random = createRandom("obsidian");
  const ramp = createRamp("#0b0713", "#130d21", "#1b1230", "#281b45");
  const glass = createPercentileNoise(random, [
    { cellWidth: 8, weight: 1 },
    { cellWidth: 4, weight: 0.5 },
  ]);
  const texture = paintPercentileRamp(new Texture(), ramp, glass, [0.3, 0.34, 0.24, 0.12]);
  const violetBody: Rgb = [74, 50, 132];
  const violetBright: Rgb = [128, 96, 214];
  const violetGlint: Rgb = [186, 160, 255];
  for (const streak of [
    { startX: 2, startY: 5, length: 5 },
    { startX: 9, startY: 12, length: 4 },
    { startX: 11, startY: 2, length: 3 },
  ]) {
    drawFlatLine(
      texture,
      streak.startX,
      streak.startY,
      streak.startX + streak.length,
      streak.startY - streak.length,
      violetBody
    );
    texture.set(streak.startX + 1, streak.startY - 1, violetBright);
    texture.set(streak.startX + 2, streak.startY - 2, violetGlint);
    texture.set(streak.startX + streak.length - 1, streak.startY - streak.length + 1, violetBright);
  }
  drawCrack(texture, random, 13, 7, 6, 0, 1, [4, 2, 8], 0.5);
  drawCrack(texture, random, 4, 12, 5, 1, 0, [4, 2, 8], 0.5);
  scatterPixels(texture, random, 8, () => [52, 36, 92]);
  return texture;
}

function paintSulfur(): Texture {
  const random = createRandom("sulfur");
  const ramp = createRamp("#7d6c10", "#a38f18", "#c8b222", "#e2cc35", "#f3e45c", "#fff6a6");
  const crystals = createCellField(random, 5, { jitter: 0.9 });
  const facetField = createPercentileField((x, y) => {
    const cell = crystals(x, y);
    const edge = cell.secondNearestDistance - cell.nearestDistance;
    const lighting = -(cell.offsetX + cell.offsetY) / 5;
    return cellTone(cell.cellIndex) * 0.55 + lighting * 0.5 + Math.min(edge, 1.6) * 0.18;
  });
  const texture = paintPercentileRamp(new Texture(), ramp, facetField, [0.1, 0.2, 0.28, 0.24, 0.12, 0.06]);
  texture.paint((x, y) => {
    const cell = crystals(x, y);
    const edge = cell.secondNearestDistance - cell.nearestDistance;
    const existing = texture.get(x, y) as Rgb;
    return edge < 0.55 ? shiftAlongRamp(ramp, existing, -2) : existing;
  });
  scatterPixels(texture, random, 5, () => rampColor(ramp, 5));
  scatterPixels(texture, random, 4, () => [92, 78, 12]);
  return texture;
}

function paintSalt(): Texture {
  const random = createRandom("salt");
  const ramp = createRamp("#b8b3ad", "#cdc9c2", "#e0ddd6", "#f0eee8", "#ffffff");
  const crystals = createCellField(random, 5, { jitter: 0.8 });
  const facetField = createPercentileField((x, y) => {
    const cell = crystals(x, y);
    const edge = cell.secondNearestDistance - cell.nearestDistance;
    const lighting = -(cell.offsetX + cell.offsetY) / 5;
    return cellTone(cell.cellIndex) * 0.4 + lighting * 0.5 + Math.min(edge, 1.4) * 0.25;
  });
  const texture = paintPercentileRamp(new Texture(), ramp, facetField, [0.1, 0.18, 0.28, 0.28, 0.16]);
  scatterPixels(texture, random, 5, () => [206, 218, 232]);
  scatterPixels(texture, random, 4, () => [236, 214, 212]);
  for (const sparkle of [
    [4, 3],
    [11, 10],
  ]) {
    texture.set(sparkle[0], sparkle[1], [255, 255, 255]);
    texture.set(sparkle[0] - 1, sparkle[1], [236, 244, 252]);
    texture.set(sparkle[0] + 1, sparkle[1], [236, 244, 252]);
    texture.set(sparkle[0], sparkle[1] - 1, [236, 244, 252]);
    texture.set(sparkle[0], sparkle[1] + 1, [236, 244, 252]);
  }
  return texture;
}

function paintIce(): Texture {
  const random = createRandom("ice");
  const ramp = createRamp("#78b8d6", "#90cbe2", "#aadbee", "#c6ebf7", "#e4f8fd");
  const depth = createPercentileNoise(random, [
    { cellWidth: 8, cellHeight: 8, weight: 1 },
    { cellWidth: 4, cellHeight: 4, weight: 0.7 },
  ]);
  const texture = paintPercentileRamp(new Texture(), ramp, depth, [0.1, 0.24, 0.34, 0.22, 0.1]);
  const crackLight: Rgb = [240, 252, 255];
  const crackShadow: Rgb = [100, 166, 196];
  for (const crack of [
    { startX: 1, startY: 13, steps: 8, headingX: 1, headingY: -1 },
    { startX: 9, startY: 15, steps: 6, headingX: 1, headingY: -1 },
    { startX: 6, startY: 6, steps: 5, headingX: 1, headingY: 1 },
  ]) {
    drawCrack(texture, random, crack.startX, crack.startY + 1, crack.steps, crack.headingX, crack.headingY, crackShadow, 0.2);
    drawCrack(texture, random, crack.startX, crack.startY, crack.steps, crack.headingX, crack.headingY, crackLight, 0.2);
  }
  scatterShapes(texture, random, 3, SMALL_BLOB_SHAPES.slice(0, 2), () => crackShadow);
  scatterPixels(texture, random, 6, () => [248, 254, 255]);
  return texture;
}

function paintPackedIce(): Texture {
  const random = createRandom("packed_ice");
  const ramp = createRamp("#3f72b4", "#5286c6", "#689bd5", "#82b2e2", "#a3c9ee");
  const facets = createCellField(random, 3, { jitter: 0.9 });
  const facetField = createPercentileField((x, y) => {
    const cell = facets(x, y);
    const lighting = -(cell.offsetX + cell.offsetY) / 7;
    return cellTone(cell.cellIndex) * 0.6 + lighting * 0.5;
  });
  const texture = paintPercentileRamp(new Texture(), ramp, facetField, [0.12, 0.24, 0.3, 0.22, 0.12]);
  texture.paint((x, y) => {
    const cell = facets(x, y);
    const edge = cell.secondNearestDistance - cell.nearestDistance;
    const existing = texture.get(x, y) as Rgb;
    if (edge < 0.5) return [52, 100, 168];
    if (edge < 1.1) return shiftAlongRamp(ramp, existing, 1);
    return existing;
  });
  scatterPixels(texture, random, 7, () => [196, 224, 248]);
  scatterPixels(texture, random, 5, () => [38, 78, 140]);
  return texture;
}

function paintSnowBlock(): Texture {
  const random = createRandom("snow_block");
  const ramp = createRamp("#c3d2e4", "#d6e2f0", "#e6eef7", "#f4f8fc", "#ffffff");
  const clumps = createCellField(random, 4, { jitter: 0.8 });
  const grain = createPercentileNoise(random, [{ cellWidth: 2, weight: 1 }]);
  const clumpHeight = createPercentileField((x, y) => {
    const cell = clumps(x, y);
    const dome = 1 - cell.nearestDistance / 3.4;
    const lighting = -(cell.offsetX + cell.offsetY) / 6;
    return dome * 0.5 + lighting * 0.6 + grain(x, y) * 0.3 + cellTone(cell.cellIndex) * 0.2;
  });
  const texture = paintPercentileRamp(new Texture(), ramp, clumpHeight, [0.07, 0.16, 0.28, 0.3, 0.19]);
  scatterPixels(texture, random, 5, () => rampColor(ramp, 0));
  return texture;
}

function paintTravertine(): Texture {
  const random = createRandom("travertine");
  const waviness = createLineNoise(random, 8);
  const secondWave = createLineNoise(random, 4);
  const bands = [
    { thickness: 3, ramp: createRamp("#e0d2b2", "#e8dcc0", "#efe5cc") },
    { thickness: 1, ramp: createRamp("#c9a672", "#d2b280") },
    { thickness: 2, ramp: createRamp("#d9c29a", "#e0cca6") },
    { thickness: 2, ramp: createRamp("#bf8c52", "#cc9a5e", "#d6a86c") },
    { thickness: 1, ramp: createRamp("#a67440", "#b2814a") },
    { thickness: 3, ramp: createRamp("#e2d5b6", "#eadfc4", "#f1e8d3") },
    { thickness: 2, ramp: createRamp("#d2b88c", "#dcc59c") },
    { thickness: 2, ramp: createRamp("#c79a60", "#d3a96e") },
  ];
  const bandAtRow = (row: number) => {
    let remaining = ((row % TEXTURE_SIZE) + TEXTURE_SIZE) % TEXTURE_SIZE;
    for (const band of bands) {
      if (remaining < band.thickness) return band;
      remaining -= band.thickness;
    }
    return bands[0];
  };
  const grain = createPercentileNoise(random, [{ cellWidth: 4, cellHeight: 2, weight: 1 }]);
  const texture = new Texture().paint((x, y) => {
    const warpedRow = Math.round(y + (waviness(x) - 0.5) * 3.4 + (secondWave(x) - 0.5) * 1.2);
    const band = bandAtRow(warpedRow);
    return rampByDistribution(band.ramp, grain(x, y));
  });
  for (let pit = 0; pit < 6; pit++) {
    const pitX = random.integer(0, TEXTURE_SIZE - 1);
    const pitY = random.integer(0, TEXTURE_SIZE - 1);
    texture.set(pitX, pitY, [156, 112, 66]);
    texture.set(pitX + 1, pitY + 1, [238, 228, 206]);
  }
  return texture;
}

function paintMagma(): Texture {
  const random = createRandom("magma");
  const crustRamp = createRamp("#1f100c", "#2b1610", "#391d14", "#4a281a", "#5e3622");
  const plates = createCellField(random, 4, { jitter: 0.95 });
  const heatVariation = createValueNoise(random, 4, 4);
  const grain = createPercentileNoise(random, [{ cellWidth: 2, weight: 1 }]);
  const crustField = createPercentileField((x, y) => {
    const cell = plates(x, y);
    const lighting = -(cell.offsetX + cell.offsetY) / 6;
    return lighting * 0.6 + grain(x, y) * 0.5 + cellTone(cell.cellIndex) * 0.2;
  });
  const texture = new Texture().paint((x, y) => {
    const cell = plates(x, y);
    const edge = cell.secondNearestDistance - cell.nearestDistance;
    const heat = 0.62 + heatVariation(x, y) * 0.9;
    const scaledEdge = edge / heat;
    if (scaledEdge < 0.4) return [255, 238, 128];
    if (scaledEdge < 0.85) return [255, 160, 34];
    if (scaledEdge < 1.3) return [214, 72, 14];
    if (scaledEdge < 1.7) return [122, 36, 16];
    return rampByDistribution(crustRamp, crustField(x, y), [0.2, 0.28, 0.26, 0.18, 0.08]);
  });
  scatterPixels(texture, random, 5, () => [110, 34, 14]);
  scatterPixels(texture, random, 2, () => [232, 110, 24]);
  return texture;
}

function paintBasaltTop(): Texture {
  const random = createRandom("basalt_top");
  const ramp = createRamp("#262a32", "#303540", "#3b414d", "#474f5c", "#58626f");
  const columns = createCellField(random, 4, { jitter: 0.25, staggerRows: true });
  const grain = createPercentileNoise(random, [{ cellWidth: 2, weight: 1 }]);
  const toneField = createPercentileField((x, y) => {
    const cell = columns(x, y);
    const lighting = -(cell.offsetX + cell.offsetY) / 6;
    return cellTone(cell.cellIndex) * 0.35 + lighting * 0.55 + grain(x, y) * 0.35;
  });
  const texture = paintPercentileRamp(new Texture(), ramp, toneField, [0.14, 0.26, 0.3, 0.22, 0.08]);
  texture.paint((x, y) => {
    const cell = columns(x, y);
    const edge = cell.secondNearestDistance - cell.nearestDistance;
    const existing = texture.get(x, y) as Rgb;
    return edge < 0.75 ? [22, 25, 31] : existing;
  });
  scatterPixels(texture, random, 6, () => [24, 27, 34]);
  return texture;
}

function paintBasaltSide(): Texture {
  const random = createRandom("basalt_side");
  const ramp = createRamp("#20242b", "#2c313a", "#383e49", "#454c59", "#555e6c");
  const columnWidths = [4, 3, 5, 4];
  const boundaryColumns = new Set<number>();
  const columnTone = new Map<number, number>();
  let cursor = 0;
  columnWidths.forEach((width, index) => {
    boundaryColumns.add(cursor);
    for (let offset = 0; offset < width; offset++) columnTone.set(cursor + offset, 1.5 + (index % 2) * 0.9 + random.range(0, 0.6));
    cursor += width;
  });
  const streaks = createPercentileNoise(random, [{ cellWidth: 2, cellHeight: 8, weight: 1 }]);
  const texture = new Texture().paint((x, y) => {
    const baseLevel = (columnTone.get(x) ?? 2) + (streaks(x, y) - 0.5) * 1.8;
    let level = Math.round(baseLevel);
    const columnStart = boundaryColumns.has(x);
    const columnEnd = boundaryColumns.has((x + 1) % TEXTURE_SIZE);
    if (columnStart) level = level + 1;
    if (columnEnd) level = level - 1;
    return rampColor(ramp, level);
  });
  for (const boundaryColumn of boundaryColumns) {
    const crackColumn = (boundaryColumn + TEXTURE_SIZE - 1) % TEXTURE_SIZE;
    for (let rowY = 0; rowY < TEXTURE_SIZE; rowY++) {
      if (random.chance(0.8)) texture.set(crackColumn, rowY, [17, 19, 24]);
    }
  }
  for (let crack = 0; crack < 4; crack++) {
    const startX = random.integer(0, TEXTURE_SIZE - 1);
    drawCrack(texture, random, startX, random.integer(0, TEXTURE_SIZE - 6), random.integer(3, 5), 0, 1, [19, 22, 28], 0.3);
  }
  scatterPixels(texture, random, 6, () => rampColor(ramp, 4));
  return texture;
}

interface StrataPalette {
  ramp: Ramp;
  seamColor: Rgb;
  grainColors: readonly Rgb[];
}

function paintStrataSide(seedText: string, palette: StrataPalette): Texture {
  const random = createRandom(seedText);
  const waviness = createLineNoise(random, 8);
  const layerThicknesses = [3, 2, 4, 2, 3, 2];
  const layerLevels = [2, 1, 3, 1, 2, 0];
  const grain = createPercentileNoise(random, [{ cellWidth: 4, cellHeight: 2, weight: 1 }]);
  const layerAtRow = (row: number) => {
    let remaining = ((row % TEXTURE_SIZE) + TEXTURE_SIZE) % TEXTURE_SIZE;
    for (let layer = 0; layer < layerThicknesses.length; layer++) {
      if (remaining < layerThicknesses[layer]) return { layer, isSeam: remaining === layerThicknesses[layer] - 1 };
      remaining -= layerThicknesses[layer];
    }
    return { layer: 0, isSeam: false };
  };
  const texture = new Texture().paint((x, y) => {
    const warpedRow = Math.round(y + (waviness(x) - 0.5) * 2.2);
    const { layer, isSeam } = layerAtRow(warpedRow);
    const grainShift = grain(x, y) < 0.25 ? -1 : grain(x, y) > 0.78 ? 1 : 0;
    const level = layerLevels[layer] + grainShift;
    if (isSeam && layerThicknesses[layer] > 2) return palette.seamColor;
    return rampColor(palette.ramp, level);
  });
  scatterPixels(texture, random, 8, () => random.pick(palette.grainColors));
  return texture;
}

function paintSandyTop(seedText: string, palette: StrataPalette): Texture {
  const random = createRandom(seedText);
  const drift = createPercentileNoise(random, [
    { cellWidth: 8, cellHeight: 4, weight: 1 },
    { cellWidth: 4, cellHeight: 2, weight: 0.8 },
  ]);
  const texture = paintPercentileRamp(new Texture(), palette.ramp, drift, [0.12, 0.3, 0.36, 0.2, 0.02]);
  scatterPixels(texture, random, 14, () => random.pick(palette.grainColors));
  scatterPixels(texture, random, 8, () => palette.seamColor);
  return texture;
}

const SANDSTONE: StrataPalette = {
  ramp: createRamp("#bda978", "#cab685", "#d8c595", "#e4d4a7", "#eee1bd"),
  seamColor: [176, 158, 114],
  grainColors: [
    [238, 226, 188],
    [196, 178, 130],
  ],
};
const RED_SANDSTONE: StrataPalette = {
  ramp: createRamp("#8e3f22", "#a04b28", "#b3592f", "#c46a3b", "#d57f4c"),
  seamColor: [128, 56, 30],
  grainColors: [
    [226, 140, 88],
    [124, 52, 28],
  ],
};

interface ClayColors {
  fileName: string;
  ramp: Ramp;
}

const CLAY_VARIANTS: ClayColors[] = [
  { fileName: "terracotta.png", ramp: createRamp("#9c6b5e", "#a9786a", "#b58577", "#c19285") },
  { fileName: "terracotta_red.png", ramp: createRamp("#823727", "#923f2f", "#a24a38", "#b25644") },
  { fileName: "terracotta_orange.png", ramp: createRamp("#a2511d", "#b35e27", "#c36c35", "#d27c45") },
  { fileName: "terracotta_yellow.png", ramp: createRamp("#b08837", "#be9542", "#cca351", "#dab263") },
  { fileName: "terracotta_white.png", ramp: createRamp("#c8baa2", "#d3c6ae", "#ded2bb", "#e8ddc8") },
  { fileName: "terracotta_brown.png", ramp: createRamp("#47291c", "#533225", "#613c2d", "#704737") },
  { fileName: "terracotta_purple.png", ramp: createRamp("#765e79", "#836a82", "#917790", "#a0859e") },
];

function paintClay(seedText: string, ramp: Ramp): Texture {
  const random = createRandom(seedText);
  const faintBands = createValueNoise(random, 16, 4);
  const grain = createPercentileNoise(random, [
    { cellWidth: 8, weight: 1 },
    { cellWidth: 2, weight: 0.5 },
  ]);
  const surface = createPercentileField((x, y) => faintBands(x, y) * 0.45 + grain(x, y) * 0.55);
  const texture = paintPercentileRamp(new Texture(), ramp, surface, [0.16, 0.38, 0.32, 0.14]);
  scatterPixels(texture, random, 7, () => rampColor(ramp, 0));
  scatterPixels(texture, random, 7, () => rampColor(ramp, 3));
  return texture;
}

export async function stoneTextures(): Promise<TextureDefinition[]> {
  return [
    { fileName: "limestone.png", draw: paintLimestone },
    { fileName: "slate.png", draw: paintSlate },
    { fileName: "obsidian.png", draw: paintObsidian },
    { fileName: "sulfur.png", draw: paintSulfur },
    { fileName: "salt.png", draw: paintSalt },
    { fileName: "ice.png", draw: paintIce },
    { fileName: "packed_ice.png", draw: paintPackedIce },
    { fileName: "snow_block.png", draw: paintSnowBlock },
    { fileName: "travertine.png", draw: paintTravertine },
    { fileName: "magma.png", draw: paintMagma },
    { fileName: "basalt_top.png", draw: paintBasaltTop },
    { fileName: "basalt_side.png", draw: paintBasaltSide },
    { fileName: "sandstone_top.png", draw: () => paintSandyTop("sandstone_top", SANDSTONE) },
    { fileName: "sandstone_side.png", draw: () => paintStrataSide("sandstone_side", SANDSTONE) },
    { fileName: "red_sandstone_top.png", draw: () => paintSandyTop("red_sandstone_top", RED_SANDSTONE) },
    { fileName: "red_sandstone_side.png", draw: () => paintStrataSide("red_sandstone_side", RED_SANDSTONE) },
    ...CLAY_VARIANTS.map(
      (variant): TextureDefinition => ({
        fileName: variant.fileName,
        draw: () => paintClay(variant.fileName, variant.ramp),
      })
    ),
  ];
}
