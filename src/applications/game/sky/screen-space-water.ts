// Water that reads the world behind it. A copy of the opaque world (colour and depth, see post/world-snapshot.ts) gives
// the water its depth: light is absorbed the deeper you look (red first), the bottom shows through refracted by the
// ripples and lit by caustics, the shoreline foams where the water is thin, and the surface mirrors the actual terrain,
// trees and blocks by marching the reflected ray through the depth buffer. Whatever the ray misses falls back to the
// mirrored sky. Needs FOG_GLSL, SURFACE_LIGHTING_GLSL and REFLECTIVE_LIGHTING_GLSL before it.

import { WATER_CAUSTICS_GLSL } from "./water-caustics";

const REFLECTION_STEPS = 48;
const REFLECTION_REFINE_STEPS = 6;
const REFLECTION_MAX_DISTANCE_BLOCKS = 160;
/** Beyond this distance from the camera the water drops back to its plain look, which the far terrain's water shares. */
const FULL_EFFECT_DISTANCE_BLOCKS = 70;
const NO_EFFECT_DISTANCE_BLOCKS = 150;

export const SCREEN_SPACE_WATER_GLSL = `
${WATER_CAUSTICS_GLSL}
uniform sampler2D worldSnapshotColor;
uniform sampler2D worldSnapshotDepth;
uniform float worldSnapshotEnabled;
uniform mat4 worldSnapshotViewProjection;
uniform vec2 worldSnapshotNearFar;
uniform vec2 worldSnapshotResolution;

float snapshotViewDepth(float hardwareDepth) {
  float near = worldSnapshotNearFar.x;
  float far = worldSnapshotNearFar.y;
  float ndc = hardwareDepth * 2.0 - 1.0;
  return 2.0 * near * far / (far + near - ndc * (far - near));
}

/** x, y: screen coordinates 0..1; z: distance along the view axis. */
vec3 projectToSnapshot(vec3 worldPosition) {
  vec4 clip = worldSnapshotViewProjection * vec4(worldPosition, 1.0);
  return vec3(clip.xy / clip.w * 0.5 + 0.5, clip.w);
}

float interleavedNoise(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

/** Marches a world space ray through the depth copy. Returns the hit colour (rgb) and how far to trust it (a). */
vec4 traceWorldReflection(vec3 origin, vec3 direction, float jitter) {
  float previousDistance = 0.0;
  for (int step = 1; step <= ${REFLECTION_STEPS}; step++) {
    float fraction = (float(step) - 1.0 + jitter) / ${REFLECTION_STEPS}.0;
    float travelled = 0.3 + ${REFLECTION_MAX_DISTANCE_BLOCKS}.0 * (0.3 * fraction + 0.7 * fraction * fraction);
    vec3 screen = projectToSnapshot(origin + direction * travelled);
    if (screen.z <= 0.0 || screen.x < 0.0 || screen.x > 1.0 || screen.y < 0.0 || screen.y > 1.0) return vec4(0.0);
    float sceneDepth = snapshotViewDepth(texture(worldSnapshotDepth, screen.xy).r);
    float behindBy = screen.z - sceneDepth;
    float thickness = 0.5 + screen.z * 0.05 + (travelled - previousDistance) * 0.6;
    if (behindBy > 0.0 && behindBy < thickness) {
      float low = previousDistance;
      float high = travelled;
      for (int refine = 0; refine < ${REFLECTION_REFINE_STEPS}; refine++) {
        float middle = 0.5 * (low + high);
        vec3 middleScreen = projectToSnapshot(origin + direction * middle);
        float middleDepth = snapshotViewDepth(texture(worldSnapshotDepth, middleScreen.xy).r);
        if (middleScreen.z > middleDepth) high = middle; else low = middle;
      }
      vec3 hitScreen = projectToSnapshot(origin + direction * high);
      vec2 edge = min(hitScreen.xy, 1.0 - hitScreen.xy);
      float edgeFade = smoothstep(0.0, 0.08, min(edge.x, edge.y));
      float distanceFade = 1.0 - smoothstep(0.7, 1.0, high / ${REFLECTION_MAX_DISTANCE_BLOCKS}.0);
      return vec4(texture(worldSnapshotColor, hitScreen.xy).rgb, edgeFade * distanceFade);
    }
    previousDistance = travelled;
  }
  return vec4(0.0);
}

/** Water that is lit, deep, refracting, foaming and mirroring the world. Returns display colour and alpha. */
vec4 shadeScreenSpaceWater(
  vec3 albedoLinear,
  float bakedShade,
  vec3 surfaceNormal,
  vec3 worldPosition,
  float skyExposure,
  float plainAlpha,
  vec4 plainWater
) {
  float distanceToCamera = length(cameraPosition - worldPosition);
  float effect = worldSnapshotEnabled * (1.0 - smoothstep(${FULL_EFFECT_DISTANCE_BLOCKS}.0, ${NO_EFFECT_DISTANCE_BLOCKS}.0, distanceToCamera));
  if (effect <= 0.001) return plainWater;

  bool isTopFace = surfaceNormal.y > 0.9;
  WaterSurface surface = WaterSurface(surfaceNormal, 0.0);
  if (isTopFace) surface = waterSurface(worldPosition.xz, distanceToCamera);
  vec3 normal = surface.normal;
  vec3 toCamera = (cameraPosition - worldPosition) / max(distanceToCamera, 0.0001);
  float facingCamera = clamp(dot(normal, toCamera), 0.0, 1.0);
  float reflectivity = schlickFresnel(facingCamera, 0.02) * (isTopFace ? 1.0 : 0.5);

  vec2 screenUv = gl_FragCoord.xy / worldSnapshotResolution;
  vec3 surfaceScreen = projectToSnapshot(worldPosition);
  float depthBehind = snapshotViewDepth(texture(worldSnapshotDepth, screenUv).r);
  float thickness = max(depthBehind - surfaceScreen.z, 0.0);

  vec2 refractedUv = screenUv + normal.xz * 0.03 * clamp(thickness * 0.4, 0.0, 1.0) / max(surfaceScreen.z * 0.05, 1.0);
  float refractedDepth = snapshotViewDepth(texture(worldSnapshotDepth, refractedUv).r);
  if (refractedDepth < surfaceScreen.z) refractedUv = screenUv;
  float bottomViewDepth = snapshotViewDepth(texture(worldSnapshotDepth, refractedUv).r);
  float opticalDepth = max(bottomViewDepth - surfaceScreen.z, 0.0);
  vec3 behind = texture(worldSnapshotColor, refractedUv).rgb;
  vec3 bottomPosition = cameraPosition + (worldPosition - cameraPosition) * (bottomViewDepth / max(surfaceScreen.z, 0.0001));
  vec3 bottomSlope = cross(dFdx(bottomPosition), dFdy(bottomPosition));
  vec3 bottomNormal = dot(bottomSlope, bottomSlope) > 0.000001 ? normalize(bottomSlope) : vec3(0.0, 1.0, 0.0);
  if (dot(bottomNormal, cameraPosition - bottomPosition) < 0.0) bottomNormal = -bottomNormal;
  float causticReach = isTopFace ? smoothstep(0.15, 0.7, opticalDepth) * (1.0 - smoothstep(30.0, 60.0, opticalDepth)) * skyExposure : 0.0;
  if (causticReach > 0.001) {
    behind *= mix(1.0, waterCausticLight(bottomPosition, bottomNormal, worldPosition.y, causticSunStrength()), causticReach);
  }

  vec3 absorption = exp(-opticalDepth * vec3(0.34, 0.1, 0.055));
  vec3 skyLight = hemisphereLight(vec3(0.0, 1.0, 0.0)) + skyDirectColor * 0.35 * skyExposure;
  vec3 deepColor = srgbEncode(filmicToneMap(vec3(0.012, 0.085, 0.14) * skyLight * pow(max(bakedShade, 0.05), 2.2) * nightAdjustedExposure()));
  vec3 transmitted = mix(deepColor, behind, absorption);

  float sparkle = 0.45 + 0.8 * fogNoise(worldPosition.xz * 9.0 + skyFogTime * 1.3) + 0.5 * fogNoise(worldPosition.zx * 3.7 - skyFogTime * 0.9);
  vec3 mirroredDirection = reflect(-toCamera, normal);
  vec3 skyMirror = mirroredSky(normal, toCamera, worldPosition, surfaceNormal, bakedShade, skyExposure, distanceToCamera, sparkle);
  vec4 worldMirror = vec4(0.0);
  if (isTopFace && dot(mirroredDirection, toCamera) < 0.55 && mirroredDirection.y > 0.0) {
    worldMirror = traceWorldReflection(worldPosition + surfaceNormal * 0.04, mirroredDirection, interleavedNoise(gl_FragCoord.xy));
  }
  float towardsViewer = 1.0 - smoothstep(0.1, 0.55, dot(mirroredDirection, toCamera));
  vec3 mirrored = mix(skyMirror, worldMirror.rgb, worldMirror.a * towardsViewer);

  float shore = 1.0 - smoothstep(0.1, 1.1, thickness);
  float foamBands = 0.5 + 0.5 * sin(thickness * 11.0 - skyFogTime * 1.6 + fogNoise(worldPosition.xz * 1.3) * 6.0);
  float foam = shore * smoothstep(0.35, 0.8, foamBands * 0.7 + fogNoise(worldPosition.xz * 2.7 + skyFogTime * 0.25) * 0.5) * (isTopFace ? 1.0 : 0.0);
  vec3 foamColor = shadeSurface(vec3(0.9, 0.95, 1.0), bakedShade, vec3(0.0, 1.0, 0.0), worldPosition, skyExposure, 0.0);

  vec3 water = mix(transmitted, mirrored, clamp(reflectivity * 1.1, 0.0, 0.97));
  water = mix(water, foamColor, foam * 0.85);
  water = mix(water, foamColor, surface.whitecaps * 0.85);
  return vec4(mix(plainWater.rgb, water, effect), mix(plainWater.a, 1.0, effect));
}
`;
