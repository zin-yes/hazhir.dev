// The cloud volume as GLSL, shared by the cloud pass (which draws after the world and stops each ray at the terrain)
// and by the sky dome (fallback when the depth copy is unavailable).
//
// The clouds are one continuous density field inside a deck of height CLOUD_THICKNESS: tileable 3D noise (a texture,
// see cloud-noise.ts) gives the big billowy shapes, a coverage that rises with local humidity and the weather decides
// how much of it becomes cloud, a second noise channel erodes the edges, and holes carved by the viewer thin it out.
// A view ray takes a few dozen samples through the deck; at every dense sample the sun is marched through the field
// for its shadow and scattered with a two lobe Henyey-Greenstein phase (silver lining looking towards the sun, flat
// grey away from it) plus a powder term for the bright thin edges. The CPU twin of the density is cloud-field.ts.

import { MAX_CLOUD_CARVES } from "./cloud-carves";
import { SHAPE_SOFTNESS, SHAPE_THRESHOLD_CLEAR, SHAPE_THRESHOLD_OVERCAST } from "./cloud-field";
import {
  CLOUD_BASE_COVERAGE,
  CLOUD_BASE_Y,
  CLOUD_DETAIL_TILE_BLOCKS,
  CLOUD_EVOLUTION_PER_SECOND,
  CLOUD_HUMIDITY_GAIN,
  CLOUD_LIGHT_STEPS,
  CLOUD_MAX_DISTANCE,
  CLOUD_SHAPE_TILE_BLOCKS,
  CLOUD_SHAPE_VERTICAL_TILE_BLOCKS,
  CLOUD_SIGMA,
  CLOUD_THICKNESS,
  CLOUD_VIEW_STEPS,
  CLOUD_WIND_BLOCKS_PER_SECOND,
} from "./sky-constants";

const glslFloat = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value));

