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
  /** Unit direction towards the sun by day, the moon by night. */
  skyLightDirection: { value: new THREE.Vector3(0, 1, 0) },
  /** Linear colours: direct light (scaled by strength), light from above, light bounced from below, and the sky for reflections. */
  skyDirectColor: { value: new THREE.Vector3(1, 1, 1) },
  skyAmbientColor: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
  skyGroundColor: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
  skyZenithColor: { value: new THREE.Vector3(0.1, 0.3, 0.8) },
  skyHorizonColor: { value: new THREE.Vector3(0.6, 0.75, 0.9) },
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

export const LIGHTING_GLSL = `
uniform vec3 skyLightDirection;
uniform vec3 skyDirectColor;
uniform vec3 skyAmbientColor;
uniform vec3 skyGroundColor;
uniform vec3 skyZenithColor;
uniform vec3 skyHorizonColor;

vec3 srgbEncode(vec3 linearColor) {
  vec3 clamped = clamp(linearColor, 0.0, 1.0);
  return mix(clamped * 12.92, 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), clamped));
}

vec3 srgbDecode(vec3 displayColor) {
  return mix(displayColor / 12.92, pow((displayColor + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), displayColor));
}

/** Light a face receives from the sky dome and the ground, by how far it faces up. */
vec3 hemisphereLight(vec3 normal) {
  return mix(skyGroundColor, skyAmbientColor, normal.y * 0.5 + 0.5);
}

/** Colour of the sky in a direction, linear: horizon to zenith, with a glow around the light. */
vec3 skyColorTowards(vec3 direction) {
  vec3 gradient = mix(skyHorizonColor, skyZenithColor, pow(clamp(direction.y, 0.0, 1.0), 0.45));
  float glow = pow(max(dot(direction, skyLightDirection), 0.0), 8.0);
  return gradient + skyDirectColor * glow * 0.25;
}

/** Narkowicz ACES fit: soft shoulder for highlights, a little more contrast in the mid tones. */
vec3 filmicToneMap(vec3 linearColor) {
  vec3 exposed = linearColor * 0.9;
  return clamp((exposed * (2.51 * exposed + 0.03)) / (exposed * (2.43 * exposed + 0.59) + 0.14), 0.0, 1.0);
}
`;
