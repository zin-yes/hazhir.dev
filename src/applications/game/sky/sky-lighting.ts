// Sky-driven lighting shared by every terrain material (real chunks and the distant LOD): one set of uniform objects
// that the sky controller updates each frame, plus the GLSL that applies them. Daylight scales the sky light of a face;
// fog blends a fragment towards the fog colour by its distance, thinning with height above the fog floor and drifting
// in banks.

import * as THREE from "three";

/** Share of full brightness a sky-lit face keeps at night. */
export const NIGHT_BRIGHTNESS_FLOOR = 0.3;
/** Densest fog (per block of distance), about 90 blocks of visibility. */
export const MAX_FOG_DENSITY = 0.011;
/** World y the fog sits on (game sea level) and the height over which it thins out. */
export const FOG_FLOOR_Y = 80;
export const FOG_FALLOFF_BLOCKS = 70;

export const skyLightingUniforms = {
  /** 1 in daylight, 0 at night. */
  skyDaylight: { value: 1 },
  skyFogDensity: { value: 0 },
  /** Output-space (sRGB) colour, like the final fragment colour it is mixed with. */
  skyFogColor: { value: new THREE.Vector3(0.7, 0.75, 0.8) },
  skyFogTime: { value: 0 },
  /** 0..1: how deep inside a cloud the viewer is; thick white mist at any height. */
  skyMist: { value: 0 },
};

export const DAYLIGHT_GLSL = `
uniform float skyDaylight;
float daylightScale() {
  return mix(${NIGHT_BRIGHTNESS_FLOOR.toFixed(2)}, 1.0, skyDaylight);
}
`;

export const FOG_GLSL = `
uniform float skyFogDensity;
uniform vec3 skyFogColor;
uniform float skyFogTime;
uniform float skyMist;

float fogHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}

float fogNoise(vec2 point) {
  vec2 base = floor(point);
  vec2 fraction = point - base;
  vec2 eased = fraction * fraction * (3.0 - 2.0 * fraction);
  return mix(
    mix(fogHash(base), fogHash(base + vec2(1.0, 0.0)), eased.x),
    mix(fogHash(base + vec2(0.0, 1.0)), fogHash(base + vec2(1.0, 1.0)), eased.x),
    eased.y
  );
}

vec3 applyFog(vec3 color, vec3 worldPosition) {
  if (skyFogDensity < 0.00002 && skyMist < 0.001) return color;
  float distanceToCamera = length(worldPosition - cameraPosition);
  float averageHeight = 0.5 * (worldPosition.y + cameraPosition.y);
  float heightFactor = exp(-max(averageHeight - ${FOG_FLOOR_Y.toFixed(1)}, 0.0) / ${FOG_FALLOFF_BLOCKS.toFixed(1)});
  vec2 drift = vec2(skyFogTime * 0.03, skyFogTime * 0.012);
  float banks = 0.65 + 0.7 * fogNoise(worldPosition.xz * 0.005 + drift) * (0.6 + 0.4 * fogNoise(worldPosition.xz * 0.019 - drift));
  float opticalDepth = (skyFogDensity * heightFactor * banks + skyMist * 0.05) * distanceToCamera;
  float amount = 1.0 - exp(-opticalDepth * sqrt(opticalDepth));
  return mix(color, skyFogColor, clamp(amount, 0.0, 1.0));
}
`;
