// Fragment lighting shared by real chunks and the far terrain. A face gets sky light by how far it faces up, plus the
// sun (or moon) by its angle to the light, cut by the cascaded shadow map and by the baked light level underground.
// The baked per-vertex shade (light falloff, ambient occlusion, night dimming) still multiplies everything, so caves and
// corners keep their old look. The result goes through a filmic curve to display colour.

import { SHADOW_GLSL } from "../shadows/shadow-glsl";
import { LIGHTING_GLSL } from "./sky-lighting";

/** Scales the summed light before tone mapping so a sunlit face lands near its old flat brightness. */
const LIGHT_EXPOSURE = 0.62;
/** Baked light levels (0-15) between which the sun fades in; below it nothing direct reaches (caves under unloaded ground). */
export const SKY_EXPOSURE_DARK_LEVEL = 5;
export const SKY_EXPOSURE_BRIGHT_LEVEL = 10;
/** Share of the sun's strength a leaf passes through to the side facing away from it. */
const FOLIAGE_TRANSMISSION = 0.55;

/** Night keeps roughly the old brightness: the filmic curve and linear light would otherwise crush it to black. */
const NIGHT_EXPOSURE_BOOST = 3.5;

export const SURFACE_LIGHTING_GLSL = `
uniform float skyDaylight;
${LIGHTING_GLSL}
${SHADOW_GLSL}

vec3 flatNormalAt(vec3 worldPosition) {
  return normalize(cross(dFdx(worldPosition), dFdy(worldPosition)));
}

float nightAdjustedExposure() {
  return ${LIGHT_EXPOSURE.toFixed(2)} * mix(${NIGHT_EXPOSURE_BOOST.toFixed(1)}, 1.0, skyDaylight);
}

/**
 * foliage is 0 for solid surfaces and 1 for leaves and plants: their normal leans upwards (they catch sky light from
 * every side) and sunlight shines through them from behind.
 */
vec3 shadeSurface(
  vec3 albedoLinear,
  float bakedShade,
  vec3 surfaceNormal,
  vec3 worldPosition,
  float skyExposure,
  float foliage
) {
  vec3 viewToCamera = cameraPosition - worldPosition;
  float distanceToCamera = length(viewToCamera);
  vec3 normal = normalize(mix(surfaceNormal, vec3(0.0, 1.0, 0.0), foliage * 0.6));
  float facing = dot(normal, skyLightDirection);
  vec3 sunLight = vec3(0.0);
  if (skyExposure > 0.0 && (facing > 0.0 || foliage > 0.0)) {
    float frontVisibility = facing > 0.0 ? sunVisibility(worldPosition, surfaceNormal, skyLightDirection, distanceToCamera) : 0.0;
    sunLight = skyDirectColor * max(facing, 0.0) * frontVisibility;
    if (foliage > 0.0) {
      float behindVisibility = sunVisibility(worldPosition, -surfaceNormal, skyLightDirection, distanceToCamera);
      float facingAway = clamp(-dot(surfaceNormal, skyLightDirection) * 0.5 + 0.5, 0.0, 1.0);
      sunLight += skyDirectColor * albedoLinear * ${FOLIAGE_TRANSMISSION.toFixed(2)} * facingAway * behindVisibility * foliage * 2.0;
    }
    sunLight *= skyExposure;
  }
  float baked = pow(max(bakedShade, 0.05), 2.2);
  vec3 light = hemisphereLight(normal) + sunLight;
  return srgbEncode(filmicToneMap(albedoLinear * baked * light * nightAdjustedExposure()));
}
`;
