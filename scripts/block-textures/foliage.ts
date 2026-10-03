// Leaf textures: clustered canopy shapes with transparent holes (alpha 0), bright rim pixels and dark gaps, plus species decorations.

import { createRamp, rampByDistribution, rampIndexByDistribution, rampColor, type Ramp, type Rgb } from "./color";
import { createPercentileNoise, TEXTURE_SIZE } from "./noise";
import { drawFlatLine, scatterPixels } from "./painters";
import { createRandom, type Random } from "./random";
import { Texture, type TextureDefinition } from "./texture";

interface LeafStyle {
  name: string;
  ramp: Ramp;
  weights: readonly number[];
  clusterWidth: number;
  clusterHeight: number;
  holeWidth: number;
  holeHeight: number;
  holeFraction: number;
  decorate?: (texture: Texture, random: Random, ramp: Ramp) => void;
}

function paintLeaves(style: LeafStyle): Texture {
  const random = createRandom(`leaves_${style.name}`);
  const clusters = createPercentileNoise(random, [
    { cellWidth: style.clusterWidth, cellHeight: style.clusterHeight, weight: 1 },
    { cellWidth: 2, cellHeight: 2, weight: 0.95 },
  ]);
  const holes = createPercentileNoise(random, [
    { cellWidth: style.holeWidth, cellHeight: style.holeHeight, weight: 0.7 },
    { cellWidth: 2, cellHeight: 2, weight: 1 },
  ]);
  const isHole = (x: number, y: number) => holes(x, y) < style.holeFraction;
  const texture = new Texture().paint((x, y) => {
    if (isHole(x, y)) return null;
    let level = rampIndexByDistribution(style.ramp, clusters(x, y), style.weights);
    if (isHole(x - 1, y) || isHole(x, y - 1)) level += 1;
    if (isHole(x + 1, y) || isHole(x, y + 1)) level -= 1;
    if (isHole(x + 1, y + 1) && level > 1) level -= 1;
    return rampColor(style.ramp, level);
  });
  style.decorate?.(texture, random, style.ramp);
  return texture;
}

function paintOnlyOpaque(texture: Texture, x: number, y: number, color: Rgb): void {
  if (texture.get(x, y)) texture.set(x, y, color);
}

const needleStrokes = (texture: Texture, random: Random, ramp: Ramp) => {
  for (let needle = 0; needle < 14; needle++) {
    const startX = random.integer(0, TEXTURE_SIZE - 1);
    const startY = random.integer(0, TEXTURE_SIZE - 1);
    const direction = needle % 2 === 0 ? 1 : -1;
    const strokeColor = rampColor(ramp, needle % 3 === 0 ? ramp.length - 1 : 1);
    for (let step = 0; step < 3; step++) paintOnlyOpaque(texture, startX + step, startY + step * direction, strokeColor);
  }
  scatterPixels(texture, random, 6, () => rampColor(ramp, 0));
};

const palmFronds = (texture: Texture, random: Random, ramp: Ramp) => {
  const fronds = [
    { startX: 0, startY: 14, endX: 13, endY: 1 },
    { startX: 4, startY: 15, endX: 16, endY: 5 },
    { startX: 1, startY: 6, endX: 9, endY: -1 },
  ];
  for (const frond of fronds) {
    const length = Math.max(Math.abs(frond.endX - frond.startX), Math.abs(frond.endY - frond.startY));
    for (let step = 0; step <= length; step++) {
      const progress = step / length;
      const spineX = frond.startX + (frond.endX - frond.startX) * progress;
      const spineY = frond.startY + (frond.endY - frond.startY) * progress;
      texture.set(spineX, spineY, rampColor(ramp, ramp.length - 2));
      if (step % 2 === 0) {
        texture.set(spineX + 1, spineY + 1, rampColor(ramp, 2));
        texture.set(spineX - 1, spineY - 1, rampColor(ramp, ramp.length - 1));
      }
    }
  }
  scatterPixels(texture, random, 6, () => rampColor(ramp, 0));
};

const bigLeafRibs = (texture: Texture, random: Random, ramp: Ramp) => {
  for (const rib of [
    { startX: 1, startY: 5, length: 6 },
    { startX: 9, startY: 12, length: 5 },
    { startX: 8, startY: 3, length: 4 },
  ]) {
    for (let step = 0; step < rib.length; step++) {
      paintOnlyOpaque(texture, rib.startX + step, rib.startY + Math.floor(step / 2), rampColor(ramp, ramp.length - 1));
      paintOnlyOpaque(texture, rib.startX + step, rib.startY + Math.floor(step / 2) + 1, rampColor(ramp, 0));
    }
  }
};

const blossomDots = (texture: Texture, random: Random) => {
  const dotColors: Rgb[] = [
    [255, 250, 250],
    [226, 70, 148],
    [255, 238, 244],
    [200, 54, 120],
  ];
  for (let dot = 0; dot < 11; dot++) {
    paintOnlyOpaque(texture, random.integer(0, 15), random.integer(0, 15), dotColors[dot % dotColors.length]);
  }
};

