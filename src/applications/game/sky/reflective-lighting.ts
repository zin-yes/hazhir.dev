// Mirror-like surfaces, shared by real chunks and the far terrain. Water is a rippling sheet that mirrors the sky by
// Schlick fresnel, glitters where the sun or moon reflects, and turns opaque as it reflects more. Glass and ice mirror
// the sky off their flat faces the same way, stronger for glass. All of it needs FOG_GLSL (noise and clock) and
// SURFACE_LIGHTING_GLSL before it.

export const REFLECTIVE_LIGHTING_GLSL = `
const int WAVE_COUNT = 6;

float waterFractalNoise(vec2 point) {
  return 0.55 * fogNoise(point) + 0.3 * fogNoise(point * 2.13 + 7.7) + 0.15 * fogNoise(point * 4.31 + 23.1);
}

/**
 * Slope of the water surface. Long swells and short chop travelling at unrelated angles, their positions bent by slow
 * noise. Wind gusts (large patches drifting across the water) switch between glassy calm and rough chop, and the
 * strength of every wave varies from place to place, so the surface never settles into a pattern. The fine waves fade
 * out with distance so they never shimmer.
 */
vec3 waterSurfaceNormal(vec3 worldPosition, float distanceToCamera) {
  const vec2 directions[WAVE_COUNT] = vec2[WAVE_COUNT](
    vec2(0.92, 0.39), vec2(-0.55, 0.83), vec2(0.31, -0.95), vec2(-0.88, -0.47), vec2(0.12, 0.99), vec2(-0.97, 0.24)
  );
  const float frequencies[WAVE_COUNT] = float[WAVE_COUNT](0.11, 0.27, 0.61, 1.37, 2.89, 5.3);
  const float amplitudes[WAVE_COUNT] = float[WAVE_COUNT](0.5, 0.3, 0.16, 0.08, 0.04, 0.02);
  const float speeds[WAVE_COUNT] = float[WAVE_COUNT](0.5, 0.75, 1.1, 1.7, 2.6, 3.6);
  vec2 position = worldPosition.xz;
  vec2 bend = vec2(
    waterFractalNoise(position * 0.03 + skyFogTime * 0.012),
    waterFractalNoise(position * 0.03 + 41.0 - skyFogTime * 0.01)
  ) - 0.5;
  position += bend * 12.0;
  float gust = smoothstep(0.3, 0.7, waterFractalNoise(position * 0.012 + vec2(skyFogTime * 0.02, -skyFogTime * 0.013)));
  float calm = mix(0.35, 1.5, gust);
  vec2 slope = vec2(0.0);
  for (int wave = 0; wave < WAVE_COUNT; wave++) {
    float fade = 1.0 - smoothstep(30.0 * float(WAVE_COUNT - wave), 70.0 * float(WAVE_COUNT - wave) + 40.0, distanceToCamera);
    float choppiness = wave < 2 ? 1.0 : calm;
    float strength = 0.25 + 1.5 * waterFractalNoise(position * (0.05 + 0.02 * float(wave)) + float(wave) * 13.7);
    float phase = dot(directions[wave], position) * frequencies[wave] + skyFogTime * speeds[wave] + float(wave) * 2.4;
    slope += directions[wave] * cos(phase) * amplitudes[wave] * frequencies[wave] * fade * strength * choppiness;
  }
  return normalize(vec3(-slope.x * 0.9, 1.0, -slope.y * 0.9));
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
  float sparkle = 0.45 + 0.8 * fogNoise(worldPosition.xz * 9.0 + skyFogTime * 1.3) + 0.5 * fogNoise(worldPosition.zx * 3.7 - skyFogTime * 0.9);
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
