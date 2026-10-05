// Water shading shared by real chunks and the far terrain: a rippling surface that mirrors the sky at grazing angles
// (Schlick fresnel), glints with the sun or moon, and turns more opaque as it reflects more. Needs FOG_GLSL (for the
// noise and clock) and SURFACE_LIGHTING_GLSL before it.

export const WATER_LIGHTING_GLSL = `
vec3 waterSurfaceNormal(vec3 worldPosition, float distanceToCamera) {
  float rippleStrength = 1.0 - smoothstep(60.0, 220.0, distanceToCamera);
  vec2 drift = vec2(skyFogTime * 0.6, skyFogTime * 0.45);
  float slopeX = fogNoise(worldPosition.xz * 1.7 + drift) + 0.5 * fogNoise(worldPosition.xz * 4.1 - drift.yx) - 0.75;
  float slopeZ = fogNoise(worldPosition.xz * 1.7 + 31.0 - drift.yx) + 0.5 * fogNoise(worldPosition.xz * 4.1 + 17.0 + drift) - 0.75;
  return normalize(vec3(slopeX * 0.09 * rippleStrength, 1.0, slopeZ * 0.09 * rippleStrength));
}

/** Water colour lit by the sky, with the sky mirrored in at grazing angles and a glint of the sun or moon. Alpha rises with the reflection. */
vec4 shadeWater(vec3 albedoLinear, float bakedShade, vec3 surfaceNormal, vec3 worldPosition, float skyExposure, float baseAlpha) {
  float distanceToCamera = length(cameraPosition - worldPosition);
  vec3 normal = surfaceNormal.y > 0.9 ? waterSurfaceNormal(worldPosition, distanceToCamera) : surfaceNormal;
  vec3 toCamera = normalize(cameraPosition - worldPosition);
  float facingCamera = clamp(dot(normal, toCamera), 0.0, 1.0);
  float reflectivity = 0.04 + 0.96 * pow(1.0 - facingCamera, 5.0);
  vec3 mirrored = reflect(-toCamera, normal);
  vec3 reflection = skyColorTowards(vec3(mirrored.x, abs(mirrored.y), mirrored.z));
  float visibility = sunVisibility(worldPosition, surfaceNormal, skyLightDirection, distanceToCamera);
  float glint = pow(max(dot(mirrored, skyLightDirection), 0.0), 220.0) * visibility * skyExposure;
  vec3 lit = shadeSurface(albedoLinear, bakedShade, surfaceNormal, worldPosition, skyExposure, 0.0);
  vec3 reflected = srgbEncode(filmicToneMap((reflection * pow(max(bakedShade, 0.05), 2.2) + skyDirectColor * glint * 6.0) * nightAdjustedExposure()));
  return vec4(mix(lit, reflected, reflectivity * 0.85), mix(baseAlpha, 1.0, reflectivity));
}
`;
