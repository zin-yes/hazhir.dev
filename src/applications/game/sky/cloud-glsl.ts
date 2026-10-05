// The cloud volume as GLSL, shared by the cloud pass (which draws after the world and stops each ray at the terrain)
// and by the sky dome (fallback when the depth copy is unavailable).
//
// Clouds sit on a slab of CLOUD_LAYER_COUNT cell layers walked cell by cell. A filled cell holds a rounded pill (the
// CPU twin lives in cloud-field.ts) whose density is a soft falloff from the pill's surface, eroded by 3D noise so the
// edges are fluffy. Inside a pill the ray is marched in a few jittered steps; at each step the sun is marched through
// the same pill to get its shadow, and the light is scattered with a two lobe Henyey-Greenstein phase (silver lining
// when looking towards the sun, grey and flat away from it) plus a powder term for the bright thin edges.

import { MAX_CLOUD_CARVES } from "./cloud-carves";
import {
  CLOUD_BASE_COVERAGE,
  CLOUD_BASE_Y,
  CLOUD_CELL_HEIGHT,
  CLOUD_CELL_WIDTH,
  CLOUD_EVOLUTION_PER_SECOND,
  CLOUD_HUMIDITY_GAIN,
  CLOUD_LAYER_COUNT,
  CLOUD_MAX_DISTANCE,
  CLOUD_MAX_STEPS,
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
uniform sampler2D humidityTexture;
uniform vec2 humidityOrigin;
uniform float humidityCellSize;
uniform float humidityGridCells;

const float CLOUD_BASE_Y = ${glslFloat(CLOUD_BASE_Y)};
const int CLOUD_LAYERS = ${CLOUD_LAYER_COUNT};
const float CLOUD_CELL_WIDTH = ${glslFloat(CLOUD_CELL_WIDTH)};
const float CLOUD_CELL_HEIGHT = ${glslFloat(CLOUD_CELL_HEIGHT)};
const float CLOUD_MAX_DISTANCE = ${glslFloat(CLOUD_MAX_DISTANCE)};
const int CLOUD_MAX_STEPS = ${CLOUD_MAX_STEPS};
const float CLOUD_FOG_DISTANCE = 1400.0;
const float CLOUD_SIGMA = 0.11;
const int CLOUD_VIEW_SAMPLES = 6;
const int CLOUD_LIGHT_SAMPLES = 3;
const vec2 CLOUD_WIND = vec2(${glslFloat(CLOUD_WIND_BLOCKS_PER_SECOND.x)}, ${glslFloat(CLOUD_WIND_BLOCKS_PER_SECOND.z)});
const float CLOUD_EVOLUTION = ${glslFloat(CLOUD_EVOLUTION_PER_SECOND)};
const float CLOUD_BASE_COVERAGE = ${glslFloat(CLOUD_BASE_COVERAGE)};
const float CLOUD_HUMIDITY_GAIN = ${glslFloat(CLOUD_HUMIDITY_GAIN)};
const int SHAPE_SALT = 7919;
const vec3 CLOUD_WARP_MARGIN = vec3(4.0, 1.5, 4.0);

uvec3 pcg3d(ivec3 lattice) {
  uvec3 value = uvec3(lattice) * 1664525u + 1013904223u;
  value.x += value.y * value.z;
  value.y += value.z * value.x;
  value.z += value.x * value.y;
  value ^= value >> 16u;
  value.x += value.y * value.z;
  value.y += value.z * value.x;
  value.z += value.x * value.y;
  return value;
}

float hashToUnit(uint value) {
  return float(value) / 4294967296.0;
}

float hash13(vec3 point) {
  point = fract(point * 0.1031);
  point += dot(point, point.zyx + 31.32);
  return fract((point.x + point.y) * point.z);
}

float latticeValue(ivec3 lattice) {
  return hashToUnit(pcg3d(lattice).x);
}

float valueNoise(vec3 point) {
  vec3 floored = floor(point);
  ivec3 base = ivec3(floored);
  vec3 fraction = point - floored;
  vec3 eased = fraction * fraction * (3.0 - 2.0 * fraction);
  float c000 = latticeValue(base);
  float c100 = latticeValue(base + ivec3(1, 0, 0));
  float c010 = latticeValue(base + ivec3(0, 1, 0));
  float c110 = latticeValue(base + ivec3(1, 1, 0));
  float c001 = latticeValue(base + ivec3(0, 0, 1));
  float c101 = latticeValue(base + ivec3(1, 0, 1));
  float c011 = latticeValue(base + ivec3(0, 1, 1));
  float c111 = latticeValue(base + ivec3(1, 1, 1));
  return mix(
    mix(mix(c000, c100, eased.x), mix(c010, c110, eased.x), eased.y),
    mix(mix(c001, c101, eased.x), mix(c011, c111, eased.x), eased.y),
    eased.z
  );
}

float humidityAt(vec2 worldXZ) {
  vec2 uv = ((worldXZ - humidityOrigin) / humidityCellSize + 0.5) / humidityGridCells;
  return textureLod(humidityTexture, uv, 0.0).r;
}

bool cloudCellFilled(ivec3 cell, vec2 windOffset) {
  if (cell.y < 0 || cell.y >= CLOUD_LAYERS) return false;
  vec3 centerWorld = vec3(
    (float(cell.x) + 0.5) * CLOUD_CELL_WIDTH + windOffset.x,
    CLOUD_BASE_Y + (float(cell.y) + 0.5) * CLOUD_CELL_HEIGHT,
    (float(cell.z) + 0.5) * CLOUD_CELL_WIDTH + windOffset.y
  );
  float coverage = clamp(CLOUD_BASE_COVERAGE + humidityAt(centerWorld.xz) * CLOUD_HUMIDITY_GAIN + weatherShift, 0.0, 1.0);
  vec3 noisePosition = vec3(float(cell.x), float(cell.y) * 1.6, float(cell.z)) * 0.085
    + vec3(0.0, elapsedSeconds * CLOUD_EVOLUTION, 0.0);
  float shape = 0.62 * valueNoise(noisePosition) + 0.38 * valueNoise(noisePosition * 2.3 + 17.0);
  float density = clamp((shape - 0.5) * 2.0 + 0.5, 0.0, 1.0);
  density -= abs(float(cell.y) - float(CLOUD_LAYERS - 1) * 0.5) * 0.12;
  if (density <= 1.0 - coverage) return false;
  for (int carveIndex = 0; carveIndex < ${MAX_CLOUD_CARVES}; carveIndex++) {
    vec4 carve = cloudCarves[carveIndex];
    if (carve.w > 0.0 && distance(centerWorld, carve.xyz) < carve.w) return false;
  }
  return true;
}

void cloudBodyOf(ivec3 cell, out vec3 offset, out vec3 halfExtents, out float cornerRadius) {
  uvec3 sizeHash = pcg3d(cell + ivec3(SHAPE_SALT));
  vec3 scale = vec3(
    mix(0.5, 0.8, hashToUnit(sizeHash.x)),
    mix(0.45, 0.72, hashToUnit(sizeHash.y)),
    mix(0.5, 0.8, hashToUnit(sizeHash.z))
  );
  vec3 cellSize = vec3(CLOUD_CELL_WIDTH, CLOUD_CELL_HEIGHT, CLOUD_CELL_WIDTH);
  halfExtents = cellSize * scale * 0.5;
  uvec3 offsetHash = pcg3d(cell - ivec3(SHAPE_SALT));
  vec3 unitOffset = vec3(hashToUnit(offsetHash.x), hashToUnit(offsetHash.y), hashToUnit(offsetHash.z)) - 0.5;
  offset = unitOffset * max(cellSize - (halfExtents + CLOUD_WARP_MARGIN) * 2.0, 0.0);
  cornerRadius = min(halfExtents.x, min(halfExtents.y, halfExtents.z)) * 0.9;
}

float roundedBoxDistance(vec3 point, vec3 halfExtents, float cornerRadius) {
  vec3 inset = abs(point) - halfExtents + cornerRadius;
  return length(max(inset, 0.0)) + min(max(inset.x, max(inset.y, inset.z)), 0.0) - cornerRadius;
}

// Soft density of one pill at a point in grid space: dense core, feathered edge, optionally eroded by noise.
float pillDensity(vec3 gridPoint, vec3 bodyCenter, vec3 halfExtents, float cornerRadius, bool erode) {
  if (erode) {
    vec3 warpPoint = gridPoint * 0.045;
    gridPoint.xz += (vec2(valueNoise(warpPoint), valueNoise(warpPoint + 31.4)) - 0.5) * 2.0 * CLOUD_WARP_MARGIN.xz;
  }
  float surfaceDistance = roundedBoxDistance(gridPoint - bodyCenter, halfExtents, cornerRadius);
  float feather = min(halfExtents.y, 7.0) * 0.95;
  float core = clamp(-surfaceDistance / feather, 0.0, 1.0);
  core = core * core * (3.0 - 2.0 * core);
  if (!erode || core <= 0.0) return core;
  float detail = valueNoise(gridPoint * 0.13 + vec3(0.0, elapsedSeconds * 0.012, 0.0));
  return clamp(core * 1.4 - (1.0 - detail) * 0.5, 0.0, 1.0);
}

float nightAmount() {
  return smoothstep(0.05, -0.25, sunDirection.y);
}

float henyeyGreenstein(float cosine, float asymmetry) {
  float squared = asymmetry * asymmetry;
  return (1.0 - squared) / pow(1.0 + squared - 2.0 * asymmetry * cosine, 1.5);
}

// Light a point of a pill sees: sun (or moon) shadowed by the rest of the pill, scattered towards the viewer, plus
// ambient sky light that is stronger on top than underneath.
vec3 cloudSampleLight(vec3 gridPoint, vec3 bodyCenter, vec3 halfExtents, float cornerRadius, vec3 viewDirection, float density, float distanceFromViewer) {
  vec3 lightDirection = sunDirection.y > -0.05 ? sunDirection : moonDirection;
  float lightStep = max(halfExtents.y * 0.85, 3.0);
  float opticalDepthToLight = 0.0;
  for (int lightIndex = 0; lightIndex < CLOUD_LIGHT_SAMPLES; lightIndex++) {
    vec3 lightPoint = gridPoint + lightDirection * lightStep * (float(lightIndex) + 0.5);
    opticalDepthToLight += pillDensity(lightPoint, bodyCenter, halfExtents, cornerRadius, false) * CLOUD_SIGMA * lightStep;
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
  float heightInBody = clamp((gridPoint.y - bodyCenter.y) / halfExtents.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambient = (mix(neutral, skyTint, 0.5) * 1.0 + glow) * mix(0.45, 1.0, heightInBody);

  vec3 color = ambient + direct;
  float fogAmount = 1.0 - exp(-distanceFromViewer / CLOUD_FOG_DISTANCE);
  return mix(color, horizonColor, fogAmount);
}

// Marches the cloud slab along the ray up to maxDistance (the terrain, when there is any) and returns the light gathered
// with the remaining transmittance in w.
vec4 traceClouds(vec3 origin, vec3 direction, float maxDistance, float jitter) {
  vec3 gathered = vec3(0.0);
  float transmittance = 1.0;

  float slabTop = CLOUD_BASE_Y + CLOUD_CELL_HEIGHT * float(CLOUD_LAYERS);
  if (abs(direction.y) < 0.0001) return vec4(gathered, transmittance);
  float distanceToBottom = (CLOUD_BASE_Y - origin.y) / direction.y;
  float distanceToTop = (slabTop - origin.y) / direction.y;
  float enterDistance = max(min(distanceToBottom, distanceToTop), 0.0);
  float exitDistance = min(max(distanceToBottom, distanceToTop), min(CLOUD_MAX_DISTANCE, maxDistance));
  if (exitDistance <= enterDistance) return vec4(gathered, transmittance);

  vec2 windOffset = CLOUD_WIND * elapsedSeconds;
  vec3 cellSize = vec3(CLOUD_CELL_WIDTH, CLOUD_CELL_HEIGHT, CLOUD_CELL_WIDTH);
  vec3 safeDirection = mix(direction, vec3(0.00001), vec3(lessThan(abs(direction), vec3(0.00001))));
  vec3 gridOrigin = origin - vec3(windOffset.x, CLOUD_BASE_Y, windOffset.y);
  float travelled = enterDistance + 0.01;
  vec3 start = gridOrigin + direction * travelled;
  ivec3 cell = ivec3(floor(start / cellSize));
  ivec3 stepDirection = ivec3(sign(safeDirection));
  vec3 nextBoundary = (vec3(cell) + max(sign(safeDirection), 0.0)) * cellSize;
  vec3 nextCrossing = travelled + (nextBoundary - start) / safeDirection;
  vec3 crossingSpacing = abs(cellSize / safeDirection);
  vec3 inverseDirection = 1.0 / safeDirection;

  for (int stepIndex = 0; stepIndex < CLOUD_MAX_STEPS; stepIndex++) {
    if (travelled > exitDistance || transmittance < 0.03) break;
    float cellExit = min(min(nextCrossing.x, min(nextCrossing.y, nextCrossing.z)), exitDistance);

    if (cloudCellFilled(cell, windOffset)) {
      vec3 bodyOffset;
      vec3 halfExtents;
      float cornerRadius;
      cloudBodyOf(cell, bodyOffset, halfExtents, cornerRadius);
      vec3 bodyCenter = (vec3(cell) + 0.5) * cellSize + bodyOffset;
      vec3 localOrigin = gridOrigin - bodyCenter;
      vec3 paddedExtents = halfExtents + CLOUD_WARP_MARGIN;
      vec3 boundA = (-paddedExtents - localOrigin) * inverseDirection;
      vec3 boundB = (paddedExtents - localOrigin) * inverseDirection;
      vec3 nearBounds = min(boundA, boundB);
      vec3 farBounds = max(boundA, boundB);
      float segmentStart = max(travelled, max(nearBounds.x, max(nearBounds.y, nearBounds.z)));
      float segmentEnd = min(cellExit, min(farBounds.x, min(farBounds.y, farBounds.z)));

      if (segmentEnd > segmentStart) {
        float segmentStep = (segmentEnd - segmentStart) / float(CLOUD_VIEW_SAMPLES);
        for (int sampleIndex = 0; sampleIndex < CLOUD_VIEW_SAMPLES; sampleIndex++) {
          float sampleDistance = segmentStart + (float(sampleIndex) + jitter) * segmentStep;
          vec3 gridPoint = gridOrigin + direction * sampleDistance;
          float density = pillDensity(gridPoint, bodyCenter, halfExtents, cornerRadius, true);
          if (density < 0.01) continue;
          float stepAlpha = 1.0 - exp(-density * CLOUD_SIGMA * segmentStep);
          vec3 light = cloudSampleLight(gridPoint, bodyCenter, halfExtents, cornerRadius, direction, density, sampleDistance);
          gathered += transmittance * stepAlpha * light;
          transmittance *= 1.0 - stepAlpha;
        }
      }
    }

    if (nextCrossing.x < nextCrossing.y && nextCrossing.x < nextCrossing.z) {
      travelled = nextCrossing.x;
      nextCrossing.x += crossingSpacing.x;
      cell.x += stepDirection.x;
    } else if (nextCrossing.y < nextCrossing.z) {
      travelled = nextCrossing.y;
      nextCrossing.y += crossingSpacing.y;
      cell.y += stepDirection.y;
    } else {
      travelled = nextCrossing.z;
      nextCrossing.z += crossingSpacing.z;
      cell.z += stepDirection.z;
    }
  }
  return vec4(gathered, transmittance);
}
`;
