// Pixel-art sky: a banded gradient, square sun and moon made of 8x8 texels, a star field of single-cell stars and
// voxel clouds. The clouds are a slab of CLOUD_LAYER_COUNT cell layers walked with a 3D grid traversal; each cell is
// filled where drifting, slowly evolving noise beats a coverage that rises with the local humidity (a texture sampled
// at the cell's world position) and the global weather shift. The dome renders at the far plane around the camera.

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
uniform sampler2D humidityTexture;
uniform vec2 humidityOrigin;
uniform float humidityCellSize;
uniform float humidityGridCells;

const float GRADIENT_BANDS = 14.0;
const float GLOW_BANDS = 6.0;
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
const float CLOUD_FOG_DISTANCE = 1100.0;
const vec2 CLOUD_WIND = vec2(${glslFloat(CLOUD_WIND_BLOCKS_PER_SECOND.x)}, ${glslFloat(CLOUD_WIND_BLOCKS_PER_SECOND.z)});
const float CLOUD_EVOLUTION = ${glslFloat(CLOUD_EVOLUTION_PER_SECOND)};
const float CLOUD_BASE_COVERAGE = ${glslFloat(CLOUD_BASE_COVERAGE)};
const float CLOUD_HUMIDITY_GAIN = ${glslFloat(CLOUD_HUMIDITY_GAIN)};
const float NOISE_WRAP = 1024.0;

float hash13(vec3 point) {
  point = fract(point * 0.1031);
  point += dot(point, point.zyx + 31.32);
  return fract((point.x + point.y) * point.z);
}

float valueNoise(vec3 point) {
  vec3 base = floor(point);
  vec3 fraction = point - base;
  vec3 eased = fraction * fraction * (3.0 - 2.0 * fraction);
  float c000 = hash13(mod(base, NOISE_WRAP));
  float c100 = hash13(mod(base + vec3(1.0, 0.0, 0.0), NOISE_WRAP));
  float c010 = hash13(mod(base + vec3(0.0, 1.0, 0.0), NOISE_WRAP));
  float c110 = hash13(mod(base + vec3(1.0, 1.0, 0.0), NOISE_WRAP));
  float c001 = hash13(mod(base + vec3(0.0, 0.0, 1.0), NOISE_WRAP));
  float c101 = hash13(mod(base + vec3(1.0, 0.0, 1.0), NOISE_WRAP));
  float c011 = hash13(mod(base + vec3(0.0, 1.0, 1.0), NOISE_WRAP));
  float c111 = hash13(mod(base + vec3(1.0, 1.0, 1.0), NOISE_WRAP));
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
  vec2 cellCenterWorld = (vec2(float(cell.x), float(cell.z)) + 0.5) * CLOUD_CELL_WIDTH + windOffset;
  float coverage = clamp(CLOUD_BASE_COVERAGE + humidityAt(cellCenterWorld) * CLOUD_HUMIDITY_GAIN + weatherShift, 0.0, 1.0);
  vec3 noisePosition = vec3(float(cell.x), float(cell.y) * 1.6, float(cell.z)) * 0.085
    + vec3(0.0, elapsedSeconds * CLOUD_EVOLUTION, 0.0);
  float shape = 0.62 * valueNoise(noisePosition) + 0.38 * valueNoise(noisePosition * 2.3 + 17.0);
  float density = clamp((shape - 0.5) * 2.0 + 0.5, 0.0, 1.0);
  density -= abs(float(cell.y) - float(CLOUD_LAYERS - 1) * 0.5) * 0.12;
  return density > 1.0 - coverage;
}

struct CloudHit {
  bool found;
  float distance;
  vec3 normal;
  ivec3 cell;
};

