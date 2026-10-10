// What the player sees with the camera in water, drawn over the finished world as part of the final composite (see
// bloom-pass.ts). Every pixel is traced from its spot on the near plane to the geometry it hit, using the world depth,
// against the flat plane of the water surface above the camera. That one rule handles every case:
//
//   - A ray that stays under water is dimmed and tinted by the length it travelled (red goes first), fades into the
//     blue-green scatter of the open water, and lights the bottom with caustics.
//   - A ray that climbs to the surface leaves through it. Close to straight up it sees the world above through the
//     rippling surface (Snell's window); flatter than about 41 degrees it is totally reflected and shows only water.
//   - With the camera at the waterline, the near plane straddles the surface, so rows above it are plain air and
//     rows below it are under water, split by a moving meniscus.
//
// On top come slow wobble of the whole picture, shafts of sunlight falling from the surface and drifting motes.

import * as THREE from "three";
import { FOG_GLSL, LIGHTING_GLSL } from "../sky/sky-lighting";
import { WATER_CAUSTICS_GLSL } from "../sky/water-caustics";
import { WATER_SURFACE_GLSL } from "../sky/water-surface";
import { WIND_GLSL } from "../sky/wind";

/** The effect starts when the eye is this far above the surface: the near plane then still dips into the water. */
const ACTIVE_ABOVE_SURFACE_BLOCKS = 0.35;

export const underwaterUniforms = {
  /** 1 while the camera is in or just above water, else 0 (the composite then skips the effect). */
  underwaterActive: { value: 0 },
  underwaterSurfaceY: { value: 0 },
  underwaterDepth: { value: null as THREE.Texture | null },
  underwaterInverseViewProjection: { value: new THREE.Matrix4() },
  underwaterEye: { value: new THREE.Vector3() },
  underwaterCameraRight: { value: new THREE.Vector3(1, 0, 0) },
  underwaterCameraUp: { value: new THREE.Vector3(0, 1, 0) },
  /** Width over height of the picture, and the height of the view per block of distance (2 tan(fov / 2)). */
  underwaterAspect: { value: 1 },
  underwaterViewHeightPerBlock: { value: 1.4 },
};

const viewProjection = new THREE.Matrix4();

/**
 * Points the effect at this frame's camera and water surface. `surfaceHeight` is the surface in the camera's column
 * (see camera-water-surface.ts) or null. Returns whether the effect is on.
 */
export function updateUnderwaterView(camera: THREE.PerspectiveCamera, surfaceHeight: number | null): boolean {
  const isActive = surfaceHeight !== null && camera.position.y < surfaceHeight + ACTIVE_ABOVE_SURFACE_BLOCKS;
  underwaterUniforms.underwaterActive.value = isActive ? 1 : 0;
  if (!isActive) return false;
  camera.updateMatrixWorld();
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  underwaterUniforms.underwaterInverseViewProjection.value.copy(viewProjection).invert();
  underwaterUniforms.underwaterSurfaceY.value = surfaceHeight;
  underwaterUniforms.underwaterEye.value.copy(camera.position);
  underwaterUniforms.underwaterCameraRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
  underwaterUniforms.underwaterCameraUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
  underwaterUniforms.underwaterAspect.value = camera.aspect;
  underwaterUniforms.underwaterViewHeightPerBlock.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  return true;
}

/** Light absorbed per block of water, per colour channel: red is gone in a few dozen blocks, blue lasts. */
const ABSORPTION_PER_BLOCK = "vec3(0.30, 0.075, 0.045)";
/** Share of the view replaced by scattered light per block. */
const SCATTER_PER_BLOCK = 0.05;
/** Light lost per block of depth below the surface. */
const DEPTH_DIMMING_PER_BLOCK = 0.03;
/** Screen distance a surface ripple of full slope pushes the world seen through the surface. */
const SURFACE_REFRACTION_SHIFT = 0.06;
/** Cosine of the critical angle of water to air (about 48.6 degrees from straight up). */
const CRITICAL_ANGLE_COSINE = 0.661;

