// When fog forms. Radiation fog needs moist air, calm clear weather and a cool surface: it builds through the night,
// is thickest around dawn and burns off as the sun climbs. Swamp-like humidity keeps a thin mist at any hour.

import { MAX_FOG_DENSITY } from "./sky-lighting";

const MOISTURE_START = 0.45;
const MOISTURE_FULL = 0.85;
const CALM_WEATHER_SHIFT = 0.12;
const FOG_BURNS_OFF_START_ELEVATION = 0.08;
const FOG_BURNS_OFF_END_ELEVATION = 0.35;
const PERSISTENT_MIST_HUMIDITY_START = 0.75;
const PERSISTENT_MIST_HUMIDITY_FULL = 0.95;
const PERSISTENT_MIST_SHARE = 0.25;

function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const fraction = Math.min(1, Math.max(0, (value - edgeStart) / (edgeEnd - edgeStart)));
  return fraction * fraction * (3 - 2 * fraction);
}

export interface FogConditions {
  /** 0 dry .. 1 saturated air at the viewer. */
  humidity: number;
  /** Weather front shift: negative is calm and clear, positive is unsettled. */
  weatherShift: number;
  /** Height of the sun above the horizon, -1..1. */
  sunElevation: number;
}

export function targetFogDensity({ humidity, weatherShift, sunElevation }: FogConditions): number {
  const moisture = smoothstep(MOISTURE_START, MOISTURE_FULL, humidity);
  const calm = smoothstep(CALM_WEATHER_SHIFT, -CALM_WEATHER_SHIFT, weatherShift);
  const stillAir = 1 - smoothstep(FOG_BURNS_OFF_START_ELEVATION, FOG_BURNS_OFF_END_ELEVATION, sunElevation);
  const persistentMist =
    PERSISTENT_MIST_SHARE * smoothstep(PERSISTENT_MIST_HUMIDITY_START, PERSISTENT_MIST_HUMIDITY_FULL, humidity);
  return MAX_FOG_DENSITY * moisture * Math.max(calm * stillAir, persistentMist);
}
