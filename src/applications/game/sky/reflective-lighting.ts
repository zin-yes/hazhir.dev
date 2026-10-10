// Mirror-like surfaces, shared by real chunks and the far terrain. Water is a rippling sheet (see water-surface.ts) that
// mirrors the sky by Schlick fresnel, glitters where the sun or moon reflects, breaks into whitecaps on rough crests and
// turns opaque as it reflects more. Glass and ice mirror the sky off their flat faces the same way, stronger for glass.
// All of it needs FOG_GLSL (noise and clock), SURFACE_LIGHTING_GLSL and WIND_GLSL before it.

import { WATER_SURFACE_GLSL } from "./water-surface";

export const REFLECTIVE_LIGHTING_GLSL = `
${WATER_SURFACE_GLSL}

/**
 * Colour (display space) of the sky and the sun or moon seen in a mirror with this normal, already scaled by how much
 * sky the spot can see. glitterScatter widens the sun's reflection (rough water) without moving it.
 */
vec3 mirroredSky(vec3 normal, vec3 toCamera, vec3 worldPosition, vec3 surfaceNormal, float bakedShade, float skyExposure, float distanceToCamera, float sparkle) {
  vec3 mirrored = reflect(-toCamera, normal);
  vec3 sky = skyColorTowards(vec3(mirrored.x, abs(mirrored.y), mirrored.z));
  float alongLight = max(dot(mirrored, skyLightDirection), 0.0);
  float glitter = (pow(alongLight, 900.0) * 14.0 + pow(alongLight, 70.0) * 0.55 + pow(alongLight, 8.0) * 0.05) * sparkle;
  float sunReach = 0.0;
  if (glitter > 0.002 && skyExposure > 0.0) {
    sunReach = sunVisibility(worldPosition, surfaceNormal, skyLightDirection, distanceToCamera) * skyExposure;
  }
  float skyReach = mix(0.1, 1.0, skyExposure) * pow(max(bakedShade, 0.05), 2.2);
  return srgbEncode(filmicToneMap((sky * skyReach + skyDirectColor * glitter * sunReach) * nightAdjustedExposure()));
}

float schlickFresnel(float facingCamera, float reflectanceAtNormal) {
  return reflectanceAtNormal + (1.0 - reflectanceAtNormal) * pow(1.0 - facingCamera, 5.0);
}

/** Water with white foam laid over it where waves break. Foam is lit like any pale surface. */
vec3 layWhitecaps(vec3 waterColor, float whitecaps, float bakedShade, vec3 worldPosition, float skyExposure) {
  if (whitecaps < 0.01) return waterColor;
  vec3 foamColor = shadeSurface(vec3(0.9, 0.95, 1.0), bakedShade, vec3(0.0, 1.0, 0.0), worldPosition, skyExposure, 0.0);
  return mix(waterColor, foamColor, whitecaps * 0.85);
}

/** Water: its own colour lit by the sky, with the sky mirrored in. Alpha rises with the reflection. */
vec4 shadeWater(vec3 albedoLinear, float bakedShade, vec3 surfaceNormal, vec3 worldPosition, float skyExposure, float baseAlpha) {
  float distanceToCamera = length(cameraPosition - worldPosition);
  bool isTopFace = surfaceNormal.y > 0.9;
  WaterSurface surface = WaterSurface(surfaceNormal, 0.0);
  if (isTopFace) surface = waterSurface(worldPosition.xz, distanceToCamera);
  vec3 normal = surface.normal;
  vec3 toCamera = (cameraPosition - worldPosition) / max(distanceToCamera, 0.0001);
  float facingCamera = clamp(dot(normal, toCamera), 0.0, 1.0);
  float reflectivity = schlickFresnel(facingCamera, 0.06) * (isTopFace ? 1.0 : 0.5);
  float sparkle = 0.45 + 0.8 * fogNoise(worldPosition.xz * 9.0 + skyFogTime * 1.3) + 0.5 * fogNoise(worldPosition.zx * 3.7 - skyFogTime * 0.9);
  vec3 reflected = mirroredSky(normal, toCamera, worldPosition, surfaceNormal, bakedShade, skyExposure, distanceToCamera, sparkle);
  vec3 lit = shadeSurface(albedoLinear, bakedShade, surfaceNormal, worldPosition, skyExposure, 0.0);
  float mirrorShare = clamp(reflectivity * 1.15, 0.0, 0.97);
  vec3 color = layWhitecaps(mix(lit, reflected, mirrorShare), surface.whitecaps, bakedShade, worldPosition, skyExposure);
  return vec4(color, mix(mix(baseAlpha, 1.0, mirrorShare), 1.0, surface.whitecaps));
}

/**
 * Glass and ice: the sky mirrored off the flat face over the surface's own colour. coverage is the texel's own alpha;
 * a clear pane becomes visible only through its reflection (alpha rises with it).
 */
vec4 shadeMirrorSurface(vec3 litColor, float coverage, vec3 surfaceNormal, vec3 worldPosition, float bakedShade, float skyExposure, float reflectanceAtNormal) {
  float distanceToCamera = length(cameraPosition - worldPosition);
  vec3 toCamera = (cameraPosition - worldPosition) / max(distanceToCamera, 0.0001);
  float facingCamera = clamp(dot(surfaceNormal, toCamera), 0.0, 1.0);
  float reflectivity = schlickFresnel(facingCamera, reflectanceAtNormal);
  vec3 reflected = mirroredSky(surfaceNormal, toCamera, worldPosition, surfaceNormal, bakedShade, skyExposure, distanceToCamera, 1.0);
  vec3 color = mix(litColor, reflected, mix(1.0, reflectivity, coverage));
  return vec4(color, coverage + (1.0 - coverage) * reflectivity);
}
`;
