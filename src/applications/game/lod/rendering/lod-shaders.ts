// LOD tile shaders. Lighting matches the main chunk shader (pow(0.8, 15 - sky light) * (0.55 + 0.15 * ao), applied to
// the output-encoded texture colour); the vertex colour is the texture's average, so a far tile reads like the main
// renderer's mipmapped faces. On top: the real-chunk coverage discard, a screen-door dither for level cross-fades and
// for dissolving into the sky at the far edge, and atmospheric fog towards the sky colour behind each fragment (a cube
// map of the adopted sky) or a fixed horizon colour.

import { DAYLIGHT_GLSL, FOG_GLSL } from "../../sky/sky-lighting";
import { COVERAGE_NORMAL_NUDGE_BLOCKS } from "../coverage/real-chunk-coverage";
import { BLOCK_RENDER_OFFSET, CHUNK_SIZE_BLOCKS } from "../core/lod-constants";
import {
  FACE_BITS,
  FACE_SHIFT,
  LIGHT_BITS,
  LIGHT_SHIFT,
  OCCLUSION_BITS,
  OCCLUSION_SHIFT,
  POSITION_BITS,
  Y_BIAS,
  Y_BITS,
  Y_SHIFT,
  Z_SHIFT,
} from "../meshing/lod-vertex-format";

const mask = (bits: number) => `${(1 << bits) - 1}u`;

export const LOD_VERTEX_SHADER = `
${DAYLIGHT_GLSL}
attribute uvec2 packedVertex;

out vec3 vWorldPosition;
out vec3 vColor;
out float vShade;
flat out vec2 vNormalXZ;

vec3 srgbToLinear(vec3 color) {
  return mix(color / 12.92, pow((color + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), color));
}

void main() {
  uint positionWord = packedVertex.x;
  uint colorWord = packedVertex.y;
  vec3 localPosition = vec3(
    float(positionWord & ${mask(POSITION_BITS)}),
    float((positionWord >> ${Y_SHIFT}u) & ${mask(Y_BITS)}) - ${Y_BIAS}.0,
    float((positionWord >> ${Z_SHIFT}u) & ${mask(POSITION_BITS)})
  );
  uint face = (positionWord >> ${FACE_SHIFT}u) & ${mask(FACE_BITS)};
  float occlusion = float((positionWord >> ${OCCLUSION_SHIFT}u) & ${mask(OCCLUSION_BITS)});
  float light = float((positionWord >> ${LIGHT_SHIFT}u) & ${mask(LIGHT_BITS)});
  vShade = pow(0.8, 15.0 - light) * daylightScale() * (0.55 + 0.15 * occlusion);
  vColor = srgbToLinear(vec3(
    float((colorWord >> 16u) & 255u),
    float((colorWord >> 8u) & 255u),
    float(colorWord & 255u)
  ) / 255.0);
  vNormalXZ = face == 1u ? vec2(1.0, 0.0) : face == 2u ? vec2(-1.0, 0.0) : face == 3u ? vec2(0.0, 1.0) : face == 4u ? vec2(0.0, -1.0) : vec2(0.0);
  vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const LOD_FRAGMENT_SHADER = `
${FOG_GLSL}
in vec3 vWorldPosition;
in vec3 vColor;
in float vShade;
flat in vec2 vNormalXZ;

uniform sampler2D coverageTexture;
uniform vec2 coverageCenterChunk;
uniform float coverageSize;
uniform float tileFade;
uniform vec3 hazeColor;
uniform samplerCube hazeCube;
uniform float useHazeCube;
uniform float hazeStart;
uniform float hazeEnd;
uniform float dissolveStart;
uniform float dissolveEnd;
uniform float surfaceAlpha;

float orderedDither(vec2 fragmentCoordinate) {
  ivec2 cell = ivec2(mod(fragmentCoordinate, 4.0));
  int index = cell.x + cell.y * 4;
  int thresholds[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(thresholds[index]) + 0.5) / 16.0;
}

void main() {
  vec2 nudged = vWorldPosition.xz + ${BLOCK_RENDER_OFFSET.toFixed(3)} - vNormalXZ * ${COVERAGE_NORMAL_NUDGE_BLOCKS.toFixed(3)};
  vec2 chunk = floor(nudged / ${CHUNK_SIZE_BLOCKS.toFixed(1)});
  vec2 offsetFromCenter = abs(chunk - coverageCenterChunk);
  if (max(offsetFromCenter.x, offsetFromCenter.y) < coverageSize * 0.5) {
    vec2 texel = mod(chunk, coverageSize);
    if (texture(coverageTexture, (texel + 0.5) / coverageSize).r > 0.5) discard;
  }

  float distanceToCamera = length(vWorldPosition - cameraPosition);
  float dither = orderedDither(gl_FragCoord.xy);
  float farVisibility = 1.0 - smoothstep(dissolveStart, dissolveEnd, distanceToCamera);
  if (tileFade >= 0.0) {
    if (dither >= min(tileFade, farVisibility)) discard;
  } else {
    if (dither < -tileFade - 1.0 || dither >= farVisibility) discard;
  }

  vec3 lighting = max(vec3(vShade), vec3(0.05));
  vec3 displayColor = linearToOutputTexel(vec4(vColor, 1.0)).rgb * lighting;
  float hazeAmount = smoothstep(hazeStart, hazeEnd, distanceToCamera);
  vec3 skyBehind = useHazeCube > 0.5
    ? linearToOutputTexel(vec4(texture(hazeCube, (vWorldPosition - cameraPosition) / distanceToCamera).rgb, 1.0)).rgb
    : hazeColor;
  gl_FragColor = vec4(applyFog(mix(displayColor, skyBehind, hazeAmount), vWorldPosition), surfaceAlpha);
}
`;
