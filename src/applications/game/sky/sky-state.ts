// Everything the sky and terrain lighting need at one moment: sun and moon directions, gradient and light colours
// (linear RGB), star visibility and daylight. Pure function of the time of day, the moon phase and the overcast amount.

import { MOON_PHASE_COUNT, ORBIT_TILT } from "./sky-constants";

export type Rgb = [number, number, number];

export interface SkyState {
  sunDirection: Rgb;
  moonDirection: Rgb;
  /** Rotation axis of the celestial sphere (perpendicular to the sun's orbit plane). */
  orbitAxis: Rgb;
  /** Radians the celestial sphere has turned since the sun stood on the east horizon. */
  orbitAngle: number;
  /** Phase of the moon disc: 0 full, pi new. */
  moonPhaseAngle: number;
  zenithColor: Rgb;
  horizonColor: Rgb;
  glowColor: Rgb;
  glowStrength: number;
  sunLightColor: Rgb;
  starVisibility: number;
  /** Linear colour distant fog fades to: the horizon, washed towards grey in daylight. */
  fogColor: Rgb;
  /** Linear colour of the mist inside a cloud. */
  mistColor: Rgb;
  /** 1 in full daylight, 0 at night; scales the lighting of the terrain. */
  daylight: number;
  /** Unit direction towards the body that lights the terrain: the sun by day, the moon by night. */
  lightDirection: Rgb;
  /** Linear colour of that body's direct light, already scaled by how strong it is (0 around the horizon crossing). */
  directLightColor: Rgb;
  /** Linear colour of the sky light that reaches a face turned up; faces turned down get the ground colour. */
  ambientSkyColor: Rgb;
  ambientGroundColor: Rgb;
}

interface PaletteStop {
  sunElevation: number;
  zenith: number;
  horizon: number;
  glow: number;
  glowStrength: number;
  sunLight: number;
}

const PALETTE_STOPS: PaletteStop[] = [
  { sunElevation: -0.35, zenith: 0x061436, horizon: 0x112c5e, glow: 0x1a2650, glowStrength: 0.0, sunLight: 0x2a3a66 },
  { sunElevation: -0.12, zenith: 0x0d1a45, horizon: 0x2c3470, glow: 0x6a3f78, glowStrength: 0.35, sunLight: 0x3a3f70 },
  { sunElevation: -0.03, zenith: 0x1f3470, horizon: 0xd2677a, glow: 0xff7a4a, glowStrength: 0.9, sunLight: 0xff7a40 },
  { sunElevation: 0.06, zenith: 0x35609f, horizon: 0xf29a58, glow: 0xffa860, glowStrength: 1.0, sunLight: 0xffa860 },
  { sunElevation: 0.22, zenith: 0x4a82d4, horizon: 0xc7dcea, glow: 0xffe2a8, glowStrength: 0.6, sunLight: 0xffe8c4 },
  { sunElevation: 0.55, zenith: 0x3f86ee, horizon: 0xb4d8ff, glow: 0xfff2cc, glowStrength: 0.35, sunLight: 0xfff6e6 },
];

const OVERCAST_GREY_LUMINANCE_SCALE = 0.78;
const MAX_OVERCAST_DESATURATION = 0.7;
const MAX_OVERCAST_DIMMING = 0.35;
const DAYLIGHT_RISE_START_ELEVATION = -0.18;
const DAYLIGHT_RISE_END_ELEVATION = 0.12;
const STARS_FULL_ELEVATION = -0.2;
const STARS_GONE_ELEVATION = 0.0;
/** The sun stops lighting terrain once it is this far below the horizon, and the moon takes over. */
const SUN_LIGHT_SET_ELEVATION = -0.05;
const SUN_LIGHT_FULL_ELEVATION = 0.12;
const MOON_LIGHT_FULL_ELEVATION = -0.2;
const MOON_LIGHT_COLOR: Rgb = [0.5, 0.62, 1.0];
const MOON_LIGHT_STRENGTH = 0.22;
const MAX_OVERCAST_DIRECT_LIGHT_LOSS = 0.8;
const AMBIENT_SKY_LUMINANCE = 0.62;
const AMBIENT_GROUND_LUMINANCE = 0.3;
const AMBIENT_TINT_SHARE = 0.45;

