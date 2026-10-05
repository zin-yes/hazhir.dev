// Receiver side of the cascaded sun shadows: the uniforms every terrain material shares, and the GLSL that turns a
// world position into 0 (fully shadowed) .. 1 (fully lit). The cascade is picked by distance from the camera; the last
// one fades out so the shadow distance has no visible edge. Positions are pushed off the surface along the normal by a
// few texels, which removes self-shadow acne without a large depth bias that would detach shadows from their casters.

import * as THREE from "three";

export const MAX_CASCADES = 3;
/** Last fraction of the shadow distance over which shadows fade out. */
export const FADE_FRACTION = 0.2;
const FILTER_RADIUS_TEXELS = 0.75;
const NORMAL_OFFSET_TEXELS = 1.6;
const LIGHT_OFFSET_TEXELS = 0.8;

export const shadowUniforms = {
  shadowMap0: { value: null as THREE.Texture | null },
  shadowMap1: { value: null as THREE.Texture | null },
  shadowMap2: { value: null as THREE.Texture | null },
  shadowMatrices: { value: Array.from({ length: MAX_CASCADES }, () => new THREE.Matrix4()) },
  /** Camera distance where each cascade ends; unused cascades repeat the last end. */
  shadowCascadeEnds: { value: new THREE.Vector3(1, 1, 1) },
  shadowTexelWorldSizes: { value: new THREE.Vector3(1, 1, 1) },
  /** 0 turns shadows off. */
  shadowCascadeCount: { value: 0 },
  /** Camera distance where the fade out starts. */
  shadowFadeStart: { value: 1 },
  /** One over the shadow map width, for the softening taps. */
  shadowMapTexelSize: { value: 1 / 1024 },
};

export const SHADOW_GLSL = `
uniform sampler2DShadow shadowMap0;
uniform sampler2DShadow shadowMap1;
uniform sampler2DShadow shadowMap2;
uniform mat4 shadowMatrices[${MAX_CASCADES}];
uniform vec3 shadowCascadeEnds;
uniform vec3 shadowTexelWorldSizes;
uniform int shadowCascadeCount;
uniform float shadowFadeStart;
uniform float shadowMapTexelSize;

float sampleShadowCascade(int cascade, vec3 coordinate) {
  if (cascade == 0) return textureLod(shadowMap0, coordinate, 0.0);
  if (cascade == 1) return textureLod(shadowMap1, coordinate, 0.0);
  return textureLod(shadowMap2, coordinate, 0.0);
}

/** 1 when the position is lit by the light, 0 when something blocks it. */
float sunVisibility(vec3 worldPosition, vec3 surfaceNormal, vec3 towardsLight, float distanceToCamera) {
  if (shadowCascadeCount == 0 || distanceToCamera >= shadowCascadeEnds.z) return 1.0;
  int cascade = distanceToCamera < shadowCascadeEnds.x ? 0 : distanceToCamera < shadowCascadeEnds.y ? 1 : 2;
  float texelWorldSize = cascade == 0 ? shadowTexelWorldSizes.x : cascade == 1 ? shadowTexelWorldSizes.y : shadowTexelWorldSizes.z;
  float facing = clamp(dot(surfaceNormal, towardsLight), 0.0, 1.0);
  vec3 offsetPosition = worldPosition
    + surfaceNormal * texelWorldSize * ${NORMAL_OFFSET_TEXELS.toFixed(2)} * (1.0 - facing * 0.5)
    + towardsLight * texelWorldSize * ${LIGHT_OFFSET_TEXELS.toFixed(2)};
  vec4 projected = shadowMatrices[cascade] * vec4(offsetPosition, 1.0);
  vec3 coordinate = projected.xyz;
  if (coordinate.x < 0.0 || coordinate.x > 1.0 || coordinate.y < 0.0 || coordinate.y > 1.0 || coordinate.z > 1.0) return 1.0;

  vec2 spread = vec2(shadowMapTexelSize * ${FILTER_RADIUS_TEXELS.toFixed(2)});
  float visibility = sampleShadowCascade(cascade, coordinate);
  visibility += sampleShadowCascade(cascade, vec3(coordinate.xy + vec2(spread.x, spread.y * 0.5), coordinate.z));
  visibility += sampleShadowCascade(cascade, vec3(coordinate.xy - vec2(spread.x, spread.y * 0.5), coordinate.z));
  visibility *= ${(1 / 3).toFixed(6)};

  float fade = smoothstep(shadowFadeStart, shadowCascadeEnds.z, distanceToCamera);
  return mix(visibility, 1.0, fade);
}
`;
