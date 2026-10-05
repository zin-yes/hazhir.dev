// The sky: a smooth gradient (dithered, no banding), a square sun and moon, stars, and soft translucent clouds.
// Clouds live on a slab of CLOUD_LAYER_COUNT cell layers that is walked cell by cell; every filled cell holds a rounded
// pill (see cloud-field.ts for the CPU twin of the cell and body maths). Each body is lit like a glowing translucent
// solid: a wrapped diffuse term, a bright rim and a faint inner glow, blended front to back so the sky and sun show
// through. The dome renders at the far plane around the camera.

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

export const SKY_VERTEX_SHADER = `
varying vec3 vDirection;

void main() {
  vDirection = position;
  mat4 rotationOnlyView = mat4(mat3(viewMatrix));
  gl_Position = (projectionMatrix * rotationOnlyView * vec4(position, 1.0)).xyww;
}
`;

export const SKY_FRAGMENT_SHADER = `
varying vec3 vDirection;

uniform vec3 viewerPosition;
uniform float elapsedSeconds;
uniform vec3 sunDirection;
uniform vec3 moonDirection;
uniform mat3 starRotation;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 glowColor;
uniform float glowStrength;
uniform vec3 sunLightColor;
uniform float starVisibility;
uniform float moonPhaseAngle;
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

const float DISC_TEXELS = 8.0;
const float SUN_HALF_SIZE = 0.1;
const float MOON_HALF_SIZE = 0.075;
const float STAR_GRID = 180.0;
const float STAR_DENSITY = 0.004;

const float CLOUD_BASE_Y = ${glslFloat(CLOUD_BASE_Y)};
const int CLOUD_LAYERS = ${CLOUD_LAYER_COUNT};
const float CLOUD_CELL_WIDTH = ${glslFloat(CLOUD_CELL_WIDTH)};
const float CLOUD_CELL_HEIGHT = ${glslFloat(CLOUD_CELL_HEIGHT)};
const float CLOUD_MAX_DISTANCE = ${glslFloat(CLOUD_MAX_DISTANCE)};
const int CLOUD_MAX_STEPS = ${CLOUD_MAX_STEPS};
const float CLOUD_FOG_DISTANCE = 1400.0;
const float CLOUD_OPACITY_PER_BLOCK = 0.16;
const vec2 CLOUD_WIND = vec2(${glslFloat(CLOUD_WIND_BLOCKS_PER_SECOND.x)}, ${glslFloat(CLOUD_WIND_BLOCKS_PER_SECOND.z)});
const float CLOUD_EVOLUTION = ${glslFloat(CLOUD_EVOLUTION_PER_SECOND)};
const float CLOUD_BASE_COVERAGE = ${glslFloat(CLOUD_BASE_COVERAGE)};
const float CLOUD_HUMIDITY_GAIN = ${glslFloat(CLOUD_HUMIDITY_GAIN)};
const int SHAPE_SALT = 7919;

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
    mix(0.62, 0.98, hashToUnit(sizeHash.x)),
    mix(0.5, 0.95, hashToUnit(sizeHash.y)),
    mix(0.62, 0.98, hashToUnit(sizeHash.z))
  );
  vec3 cellSize = vec3(CLOUD_CELL_WIDTH, CLOUD_CELL_HEIGHT, CLOUD_CELL_WIDTH);
  halfExtents = cellSize * scale * 0.5;
  uvec3 offsetHash = pcg3d(cell - ivec3(SHAPE_SALT));
  vec3 unitOffset = vec3(hashToUnit(offsetHash.x), hashToUnit(offsetHash.y), hashToUnit(offsetHash.z)) - 0.5;
  offset = unitOffset * (cellSize - halfExtents * 2.0);
  cornerRadius = min(halfExtents.x, min(halfExtents.y, halfExtents.z)) * 0.9;
}

float roundedBoxDistance(vec3 point, vec3 halfExtents, float cornerRadius) {
  vec3 inset = abs(point) - halfExtents + cornerRadius;
  return length(max(inset, 0.0)) + min(max(inset.x, max(inset.y, inset.z)), 0.0) - cornerRadius;
}

vec3 roundedBoxNormal(vec3 point, vec3 halfExtents, float cornerRadius) {
  const vec2 probe = vec2(0.5, -0.5);
  return normalize(
    probe.xyy * roundedBoxDistance(point + probe.xyy * 0.2, halfExtents, cornerRadius) +
    probe.yyx * roundedBoxDistance(point + probe.yyx * 0.2, halfExtents, cornerRadius) +
    probe.yxy * roundedBoxDistance(point + probe.yxy * 0.2, halfExtents, cornerRadius) +
    probe.xxx * roundedBoxDistance(point + probe.xxx * 0.2, halfExtents, cornerRadius)
  );
}

float nightAmount() {
  return smoothstep(0.05, -0.25, sunDirection.y);
}

vec3 shadeCloudBody(vec3 normal, vec3 viewDirection, float travelledDistance) {
  vec3 lightDirection = sunDirection.y > -0.05 ? sunDirection : moonDirection;
  float night = nightAmount();
  vec3 skyTint = mix(horizonColor, zenithColor, 0.3);
  float wrappedDiffuse = clamp(dot(normal, lightDirection) * 0.5 + 0.5, 0.0, 1.0);
  float rim = pow(1.0 - clamp(abs(dot(normal, viewDirection)), 0.0, 1.0), 2.0);
  float underside = clamp(normal.y * 0.5 + 0.5, 0.35, 1.0);

  vec3 glow = vec3(0.07, 0.2, 0.5) * night;
  vec3 ambient = (mix(vec3(dot(skyTint, vec3(0.3333))), skyTint, 0.5) * 1.05 + glow) * underside;
  vec3 direct = sunLightColor * wrappedDiffuse * wrappedDiffuse * 1.15;
  vec3 rimLight = (sunLightColor * 0.55 + skyTint * 0.7 + glow * 2.2) * rim;
  vec3 color = ambient + direct + rimLight;

  float fogAmount = 1.0 - exp(-travelledDistance / CLOUD_FOG_DISTANCE);
  return mix(color, horizonColor, fogAmount);
}

// Walks the cloud slab cell by cell along the ray and blends every body it crosses front to back.
// Returns the light gathered (already weighted by what is left of the ray) and the remaining transmittance.
vec4 traceClouds(vec3 origin, vec3 direction, vec2 windOffset) {
  vec3 gathered = vec3(0.0);
  float transmittance = 1.0;

  float slabTop = CLOUD_BASE_Y + CLOUD_CELL_HEIGHT * float(CLOUD_LAYERS);
  if (abs(direction.y) < 0.0001) return vec4(gathered, transmittance);
  float distanceToBottom = (CLOUD_BASE_Y - origin.y) / direction.y;
  float distanceToTop = (slabTop - origin.y) / direction.y;
  float enterDistance = max(min(distanceToBottom, distanceToTop), 0.0);
  float exitDistance = min(max(distanceToBottom, distanceToTop), CLOUD_MAX_DISTANCE);
  if (exitDistance <= enterDistance) return vec4(gathered, transmittance);

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

    if (cloudCellFilled(cell, windOffset)) {
      vec3 bodyOffset;
      vec3 halfExtents;
      float cornerRadius;
      cloudBodyOf(cell, bodyOffset, halfExtents, cornerRadius);
      vec3 bodyCenter = (vec3(cell) + 0.5) * cellSize + bodyOffset;
      vec3 localOrigin = gridOrigin - bodyCenter;

      vec3 boundA = (-halfExtents - localOrigin) * inverseDirection;
      vec3 boundB = (halfExtents - localOrigin) * inverseDirection;
      vec3 nearBounds = min(boundA, boundB);
      vec3 farBounds = max(boundA, boundB);
      float boxEnter = max(nearBounds.x, max(nearBounds.y, nearBounds.z));
      float boxExit = min(farBounds.x, min(farBounds.y, farBounds.z));

      if (boxExit > max(boxEnter, 0.0)) {
        float surfaceDistance = max(boxEnter, 0.0);
        bool hitSurface = false;
        for (int traceIndex = 0; traceIndex < 6; traceIndex++) {
          float gap = roundedBoxDistance(localOrigin + direction * surfaceDistance, halfExtents, cornerRadius);
          if (gap < 0.05) { hitSurface = true; break; }
          surfaceDistance += gap;
          if (surfaceDistance > boxExit) break;
        }
        if (hitSurface) {
          float backDistance = 0.0;
          vec3 exitPoint = localOrigin + direction * boxExit;
          for (int backIndex = 0; backIndex < 6; backIndex++) {
            float gap = roundedBoxDistance(exitPoint - direction * backDistance, halfExtents, cornerRadius);
            if (gap < 0.05) break;
            backDistance += gap;
          }
          float chord = max((boxExit - backDistance) - surfaceDistance, 0.0);
          float alpha = 1.0 - exp(-chord * CLOUD_OPACITY_PER_BLOCK);
          vec3 surfaceNormal = roundedBoxNormal(localOrigin + direction * surfaceDistance, halfExtents, cornerRadius);
          vec3 bodyColor = shadeCloudBody(surfaceNormal, direction, surfaceDistance + travelled);
          gathered += transmittance * alpha * bodyColor;
          transmittance *= 1.0 - alpha;
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

vec3 skyGradient(vec3 direction) {
  float elevation = clamp(direction.y, -1.0, 1.0);
  vec3 color = mix(horizonColor, zenithColor, pow(max(elevation, 0.0), 0.5));
  return mix(color, horizonColor * 0.5, smoothstep(0.0, -0.5, elevation));
}

bool discTexel(vec3 direction, vec3 center, float halfSize, out vec2 texel) {
  texel = vec2(0.0);
  float facing = dot(direction, center);
  if (facing <= 0.0) return false;
  vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), center));
  vec3 up = cross(center, right);
  vec2 unit = vec2(dot(direction, right), dot(direction, up)) / facing / halfSize;
  if (max(abs(unit.x), abs(unit.y)) >= 1.0) return false;
  texel = (floor((unit * 0.5 + 0.5) * DISC_TEXELS) + 0.5) / DISC_TEXELS * 2.0 - 1.0;
  return true;
}

vec3 starField(vec3 direction) {
  vec3 rotated = starRotation * direction;
  vec3 magnitude = abs(rotated);
  float major = max(magnitude.x, max(magnitude.y, magnitude.z));
  vec2 faceUv;
  float faceId;
  if (magnitude.x == major) {
    faceUv = rotated.yz / major;
    faceId = rotated.x > 0.0 ? 0.0 : 1.0;
  } else if (magnitude.y == major) {
    faceUv = rotated.xz / major;
    faceId = rotated.y > 0.0 ? 2.0 : 3.0;
  } else {
    faceUv = rotated.xy / major;
    faceId = rotated.z > 0.0 ? 4.0 : 5.0;
  }
  float cellHash = hash13(vec3(floor(faceUv * STAR_GRID), faceId));
  float isStar = step(1.0 - STAR_DENSITY, cellHash);
  float brightness = 0.35 + 0.65 * fract(cellHash * 91.7);
  float twinkle = 0.8 + 0.2 * sin(elapsedSeconds * (1.0 + 2.0 * fract(cellHash * 13.1)) + cellHash * 80.0);
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(cellHash * 7.3));
  return tint * isStar * brightness * twinkle;
}

void main() {
  vec3 direction = normalize(vDirection);
  vec3 color = skyGradient(direction);

  color += starField(direction) * starVisibility * smoothstep(0.02, 0.3, direction.y);

  float glowAlignment = max(dot(direction, sunDirection), 0.0);
  color = mix(color, glowColor, clamp(pow(glowAlignment, 6.0) * glowStrength * 0.8, 0.0, 1.0));

  vec2 texel;
  if (discTexel(direction, sunDirection, SUN_HALF_SIZE, texel)) {
    float ring = max(abs(texel.x), abs(texel.y));
    color = ring < 0.5 ? vec3(2.2, 2.1, 1.7) : vec3(1.9, 1.35, 0.55);
  }
  if (discTexel(direction, moonDirection, MOON_HALF_SIZE, texel)) {
    vec3 surfaceNormal = vec3(texel, sqrt(max(1.0 - dot(texel, texel), 0.0)));
    vec3 phaseLight = vec3(sin(moonPhaseAngle), 0.0, cos(moonPhaseAngle));
    if (dot(surfaceNormal, phaseLight) > -0.02) {
      float crater = step(0.72, hash13(vec3(texel * 8.0, 3.0)));
      color = vec3(0.72, 0.78, 0.95) * mix(1.0, 0.62, crater);
    }
  }

  float horizonFog = fogStrength * (1.0 - smoothstep(0.0, 0.2 + 0.45 * fogStrength, direction.y));
  color = mix(color, fogColor, clamp(horizonFog * 1.15 + fogStrength * 0.3, 0.0, 1.0));

  vec2 windOffset = CLOUD_WIND * elapsedSeconds;
  vec4 clouds = traceClouds(viewerPosition, direction, windOffset);
  vec3 cloudLight = mix(clouds.rgb, fogColor * (1.0 - clouds.w), fogStrength * 0.45);
  color = color * clouds.w + cloudLight;
  color = mix(color, mistColor, cloudMist);

  float screenNoise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  color += (screenNoise - 0.5) / 255.0;

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;
