import {
  CLOUD_BASE_COVERAGE,
  CLOUD_HUMIDITY_GAIN,
  WEATHER_PERIOD_SECONDS,
  WEATHER_SHIFT_RANGE,
} from "./sky-constants";

function hashToUnit(value: number): number {
  const scrambled = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return scrambled - Math.floor(scrambled);
}

function smoothInterpolation(fraction: number): number {
  return fraction * fraction * (3 - 2 * fraction);
}

/** Slowly wandering value in [-WEATHER_SHIFT_RANGE, WEATHER_SHIFT_RANGE]: fronts that thicken and clear the sky. */
export function weatherShiftAt(elapsedSeconds: number, seed: number): number {
  const position = elapsedSeconds / WEATHER_PERIOD_SECONDS + seed * 0.37;
  const lowerKnot = Math.floor(position);
  const blend = smoothInterpolation(position - lowerKnot);
  const lowerValue = hashToUnit(lowerKnot + seed);
  const upperValue = hashToUnit(lowerKnot + 1 + seed);
  const unit = lowerValue + (upperValue - lowerValue) * blend;
  return (unit * 2 - 1) * WEATHER_SHIFT_RANGE;
}

/** How much of the sky the clouds fill (0 clear, 1 overcast) given the local air humidity (0 dry, 1 saturated). */
export function cloudCoverageFor(humidity: number, weatherShift: number): number {
  const coverage = CLOUD_BASE_COVERAGE + humidity * CLOUD_HUMIDITY_GAIN + weatherShift;
  return Math.min(1, Math.max(0, coverage));
}