const glossHighlights = (texture: Texture, random: Random, ramp: Ramp) => {
  for (let gloss = 0; gloss < 6; gloss++) {
    const glossX = random.integer(0, 14);
    const glossY = random.integer(0, 14);
    paintOnlyOpaque(texture, glossX, glossY, rampColor(ramp, ramp.length - 1));
    paintOnlyOpaque(texture, glossX + 1, glossY, [170, 214, 150]);
  }
};

const autumnGreenRemnants = (texture: Texture, random: Random) => {
  scatterPixels(texture, random, 4, () => [92, 112, 36]);
};

const lightFlecks = (texture: Texture, random: Random, ramp: Ramp) => {
  scatterPixels(texture, random, 6, () => rampColor(ramp, ramp.length - 1));
};

const LEAF_STYLES: LeafStyle[] = [
  { name: "birch", ramp: createRamp("#587a24", "#6e9230", "#86aa3e", "#a0c452", "#bcdc6c"), weights: [0.14, 0.28, 0.3, 0.2, 0.08], clusterWidth: 4, clusterHeight: 4, holeWidth: 4, holeHeight: 4, holeFraction: 0.22, decorate: lightFlecks },
  { name: "spruce", ramp: createRamp("#1a3a30", "#244a3b", "#2f5c48", "#3e7058", "#528a6c"), weights: [0.2, 0.3, 0.26, 0.16, 0.08], clusterWidth: 4, clusterHeight: 4, holeWidth: 4, holeHeight: 2, holeFraction: 0.24, decorate: needleStrokes },
  { name: "acacia", ramp: createRamp("#505a1e", "#66722a", "#7e8a36", "#97a444", "#b2bd58"), weights: [0.16, 0.3, 0.3, 0.17, 0.07], clusterWidth: 8, clusterHeight: 4, holeWidth: 8, holeHeight: 4, holeFraction: 0.26, decorate: lightFlecks },
  { name: "jungle", ramp: createRamp("#10441c", "#17582a", "#1f6e34", "#2b8741", "#40a054"), weights: [0.16, 0.3, 0.3, 0.16, 0.08], clusterWidth: 8, clusterHeight: 8, holeWidth: 8, holeHeight: 8, holeFraction: 0.22, decorate: bigLeafRibs },
  { name: "autumn_red", ramp: createRamp("#6a1a16", "#852420", "#a3322a", "#c14636", "#dc6044"), weights: [0.15, 0.28, 0.3, 0.19, 0.08], clusterWidth: 4, clusterHeight: 4, holeWidth: 4, holeHeight: 4, holeFraction: 0.23, decorate: (texture, random) => autumnGreenRemnants(texture, random) },
  { name: "autumn_orange", ramp: createRamp("#7a3a12", "#975018", "#b4681f", "#d0822c", "#e69c42"), weights: [0.15, 0.28, 0.3, 0.19, 0.08], clusterWidth: 4, clusterHeight: 4, holeWidth: 4, holeHeight: 4, holeFraction: 0.23, decorate: lightFlecks },
  { name: "autumn_yellow", ramp: createRamp("#8a6c16", "#a68620", "#c2a22c", "#dcbc3c", "#f0d458"), weights: [0.15, 0.28, 0.3, 0.19, 0.08], clusterWidth: 4, clusterHeight: 4, holeWidth: 4, holeHeight: 4, holeFraction: 0.23, decorate: lightFlecks },
  { name: "blossom", ramp: createRamp("#b8567e", "#d06f92", "#e28cab", "#f0a9c2", "#fbc9da"), weights: [0.14, 0.26, 0.3, 0.2, 0.1], clusterWidth: 4, clusterHeight: 4, holeWidth: 4, holeHeight: 4, holeFraction: 0.12, decorate: (texture, random) => blossomDots(texture, random) },
  { name: "palm", ramp: createRamp("#2a5a1c", "#38701f", "#49872a", "#5f9f38", "#7ab84c"), weights: [0.2, 0.3, 0.25, 0.17, 0.08], clusterWidth: 8, clusterHeight: 8, holeWidth: 4, holeHeight: 4, holeFraction: 0.3, decorate: palmFronds },
  { name: "mangrove", ramp: createRamp("#143a1e", "#1c4c28", "#265f32", "#34763f", "#488e50"), weights: [0.18, 0.3, 0.28, 0.16, 0.08], clusterWidth: 4, clusterHeight: 4, holeWidth: 4, holeHeight: 4, holeFraction: 0.2, decorate: glossHighlights },
  { name: "redwood", ramp: createRamp("#24401c", "#31522a", "#406636", "#547c40", "#6c9450"), weights: [0.18, 0.3, 0.28, 0.16, 0.08], clusterWidth: 4, clusterHeight: 4, holeWidth: 4, holeHeight: 4, holeFraction: 0.24, decorate: (texture, random) => scatterPixels(texture, random, 8, () => [126, 94, 44]) },
];

export async function foliageTextures(): Promise<TextureDefinition[]> {
  return LEAF_STYLES.map((style) => ({ fileName: `leaves_${style.name}.png`, draw: () => paintLeaves(style) }));
}
