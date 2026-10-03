// Maps continentalness to a base elevation, with an optional sea-cliff
// variant where the land rises abruptly out of the water.

import { lerp, sampleSpline, type SplineNode } from "../math";

const GENTLE_COAST: readonly SplineNode[] = [
  [-1, 34], [-0.75, 42], [-0.5, 54], [-0.35, 66], [-0.25, 73.5], [-0.19, 78],
  [-0.15, 80.8], [-0.12, 82.3], [-0.06, 85], [0.05, 88], [0.25, 93],
  [0.5, 101], [0.8, 110], [1, 118],
];

const CLIFF_COAST: readonly SplineNode[] = [
  [-1, 34], [-0.75, 42], [-0.5, 54], [-0.35, 66], [-0.25, 73.5], [-0.19, 77],
  [-0.165, 79], [-0.15, 95], [-0.1, 97], [0.05, 99], [0.25, 101],
  [0.5, 106], [0.8, 114], [1, 120],
];

export function continentalElevation(continentalness: number, cliffiness: number): number {
  const gentle = sampleSpline(GENTLE_COAST, continentalness);
  if (cliffiness <= 0) return gentle;
  return lerp(gentle, sampleSpline(CLIFF_COAST, continentalness), cliffiness);
}
