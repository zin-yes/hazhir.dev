// Final color grade so every generated block sits in the same muted, earthy
// palette as the original textures. Terrain blocks that meet each other at
// biome borders are pulled toward the base grass and leaf colors, so
// neighbors blend instead of clashing.

import type { Rgb } from "./color";
import { mixColors } from "./color";
import type { Texture } from "./texture";

interface GradeRule {
  pattern: RegExp;
  /** 1 keeps the colors, 0 is grey. */
  saturation: number;
  /** Shifts the average color toward this one by `amount`, keeping contrast. */
  pull?: { target: Rgb; amount: number };
  /** Scales how far pixels stray from the texture's average; below 1 is calmer. */
  contrast?: number;
  /** Leaves soil-colored pixels alone (grass side fringes over dirt). */
  protectSoil?: boolean;
}

const BASE_GRASS: Rgb = [117, 137, 32];
const BASE_LEAVES: Rgb = [89, 102, 25];
const BASE_SOIL: Rgb = [106, 84, 59];
const SOIL_PROTECTION_DISTANCE = 55;

const GRADE_RULES: GradeRule[] = [
  { pattern: /^(magma|obsidian|snow_block|grass_snowy_top)/, saturation: 1 },
  { pattern: /^grass_snowy_side/, saturation: 1 },
  { pattern: /^grass_.*_top/, saturation: 0.82, contrast: 0.5, pull: { target: BASE_GRASS, amount: 0.55 } },
  { pattern: /^grass_.*_side/, saturation: 0.82, contrast: 0.5, pull: { target: BASE_GRASS, amount: 0.55 }, protectSoil: true },
  { pattern: /^leaves_(autumn|blossom)/, saturation: 0.74 },
  { pattern: /^leaves_/, saturation: 0.82, contrast: 0.8, pull: { target: BASE_LEAVES, amount: 0.35 } },
  { pattern: /^(terracotta|red_sand|red_sandstone)/, saturation: 0.66 },
  { pattern: /^(log_redwood|log_mangrove|log_acacia|log_cherry)/, saturation: 0.78 },
  { pattern: /^(moss|podzol|coarse_dirt|peat|mud)/, saturation: 0.85 },
  { pattern: /^coral_/, saturation: 0.78 },
  { pattern: /^(ice|packed_ice|sulfur|salt|travertine)/, saturation: 0.85 },
];

const DEFAULT_RULE: GradeRule = { pattern: /./, saturation: 0.88, contrast: 0.92 };

function luminance([red, green, blue]: Rgb): number {
  return 0.3 * red + 0.59 * green + 0.11 * blue;
}

function colorDistance(first: Rgb, second: Rgb): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function averageColor(texture: Texture, ignoreSoil: boolean): Rgb {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const pixel = texture.get(x, y);
      if (!pixel) continue;
      if (ignoreSoil && colorDistance(pixel, BASE_SOIL) < SOIL_PROTECTION_DISTANCE) continue;
      red += pixel[0];
      green += pixel[1];
      blue += pixel[2];
      count++;
    }
  }
  return count === 0 ? [0, 0, 0] : [red / count, green / count, blue / count];
}

export function gradeTexture(fileName: string, texture: Texture): Texture {
  const rule = GRADE_RULES.find((candidate) => candidate.pattern.test(fileName)) ?? DEFAULT_RULE;
  const average = averageColor(texture, rule.protectSoil === true);
  const pulledAverage = rule.pull ? mixColors(average, rule.pull.target, rule.pull.amount) : average;
  const shift: Rgb = [
    pulledAverage[0] - average[0],
    pulledAverage[1] - average[1],
    pulledAverage[2] - average[2],
  ];

  return texture.paint((x, y) => {
    const pixel = texture.get(x, y);
    if (!pixel) return null;
    const soilWeight = rule.protectSoil
      ? Math.max(0, 1 - colorDistance(pixel, BASE_SOIL) / SOIL_PROTECTION_DISTANCE)
      : 0;
    const shiftWeight = 1 - soilWeight;
    const contrast = 1 - (1 - (rule.contrast ?? 1)) * shiftWeight;
    const shifted: Rgb = [
      average[0] + (pixel[0] - average[0]) * contrast + shift[0] * shiftWeight,
      average[1] + (pixel[1] - average[1]) * contrast + shift[1] * shiftWeight,
      average[2] + (pixel[2] - average[2]) * contrast + shift[2] * shiftWeight,
    ];
    const grey = luminance(shifted);
    return [
      clampChannel(grey + (shifted[0] - grey) * rule.saturation),
      clampChannel(grey + (shifted[1] - grey) * rule.saturation),
      clampChannel(grey + (shifted[2] - grey) * rule.saturation),
    ];
  });
}