CloudHit traceClouds(vec3 origin, vec3 direction, vec2 windOffset) {
  CloudHit hit;
  hit.found = false;
  hit.distance = 0.0;
  hit.normal = vec3(0.0, 1.0, 0.0);
  hit.cell = ivec3(0);

  float slabTop = CLOUD_BASE_Y + CLOUD_CELL_HEIGHT * float(CLOUD_LAYERS);
  if (abs(direction.y) < 0.0001) return hit;
  float distanceToBottom = (CLOUD_BASE_Y - origin.y) / direction.y;
  float distanceToTop = (slabTop - origin.y) / direction.y;
  float enterDistance = max(min(distanceToBottom, distanceToTop), 0.0);
  float exitDistance = min(max(distanceToBottom, distanceToTop), CLOUD_MAX_DISTANCE);
  if (exitDistance <= enterDistance) return hit;
  bool startsInsideSlab = enterDistance == 0.0;

  vec3 cellSize = vec3(CLOUD_CELL_WIDTH, CLOUD_CELL_HEIGHT, CLOUD_CELL_WIDTH);
  vec3 safeDirection = mix(direction, vec3(0.00001), vec3(lessThan(abs(direction), vec3(0.00001))));
  float travelled = enterDistance + 0.01;
  vec3 start = origin + direction * travelled - vec3(windOffset.x, CLOUD_BASE_Y, windOffset.y);
  ivec3 cell = ivec3(floor(start / cellSize));
  ivec3 stepDirection = ivec3(sign(safeDirection));
  vec3 nextBoundary = (vec3(cell) + max(sign(safeDirection), 0.0)) * cellSize;
  vec3 nextCrossing = travelled + (nextBoundary - start) / safeDirection;
  vec3 crossingSpacing = abs(cellSize / safeDirection);
  vec3 enteredNormal = vec3(0.0, -sign(direction.y), 0.0);

  for (int stepIndex = 0; stepIndex < CLOUD_MAX_STEPS; stepIndex++) {
    if (travelled > exitDistance) break;
    bool skipStartingCell = startsInsideSlab && stepIndex == 0;
    if (!skipStartingCell && cloudCellFilled(cell, windOffset)) {
      hit.found = true;
      hit.distance = travelled;
      hit.normal = enteredNormal;
      hit.cell = cell;
      return hit;
    }
    if (nextCrossing.x < nextCrossing.y && nextCrossing.x < nextCrossing.z) {
      travelled = nextCrossing.x;
      nextCrossing.x += crossingSpacing.x;
      cell.x += stepDirection.x;
      enteredNormal = vec3(-float(stepDirection.x), 0.0, 0.0);
    } else if (nextCrossing.y < nextCrossing.z) {
      travelled = nextCrossing.y;
      nextCrossing.y += crossingSpacing.y;
      cell.y += stepDirection.y;
      enteredNormal = vec3(0.0, -float(stepDirection.y), 0.0);
    } else {
      travelled = nextCrossing.z;
      nextCrossing.z += crossingSpacing.z;
      cell.z += stepDirection.z;
      enteredNormal = vec3(0.0, 0.0, -float(stepDirection.z));
    }
  }
  return hit;
}

vec3 shadeCloud(CloudHit hit, vec2 windOffset) {
  vec3 lightDirection = sunDirection.y > -0.05 ? sunDirection : moonDirection;
  float facing = max(dot(hit.normal, lightDirection), 0.0);
  ivec3 towardLight = hit.cell + ivec3(int(sign(lightDirection.x)), lightDirection.y > 0.3 ? 1 : 0, int(sign(lightDirection.z)));
  float lightReaching = cloudCellFilled(towardLight, windOffset) ? 0.35 : 1.0;
  float underside = hit.normal.y < -0.5 ? 0.8 : 1.0;
  vec3 skyTint = mix(horizonColor, zenithColor, 0.25);
  vec3 ambient = mix(vec3(dot(skyTint, vec3(0.3333))), skyTint, 0.35) * 0.95 * underside;
  vec3 lit = sunLightColor * facing * lightReaching * 1.1;
  vec3 albedo = vec3(0.96);
  vec3 color = albedo * (ambient + lit);
  float fogAmount = 1.0 - exp(-hit.distance / CLOUD_FOG_DISTANCE);
  return mix(color, horizonColor, fogAmount);
}

vec3 skyGradient(vec3 direction) {
  float elevation = clamp(direction.y, -1.0, 1.0);
  float gradient = pow(max(elevation, 0.0), 0.5);
  gradient = floor(gradient * GRADIENT_BANDS + 0.5) / GRADIENT_BANDS;
  vec3 color = mix(horizonColor, zenithColor, gradient);
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
  float glow = floor(pow(glowAlignment, 6.0) * glowStrength * GLOW_BANDS + 0.5) / GLOW_BANDS;
  color = mix(color, glowColor, clamp(glow * 0.8, 0.0, 1.0));

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

  vec2 windOffset = CLOUD_WIND * elapsedSeconds;
  CloudHit hit = traceClouds(viewerPosition, direction, windOffset);
  if (hit.found) color = mix(shadeCloud(hit, windOffset), fogColor, fogStrength * 0.45);

  float horizonFog = fogStrength * (1.0 - smoothstep(0.0, 0.2 + 0.45 * fogStrength, direction.y));
  color = mix(color, fogColor, clamp(horizonFog * 1.15 + fogStrength * 0.3, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;