export const CLOUD_GLSL = `
uniform vec3 viewerPosition;
uniform float elapsedSeconds;
uniform vec3 sunDirection;
uniform vec3 moonDirection;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 sunLightColor;
uniform float weatherShift;
uniform vec3 fogColor;
uniform float fogStrength;
uniform vec3 mistColor;
uniform float cloudMist;
uniform vec4 cloudCarves[${MAX_CLOUD_CARVES}];
uniform sampler3D cloudNoise;
uniform sampler2D humidityTexture;
uniform vec2 humidityOrigin;
uniform float humidityCellSize;
uniform float humidityGridCells;

const float CLOUD_BASE_Y = ${glslFloat(CLOUD_BASE_Y)};
const float CLOUD_THICKNESS = ${glslFloat(CLOUD_THICKNESS)};
const float CLOUD_MAX_DISTANCE = ${glslFloat(CLOUD_MAX_DISTANCE)};
const int CLOUD_VIEW_STEPS = ${CLOUD_VIEW_STEPS};
const int CLOUD_LIGHT_STEPS = ${CLOUD_LIGHT_STEPS};
const float CLOUD_FOG_DISTANCE = 1400.0;
const float CLOUD_SIGMA = ${glslFloat(CLOUD_SIGMA)};
const vec2 CLOUD_WIND = vec2(${glslFloat(CLOUD_WIND_BLOCKS_PER_SECOND.x)}, ${glslFloat(CLOUD_WIND_BLOCKS_PER_SECOND.z)});
const float CLOUD_EVOLUTION = ${glslFloat(CLOUD_EVOLUTION_PER_SECOND)};
const float CLOUD_BASE_COVERAGE = ${glslFloat(CLOUD_BASE_COVERAGE)};
const float CLOUD_HUMIDITY_GAIN = ${glslFloat(CLOUD_HUMIDITY_GAIN)};
const float SHAPE_TILE = ${glslFloat(CLOUD_SHAPE_TILE_BLOCKS)};
const float SHAPE_VERTICAL_TILE = ${glslFloat(CLOUD_SHAPE_VERTICAL_TILE_BLOCKS)};
const float DETAIL_TILE = ${glslFloat(CLOUD_DETAIL_TILE_BLOCKS)};
const float THRESHOLD_CLEAR = ${glslFloat(SHAPE_THRESHOLD_CLEAR)};
const float THRESHOLD_OVERCAST = ${glslFloat(SHAPE_THRESHOLD_OVERCAST)};
const float SHAPE_SOFTNESS = ${glslFloat(SHAPE_SOFTNESS)};

float hash13(vec3 point) {
  point = fract(point * 0.1031);
  point += dot(point, point.zyx + 31.32);
  return fract((point.x + point.y) * point.z);
}

float humidityAt(vec2 worldXZ) {
  vec2 uv = ((worldXZ - humidityOrigin) / humidityCellSize + 0.5) / humidityGridCells;
  return textureLod(humidityTexture, uv, 0.0).r;
}

// 0 at the deck's floor and ceiling, a flat floor and a billowy top in between.
float verticalProfile(float heightFraction) {
  if (heightFraction <= 0.0 || heightFraction >= 1.0) return 0.0;
  return smoothstep(0.0, 0.12, heightFraction) * (1.0 - smoothstep(0.55, 1.0, heightFraction));
}

float baseShapeAt(vec3 world, vec2 windOffset) {
  vec3 coordinate = vec3(
    (world.x - windOffset.x) / SHAPE_TILE,
    world.y / SHAPE_VERTICAL_TILE + elapsedSeconds * CLOUD_EVOLUTION,
    (world.z - windOffset.y) / SHAPE_TILE
  );
  return textureLod(cloudNoise, coordinate, 0.0).r;
}

float shapeThreshold(vec2 worldXZ) {
  float coverage = clamp(CLOUD_BASE_COVERAGE + humidityAt(worldXZ) * CLOUD_HUMIDITY_GAIN + weatherShift, 0.0, 1.0);
  return mix(THRESHOLD_CLEAR, THRESHOLD_OVERCAST, coverage);
}

float carveFactorAt(vec3 world) {
  float factor = 1.0;
  for (int carveIndex = 0; carveIndex < ${MAX_CLOUD_CARVES}; carveIndex++) {
    vec4 carve = cloudCarves[carveIndex];
    if (carve.w > 0.0) factor = min(factor, smoothstep(carve.w * 0.6, carve.w, distance(world, carve.xyz)));
  }
  return factor;
}

// Full density used for the view samples; also returns the threshold so the light march does not look it up again.
float cloudDensity(vec3 world, vec2 windOffset, out float threshold) {
  threshold = 1.0;
  float profile = verticalProfile((world.y - CLOUD_BASE_Y) / CLOUD_THICKNESS);
  if (profile <= 0.0) return 0.0;
  threshold = shapeThreshold(world.xz);
  float density = smoothstep(threshold, threshold + SHAPE_SOFTNESS, baseShapeAt(world, windOffset) * profile);
  if (density <= 0.0) return 0.0;
  float detail = textureLod(cloudNoise, vec3(world.x - windOffset.x, world.y, world.z - windOffset.y) / DETAIL_TILE, 0.0).g;
  density = clamp(density * 1.25 - (1.0 - detail) * 0.35, 0.0, 1.0);
  return density * carveFactorAt(world);
}

// Cheaper density for the light march: no erosion, no holes.
float lightDensity(vec3 world, vec2 windOffset, float threshold) {
  float profile = verticalProfile((world.y - CLOUD_BASE_Y) / CLOUD_THICKNESS);
  if (profile <= 0.0) return 0.0;
  return smoothstep(threshold, threshold + SHAPE_SOFTNESS, baseShapeAt(world, windOffset) * profile);
}

float nightAmount() {
  return smoothstep(0.05, -0.25, sunDirection.y);
}

float henyeyGreenstein(float cosine, float asymmetry) {
  float squared = asymmetry * asymmetry;
  return (1.0 - squared) / pow(1.0 + squared - 2.0 * asymmetry * cosine, 1.5);
}

// Light at a dense sample: the sun (or moon) shadowed by the cloud between it and the sample, scattered towards the
// viewer, plus ambient sky light that is stronger near the top of the deck than near its floor.
vec3 cloudSampleLight(vec3 world, vec2 windOffset, float threshold, vec3 viewDirection, float density, float distanceFromViewer) {
  vec3 lightDirection = sunDirection.y > -0.05 ? sunDirection : moonDirection;
  const float lightOffsets[3] = float[3](12.0, 34.0, 76.0);
  const float lightLengths[3] = float[3](12.0, 22.0, 42.0);
  float opticalDepthToLight = 0.0;
  for (int lightIndex = 0; lightIndex < CLOUD_LIGHT_STEPS; lightIndex++) {
    vec3 lightPoint = world + lightDirection * lightOffsets[lightIndex];
    opticalDepthToLight += lightDensity(lightPoint, windOffset, threshold) * CLOUD_SIGMA * lightLengths[lightIndex];
  }
  float sunReaching = exp(-opticalDepthToLight);
  float cosine = dot(viewDirection, lightDirection);
  float phase = clamp(mix(henyeyGreenstein(cosine, -0.3), henyeyGreenstein(cosine, 0.72), 0.55) * 0.55, 0.0, 3.6);
  float powder = 1.0 - exp(-density * 3.2);
  vec3 direct = sunLightColor * sunReaching * phase * (0.45 + 0.95 * powder) * 1.05;

  float night = nightAmount();
  vec3 skyTint = mix(horizonColor, zenithColor, 0.3);
  vec3 neutral = vec3(dot(skyTint, vec3(0.3333)));
  vec3 glow = vec3(0.07, 0.2, 0.5) * night;
  float heightFraction = clamp((world.y - CLOUD_BASE_Y) / CLOUD_THICKNESS, 0.0, 1.0);
  vec3 ambient = (mix(neutral, skyTint, 0.5) + glow) * mix(0.4, 1.0, heightFraction);

  vec3 color = ambient + direct;
  float fogAmount = 1.0 - exp(-distanceFromViewer / CLOUD_FOG_DISTANCE);
  return mix(color, horizonColor, fogAmount);
}

// Marches the cloud deck along the ray up to maxDistance (the terrain, when there is any) and returns the light
// gathered with the remaining transmittance in w.
vec4 traceClouds(vec3 origin, vec3 direction, float maxDistance, float jitter) {
  vec3 gathered = vec3(0.0);
  float transmittance = 1.0;

  float deckTop = CLOUD_BASE_Y + CLOUD_THICKNESS;
  if (abs(direction.y) < 0.0001) return vec4(gathered, transmittance);
  float distanceToBottom = (CLOUD_BASE_Y - origin.y) / direction.y;
  float distanceToTop = (deckTop - origin.y) / direction.y;
  float enterDistance = max(min(distanceToBottom, distanceToTop), 0.0);
  float exitDistance = min(max(distanceToBottom, distanceToTop), min(CLOUD_MAX_DISTANCE, maxDistance));
  if (exitDistance <= enterDistance) return vec4(gathered, transmittance);

  vec2 windOffset = CLOUD_WIND * elapsedSeconds;
  float span = exitDistance - enterDistance;
  for (int stepIndex = 0; stepIndex < CLOUD_VIEW_STEPS; stepIndex++) {
    float unit = (float(stepIndex) + jitter) / float(CLOUD_VIEW_STEPS);
    float sampleDistance = enterDistance + span * unit * unit;
    float stepLength = span * 2.0 * unit / float(CLOUD_VIEW_STEPS) + 0.5;
    vec3 world = origin + direction * sampleDistance;

    float threshold;
    float density = cloudDensity(world, windOffset, threshold);
    if (density < 0.02) continue;

    float stepAlpha = 1.0 - exp(-density * CLOUD_SIGMA * stepLength);
    vec3 light = cloudSampleLight(world, windOffset, threshold, direction, density, sampleDistance);
    gathered += transmittance * stepAlpha * light;
    transmittance *= 1.0 - stepAlpha;
    if (transmittance < 0.03) break;
  }
  return vec4(gathered, transmittance);
}
`;
