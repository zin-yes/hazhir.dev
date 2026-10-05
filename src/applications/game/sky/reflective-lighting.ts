// Mirror-like surfaces, shared by real chunks and the far terrain. Water is a rippling sheet that mirrors the sky by
// Schlick fresnel, glitters where the sun or moon reflects, and turns opaque as it reflects more. Glass and ice mirror
// the sky off their flat faces the same way, stronger for glass. All of it needs FOG_GLSL (noise and clock) and
// SURFACE_LIGHTING_GLSL before it.

export const REFLECTIVE_LIGHTING_GLSL = `
const int WAVE_COUNT = 4;

/** Slope of the water surface: four travelling waves, the fine ones fading out with distance so they never shimmer. */
vec3 waterSurfaceNormal(vec3 worldPosition, float distanceToCamera) {
  const vec2 directions[WAVE_COUNT] = vec2[WAVE_COUNT](vec2(0.92, 0.39), vec2(-0.55, 0.83), vec2(0.31, -0.95), vec2(-0.88, -0.47));
  const float frequencies[WAVE_COUNT] = float[WAVE_COUNT](0.55, 1.15, 2.3, 4.6);
  const float amplitudes[WAVE_COUNT] = float[WAVE_COUNT](0.07, 0.05, 0.035, 0.022);
  const float speeds[WAVE_COUNT] = float[WAVE_COUNT](0.9, 1.3, 1.9, 2.7);
  vec2 slope = vec2(0.0);
  for (int wave = 0; wave < WAVE_COUNT; wave++) {
    float fade = 1.0 - smoothstep(40.0 * float(WAVE_COUNT - wave), 90.0 * float(WAVE_COUNT - wave) + 60.0, distanceToCamera);
    float phase = dot(directions[wave], worldPosition.xz) * frequencies[wave] + skyFogTime * speeds[wave];
    slope += directions[wave] * cos(phase) * amplitudes[wave] * frequencies[wave] * fade * 3.0;
  }
  vec2 detail = vec2(fogNoise(worldPosition.xz * 7.0 + skyFogTime * 0.7), fogNoise(worldPosition.xz * 7.0 + 19.0 - skyFogTime * 0.6)) - 0.5;
  slope += detail * 0.06 * (1.0 - smoothstep(20.0, 90.0, distanceToCamera));
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

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

/** Water: its own colour lit by the sky, with the sky mirrored in. Alpha rises with the reflection. */
vec4 shadeWater(vec3 albedoLinear, float bakedShade, vec3 surfaceNormal, vec3 worldPosition, float skyExposure, float baseAlpha) {
  float distanceToCamera = length(cameraPosition - worldPosition);
  bool isTopFace = surfaceNormal.y > 0.9;
  vec3 normal = isTopFace ? waterSurfaceNormal(worldPosition, distanceToCamera) : surfaceNormal;
  vec3 toCamera = (cameraPosition - worldPosition) / max(distanceToCamera, 0.0001);
  float facingCamera = clamp(dot(normal, toCamera), 0.0, 1.0);
  float reflectivity = schlickFresnel(facingCamera, 0.06) * (isTopFace ? 1.0 : 0.5);
  float sparkle = 0.55 + 0.9 * fogNoise(worldPosition.xz * 9.0 + skyFogTime * 1.3);
  vec3 reflected = mirroredSky(normal, toCamera, worldPosition, surfaceNormal, bakedShade, skyExposure, distanceToCamera, sparkle);
  vec3 lit = shadeSurface(albedoLinear, bakedShade, surfaceNormal, worldPosition, skyExposure, 0.0);
  float mirrorShare = clamp(reflectivity * 1.15, 0.0, 0.97);
  return vec4(mix(lit, reflected, mirrorShare), mix(baseAlpha, 1.0, mirrorShare));
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