export const UNDERWATER_VIEW_GLSL = `
${LIGHTING_GLSL}
${FOG_GLSL}
${WIND_GLSL}
${WATER_SURFACE_GLSL}
${WATER_CAUSTICS_GLSL}

uniform float skyDaylight;
uniform sampler2D underwaterDepth;
uniform mat4 underwaterInverseViewProjection;
uniform float underwaterActive;
uniform float underwaterSurfaceY;
uniform vec3 underwaterEye;
uniform vec3 underwaterCameraRight;
uniform vec3 underwaterCameraUp;
uniform float underwaterAspect;
uniform float underwaterViewHeightPerBlock;

vec3 underwaterUnproject(vec2 uv, float depth) {
  vec4 world = underwaterInverseViewProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return world.xyz / world.w;
}

/**
 * Unit direction of the view ray through this spot of the screen. Taken from a point about ten blocks out, not from the
 * far plane: there the unprojection divides by a w that is the difference of two nearly equal numbers and can flip sign.
 */
vec3 underwaterRayDirection(vec2 uv, vec3 origin) {
  return normalize(underwaterUnproject(uv, 0.99) - origin);
}

/** Depth values above this are beyond about 5000 blocks: treated as open sky at that distance. */
const float UNDERWATER_SKY_DEPTH = 0.99999;
const float UNDERWATER_SKY_DISTANCE = 5000.0;

float underwaterHitDistance(vec2 uv, vec3 origin, float depth) {
  if (depth > UNDERWATER_SKY_DEPTH) return UNDERWATER_SKY_DISTANCE;
  return length(underwaterUnproject(uv, depth) - origin);
}

/** Linear colour of open water seen from this depth below the surface: deep blue-green, darker with depth and at night. */
vec3 underwaterScatterColor(float depthBelowSurface) {
  float daylight = mix(0.14, 1.0, skyDaylight);
  float sunlit = exp(-max(depthBelowSurface, 0.0) * ${DEPTH_DIMMING_PER_BLOCK});
  return vec3(0.008, 0.11, 0.17) * daylight * mix(0.5, 1.0, sunlit);
}

/** Motes of silt and plankton hanging in the water, in three layers that slide past at different speeds as you move. */
vec3 underwaterMotes(vec2 uv, float travelledDistance) {
  float brightness = 0.0;
  float time = skyFogTime;
  for (int layer = 0; layer < 3; layer++) {
    float layerDistance = 2.0 + 4.5 * float(layer);
    if (travelledDistance < layerDistance) continue;
    vec2 ground = (uv - 0.5) * vec2(underwaterAspect, 1.0) * underwaterViewHeightPerBlock * layerDistance
      + vec2(dot(underwaterEye, underwaterCameraRight), dot(underwaterEye, underwaterCameraUp))
      + vec2(sin(time * 0.21 + float(layer)), time * 0.05 + cos(time * 0.17 + float(layer) * 2.0)) * 0.4;
    vec2 point = ground / 0.55;
    ivec2 cell = ivec2(floor(point));
    vec2 random = waterCellRandom(cell + ivec2(layer * 101, layer * 57));
    vec2 center = 0.25 + 0.5 * random.yx;
    float size = 0.03 + 0.03 * random.y;
    float spark = step(0.6, random.x) * smoothstep(size, 0.0, length(point - vec2(cell) - center));
    float twinkle = 0.5 + 0.5 * sin(time * (0.8 + random.y) + random.x * 40.0);
    brightness += spark * twinkle * exp(-layerDistance * 0.06);
  }
  return vec3(0.55, 0.85, 1.0) * brightness * 0.45 * mix(0.25, 1.0, skyDaylight);
}

/** Applies the underwater view to the world seen at this spot of the screen. Returns display colour. */
vec3 underwaterView(vec2 uv, sampler2D world) {
  float time = skyFogTime;
  float sunStrength = causticSunStrength();

  float startDepth = underwaterSurfaceY - underwaterUnproject(uv, 0.0).y;
  float submerged = smoothstep(0.0, 0.12, startDepth);
  vec2 drift = vec2(
    waterGradientNoise(vec2(uv.x * 2.7 + time * 0.31, uv.y * 2.7 - time * 0.19)).x,
    waterGradientNoise(vec2(uv.y * 2.7 - time * 0.27 + 9.1, uv.x * 2.7 + time * 0.23)).x
  );
  vec2 warpedUv = clamp(uv + drift * 0.004 * submerged, vec2(0.001), vec2(0.999));

  vec3 origin = underwaterUnproject(warpedUv, 0.0);
  float depth = texture(underwaterDepth, warpedUv).r;
  vec3 direction = underwaterRayDirection(warpedUv, origin);
  float hitDistance = underwaterHitDistance(warpedUv, origin, depth);
  vec3 hit = origin + direction * hitDistance;
  vec3 hitSlope = cross(dFdx(hit), dFdy(hit));
  vec3 hitNormal = dot(hitSlope, hitSlope) > 0.000000001 ? normalize(hitSlope) : vec3(0.0, 1.0, 0.0);
  if (dot(hitNormal, origin - hit) < 0.0) hitNormal = -hitNormal;
  vec3 sceneColor = texture(world, warpedUv).rgb;

  startDepth = underwaterSurfaceY - origin.y;
  float waterDistance = 0.0;
  float causticReach = 0.0;
  float surfaceDistance = 1.0e5;
  bool leavesThroughSurface = false;
  float entryBlend = 1.0;
  if (startDepth > 0.0) {
    if (direction.y > 0.0001) surfaceDistance = startDepth / direction.y;
    leavesThroughSurface = surfaceDistance < hitDistance;
    waterDistance = min(hitDistance, surfaceDistance);
    causticReach = leavesThroughSurface ? 0.0 : 1.0;
  } else if (direction.y < -0.0001) {
    float entryDistance = startDepth / direction.y;
    if (entryDistance < hitDistance) {
      waterDistance = hitDistance - entryDistance;
      entryBlend = 1.0 - smoothstep(0.08, 0.5, entryDistance);
      causticReach = 1.0;
    }
  }
  if (waterDistance <= 0.0) return sceneColor;

  float middleHeight = startDepth > 0.0 ? origin.y + direction.y * waterDistance * 0.5 : 0.5 * (underwaterSurfaceY + hit.y);
  vec3 scatter = underwaterScatterColor(underwaterSurfaceY - middleHeight);

  if (direction.y > 0.05 && startDepth > 0.0) {
    vec2 surfacePoint = origin.xz + direction.xz * min(startDepth / direction.y, 60.0);
    vec2 towardsLight = normalize(skyLightDirection.xz + vec2(0.0001));
    float shaft = waterGradientNoise(vec2(dot(surfacePoint, vec2(-towardsLight.y, towardsLight.x)) * 0.35 + time * 0.12, dot(surfacePoint, towardsLight) * 0.05)).x;
    shaft = pow(clamp(0.5 + 1.1 * shaft, 0.0, 1.0), 2.5) * sunStrength * smoothstep(0.05, 0.5, direction.y);
    scatter *= 1.0 + 3.2 * shaft;
  }

  vec3 visibility = exp(-${ABSORPTION_PER_BLOCK} * waterDistance);
  float scatterAmount = 1.0 - exp(-${SCATTER_PER_BLOCK} * waterDistance);

  vec3 color = srgbDecode(sceneColor);
  if (leavesThroughSurface) {
    vec3 crossing = origin + direction * surfaceDistance;
    WaterSurface surface = waterSurface(crossing.xz, surfaceDistance);
    float facing = dot(direction, surface.normal);
    vec3 horizontalSlope = vec3(surface.normal.x, 0.0, surface.normal.z);
    vec2 shifted = warpedUv + vec2(dot(horizontalSlope, underwaterCameraRight), dot(horizontalSlope, underwaterCameraUp)) * ${SURFACE_REFRACTION_SHIFT};
    shifted = clamp(shifted, vec2(0.001), vec2(0.999));
    float shiftedDepth = textureLod(underwaterDepth, shifted, 0.0).r;
    vec3 shiftedOrigin = underwaterUnproject(shifted, 0.0);
    vec3 shiftedHit = shiftedOrigin + underwaterRayDirection(shifted, shiftedOrigin) * underwaterHitDistance(shifted, shiftedOrigin, shiftedDepth);
    bool shiftedLeavesThroughSurface = shiftedHit.y > underwaterSurfaceY;
    vec3 airColor = srgbDecode(textureLod(world, shiftedLeavesThroughSurface ? shifted : warpedUv, 0.0).rgb);
    float window = smoothstep(${CRITICAL_ANGLE_COSINE} - 0.12, ${CRITICAL_ANGLE_COSINE} + 0.2, facing);
    vec3 windowColor = airColor * visibility + scatter * scatterAmount;
    vec3 reflectedColor = scatter * mix(1.0, 1.35, smoothstep(0.2, ${CRITICAL_ANGLE_COSINE}, facing));
    color = mix(reflectedColor, windowColor, window);
  } else {
    if (causticReach > 0.0 && depth < UNDERWATER_SKY_DEPTH) {
      float lightMultiplier = waterCausticLight(hit, hitNormal, underwaterSurfaceY, sunStrength);
      color *= mix(1.0, lightMultiplier, causticReach * entryBlend * (1.0 - smoothstep(25.0, 70.0, hitDistance)));
    }
    color = mix(color, color * visibility + scatter * scatterAmount, entryBlend);
  }

  vec3 display = srgbEncode(color);
  if (startDepth > 0.0) display += underwaterMotes(uv, waterDistance);
  return display;
}
`;
