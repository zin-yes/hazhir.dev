// Color types, hex parsing and palette ramp helpers (ramps run dark to light).

export type Rgb = readonly [number, number, number];
export type Ramp = readonly Rgb[];

export function hexToRgb(hex: string): Rgb {
  const digits = hex.replace("#", "");
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
  ];
}

export function createRamp(...hexColors: string[]): Ramp {
  return hexColors.map(hexToRgb);
}

export function mixColors(first: Rgb, second: Rgb, amount: number): Rgb {
  return [
    Math.round(first[0] + (second[0] - first[0]) * amount),
    Math.round(first[1] + (second[1] - first[1]) * amount),
    Math.round(first[2] + (second[2] - first[2]) * amount),
  ];
}

export function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}

export function rampColor(ramp: Ramp, index: number): Rgb {
  return ramp[clampIndex(Math.round(index), ramp.length)];
}

/** Maps a percentile (0..1) to a ramp entry; weights say how much of the surface each entry covers. */
export function rampByDistribution(ramp: Ramp, percentile: number, weights?: readonly number[]): Rgb {
  const resolvedWeights = weights ?? ramp.map(() => 1);
  const total = resolvedWeights.reduce((sum, weight) => sum + weight, 0);
  let accumulated = 0;
  for (let index = 0; index < ramp.length; index++) {
    accumulated += resolvedWeights[index] / total;
    if (percentile <= accumulated) return ramp[index];
  }
  return ramp[ramp.length - 1];
}

export function rampIndexByDistribution(ramp: Ramp, percentile: number, weights?: readonly number[]): number {
  const resolvedWeights = weights ?? ramp.map(() => 1);
  const total = resolvedWeights.reduce((sum, weight) => sum + weight, 0);
  let accumulated = 0;
  for (let index = 0; index < ramp.length; index++) {
    accumulated += resolvedWeights[index] / total;
    if (percentile <= accumulated) return index;
  }
  return ramp.length - 1;
}

const BAYER_FOUR_BY_FOUR = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Ordered-dither threshold in (-0.5, 0.5) for a pixel. */
export function bayerOffset(x: number, y: number): number {
  return (BAYER_FOUR_BY_FOUR[((y % 4) + 4) % 4][((x % 4) + 4) % 4] + 0.5) / 16 - 0.5;
}

export function nearestRampIndex(ramp: Ramp, color: Rgb): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  ramp.forEach((candidate, index) => {
    const distance =
      (candidate[0] - color[0]) ** 2 + (candidate[1] - color[1]) ** 2 + (candidate[2] - color[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function shiftAlongRamp(ramp: Ramp, color: Rgb, steps: number): Rgb {
  return rampColor(ramp, nearestRampIndex(ramp, color) + steps);
}