function srgbHexToLinear(hex: number): Rgb {
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return [toLinear((hex >> 16) & 255), toLinear((hex >> 8) & 255), toLinear(hex & 255)];
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

function scaleRgb(color: Rgb, factor: number): Rgb {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const fraction = Math.min(1, Math.max(0, (value - edgeStart) / (edgeEnd - edgeStart)));
  return fraction * fraction * (3 - 2 * fraction);
}

function normalize(vector: Rgb): Rgb {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(first: Rgb, second: Rgb): Rgb {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

const EAST: Rgb = [1, 0, 0];
const ORBIT_UP: Rgb = normalize([0, 1, ORBIT_TILT]);
const ORBIT_AXIS: Rgb = normalize(cross(EAST, ORBIT_UP));

function sampleStops(sunElevation: number): {
  zenith: Rgb;
  horizon: Rgb;
  glow: Rgb;
  glowStrength: number;
  sunLight: Rgb;
} {
  const firstStop = PALETTE_STOPS[0]!;
  const lastStop = PALETTE_STOPS[PALETTE_STOPS.length - 1]!;
  let lower = firstStop;
  let upper = firstStop;
  if (sunElevation >= lastStop.sunElevation) {
    lower = lastStop;
    upper = lastStop;
  } else if (sunElevation > firstStop.sunElevation) {
    for (let index = 0; index < PALETTE_STOPS.length - 1; index++) {
      const candidateLower = PALETTE_STOPS[index]!;
      const candidateUpper = PALETTE_STOPS[index + 1]!;
      if (sunElevation <= candidateUpper.sunElevation) {
        lower = candidateLower;
        upper = candidateUpper;
        break;
      }
    }
  }
  const span = upper.sunElevation - lower.sunElevation;
  const blend = span === 0 ? 0 : (sunElevation - lower.sunElevation) / span;
  return {
    zenith: mixRgb(srgbHexToLinear(lower.zenith), srgbHexToLinear(upper.zenith), blend),
    horizon: mixRgb(srgbHexToLinear(lower.horizon), srgbHexToLinear(upper.horizon), blend),
    glow: mixRgb(srgbHexToLinear(lower.glow), srgbHexToLinear(upper.glow), blend),
    glowStrength: lower.glowStrength + (upper.glowStrength - lower.glowStrength) * blend,
    sunLight: mixRgb(srgbHexToLinear(lower.sunLight), srgbHexToLinear(upper.sunLight), blend),
  };
}

function greyOf(color: Rgb): Rgb {
  const luminance = (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) * OVERCAST_GREY_LUMINANCE_SCALE;
  return [luminance, luminance, luminance];
}

function luminanceOf(color: Rgb): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}

/** A colour with the hue of `tint` (partly desaturated) and exactly the given luminance. */
function tintedAtLuminance(tint: Rgb, luminance: number): Rgb {
  const grey = luminanceOf(tint);
  const softened = mixRgb([grey, grey, grey], tint, AMBIENT_TINT_SHARE);
  return scaleRgb(softened, luminance / Math.max(luminanceOf(softened), 1e-4));
}

export function computeSkyState(timeOfDay: number, moonPhaseIndex: number, overcast: number): SkyState {
  const orbitAngle = (timeOfDay - 0.25) * Math.PI * 2;
  const sunDirection: Rgb = [
    Math.cos(orbitAngle) * EAST[0] + Math.sin(orbitAngle) * ORBIT_UP[0],
    Math.cos(orbitAngle) * EAST[1] + Math.sin(orbitAngle) * ORBIT_UP[1],
    Math.cos(orbitAngle) * EAST[2] + Math.sin(orbitAngle) * ORBIT_UP[2],
  ];
  const moonDirection = scaleRgb(sunDirection, -1);
  const sunElevation = sunDirection[1];
  const sampled = sampleStops(sunElevation);

  const clampedOvercast = Math.min(1, Math.max(0, overcast));
  const desaturation = clampedOvercast * MAX_OVERCAST_DESATURATION;
  const dimming = 1 - clampedOvercast * MAX_OVERCAST_DIMMING;
  const overcastZenith = scaleRgb(mixRgb(sampled.zenith, greyOf(sampled.horizon), desaturation), dimming);
  const overcastHorizon = scaleRgb(mixRgb(sampled.horizon, greyOf(sampled.horizon), desaturation), dimming);

  const daylight =
    smoothstep(DAYLIGHT_RISE_START_ELEVATION, DAYLIGHT_RISE_END_ELEVATION, sunElevation) * (1 - clampedOvercast * 0.25);
  const starVisibility =
    smoothstep(STARS_GONE_ELEVATION, STARS_FULL_ELEVATION, sunElevation) * (1 - clampedOvercast);

  const fogGrey = greyOf(overcastHorizon);
  const fogColor = mixRgb(overcastHorizon, scaleRgb(fogGrey, 1.25), 0.4 + 0.3 * daylight);

  const skyTint = mixRgb(overcastHorizon, overcastZenith, 0.3);
  const night = 1 - daylight;
  const mistGrey = greyOf(skyTint);
  const mistColor: Rgb = [
    mistGrey[0] * 0.8 + sampled.sunLight[0] * 0.35 * daylight + 0.03 * night,
    mistGrey[1] * 0.8 + sampled.sunLight[1] * 0.35 * daylight + 0.07 * night,
    mistGrey[2] * 0.8 + sampled.sunLight[2] * 0.35 * daylight + 0.16 * night,
  ];

  const sunLightsTerrain = sunElevation > SUN_LIGHT_SET_ELEVATION;
  const sunStrength = smoothstep(SUN_LIGHT_SET_ELEVATION, SUN_LIGHT_FULL_ELEVATION, sunElevation);
  const moonStrength = smoothstep(SUN_LIGHT_SET_ELEVATION, MOON_LIGHT_FULL_ELEVATION, sunElevation) * MOON_LIGHT_STRENGTH;
  const directLightLoss = 1 - clampedOvercast * MAX_OVERCAST_DIRECT_LIGHT_LOSS;
  const directLightColor = scaleRgb(
    sunLightsTerrain ? sampled.sunLight : MOON_LIGHT_COLOR,
    (sunLightsTerrain ? sunStrength : moonStrength) * directLightLoss,
  );
  const ambientTint = mixRgb(overcastHorizon, overcastZenith, 0.5);

  return {
    sunDirection,
    moonDirection,
    orbitAxis: ORBIT_AXIS,
    orbitAngle,
    moonPhaseAngle: ((moonPhaseIndex % MOON_PHASE_COUNT) / MOON_PHASE_COUNT) * Math.PI * 2,
    zenithColor: overcastZenith,
    horizonColor: overcastHorizon,
    glowColor: sampled.glow,
    glowStrength: sampled.glowStrength * (1 - clampedOvercast * 0.6),
    sunLightColor: sampled.sunLight,
    starVisibility,
    fogColor,
    mistColor,
    daylight,
    lightDirection: sunLightsTerrain ? sunDirection : moonDirection,
    directLightColor,
    ambientSkyColor: tintedAtLuminance(ambientTint, AMBIENT_SKY_LUMINANCE),
    ambientGroundColor: tintedAtLuminance(mixRgb(ambientTint, sampled.sunLight, 0.3), AMBIENT_GROUND_LUMINANCE),
  };
}
