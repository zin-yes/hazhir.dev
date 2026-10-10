import {
  PLANT_INSTANCE_COORDINATE_BITS,
  PLANT_INSTANCE_LIGHT_SHIFT,
  PLANT_INSTANCE_MASK_SHIFT,
  PLANT_INSTANCE_Y_SHIFT,
  PLANT_INSTANCE_Z_SHIFT,
  POSITION_AXIS_BITS,
  POSITION_UNITS_PER_BLOCK,
  POSITION_Y_SHIFT,
  POSITION_Z_SHIFT,
  LIGHT_STEPS_PER_LEVEL,
  SURFACE_LIGHT_BITS,
  SURFACE_LIGHT_SHIFT,
  SURFACE_LIGHT_STEP_BITS,
  SURFACE_OCCLUSION_BITS,
  SURFACE_OCCLUSION_SHIFT,
  SURFACE_TEXTURE_BITS,
  SURFACE_TEXTURE_SHIFT,
  SURFACE_V_SHIFT,
  UV_BITS,
  CHUNK_UV_UNITS_PER_BLOCK,
  EDGE_NORMAL_AXIS_SHIFT,
  EDGE_OUTWARD_SHIFT,
  PLANT_UV_UNITS_PER_TEXTURE,
} from "../vertex-format";
import { TEXTURE_FLAG_LOOKUP_GLSL } from "../sky/texture-flags";
import { DAYLIGHT_GLSL, FOG_GLSL } from "../sky/sky-lighting";
import { REFLECTIVE_LIGHTING_GLSL } from "../sky/reflective-lighting";
import { SCREEN_SPACE_WATER_GLSL } from "../sky/screen-space-water";
import { WIND_GLSL } from "../sky/wind";
import { SKY_EXPOSURE_BRIGHT_LEVEL, SKY_EXPOSURE_DARK_LEVEL, SURFACE_LIGHTING_GLSL } from "../sky/surface-lighting";

/**
 * How far the opaque shader pushes a face corner outward, per block of view
 * depth: about a tenth of a pixel at 1000 pixels of screen height, enough to
 * close T-junction cracks between merged quads and too little to see.
 */
export const EDGE_EXPANSION_PER_DEPTH = 0.00015;

const TILE_EDGE_BIAS = "0.0001";
const mask = (bits: number) => `${(1 << bits) - 1}u`;

// Decodes a packed vertex (see vertex-format.ts) and computes the face shade.
// The shade is constant per face except for ambient occlusion, which is linear
// across a face, so doing the math per vertex matches doing it per fragment.
// Texture coordinates leave the vertex shader unwrapped (a merged quad runs from
// 0 to its size in blocks); the fragment shader tiles them.
export const VERTEX_DECODING = `
${DAYLIGHT_GLSL}
attribute uvec2 packedVertex;

varying vec2 TextureCoordinates;
varying float vShade;
varying float vSkyExposure;
varying vec3 vFogWorldPosition;
flat out int TextureIndex;

vec3 decodeVoxelPosition(uint positionWord) {
  return vec3(
    float(positionWord & ${mask(POSITION_AXIS_BITS)}),
    float((positionWord >> ${POSITION_Y_SHIFT}u) & ${mask(POSITION_AXIS_BITS)}),
    float((positionWord >> ${POSITION_Z_SHIFT}u) & ${mask(POSITION_AXIS_BITS)})
  );
}

float shadeFor(float lightLevel, float ambientOcclusion) {
  float lightIntensity = pow(0.8, 15.0 - lightLevel) * daylightScale();
  float ambientOcclusionFactor = 0.55 + 0.15 * ambientOcclusion;
  return lightIntensity * ambientOcclusionFactor;
}

float skyExposureForLightLevel(float lightLevel) {
  return smoothstep(${SKY_EXPOSURE_DARK_LEVEL.toFixed(1)}, ${SKY_EXPOSURE_BRIGHT_LEVEL.toFixed(1)}, lightLevel);
}

float decodeLight(uint surfaceWord) {
  return float((surfaceWord >> ${SURFACE_LIGHT_SHIFT}u) & ${mask(SURFACE_LIGHT_STEP_BITS)}) / ${LIGHT_STEPS_PER_LEVEL}.0;
}

float decodeAmbientOcclusion(uint surfaceWord) {
  return float((surfaceWord >> ${SURFACE_OCCLUSION_SHIFT}u) & ${mask(SURFACE_OCCLUSION_BITS)});
}

void decodeSurface(uint surfaceWord, float textureUnitsPerWholeCoordinate) {
  TextureCoordinates = vec2(
    float(surfaceWord & ${mask(UV_BITS)}),
    float((surfaceWord >> ${SURFACE_V_SHIFT}u) & ${mask(UV_BITS)})
  ) / textureUnitsPerWholeCoordinate;
  TextureIndex = int((surfaceWord >> ${SURFACE_TEXTURE_SHIFT}u) & ${mask(SURFACE_TEXTURE_BITS)});
}
`;

export const VERTEX_SHADER = `
${VERTEX_DECODING}

uniform float edgeExpansion;

void main() {
  uint surfaceWord = packedVertex.y;
  decodeSurface(surfaceWord, ${CHUNK_UV_UNITS_PER_BLOCK}.0);
  float lightLevel = decodeLight(surfaceWord);
  vShade = shadeFor(lightLevel, decodeAmbientOcclusion(surfaceWord));
  vSkyExposure = skyExposureForLightLevel(lightLevel);

  vec3 localPosition = decodeVoxelPosition(packedVertex.x) * ${(1 / POSITION_UNITS_PER_BLOCK).toFixed(6)};
  vec4 viewPosition = modelViewMatrix * vec4(localPosition, 1.0);
  uint normalAxisCode = packedVertex.x >> ${EDGE_NORMAL_AXIS_SHIFT}u;
  if (normalAxisCode != 0u && edgeExpansion > 0.0) {
    int normalAxis = int(normalAxisCode) - 1;
    uint outwardBits = surfaceWord >> ${EDGE_OUTWARD_SHIFT}u;
    vec3 outward = vec3(0.0);
    outward[(normalAxis + 1) % 3] = (outwardBits & 1u) != 0u ? 1.0 : -1.0;
    outward[(normalAxis + 2) % 3] = (outwardBits & 2u) != 0u ? 1.0 : -1.0;
    localPosition += outward * (max(-viewPosition.z, 0.0) * edgeExpansion);
    viewPosition = modelViewMatrix * vec4(localPosition, 1.0);
  }
  vFogWorldPosition = (modelMatrix * vec4(localPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * viewPosition;
}
`;

/**
 * One draw per plant type per chunk. The template (shared by every plant of the
 * type) holds the voxel faces; each instance supplies the block position, its
 * light and which of its six neighbors are solid, which darkens voxels near them.
 */
export const PLANT_VERTEX_SHADER = `
${VERTEX_DECODING}
${TEXTURE_FLAG_LOOKUP_GLSL}
uniform float skyFogTime;
${WIND_GLSL}

attribute uint instanceData;

const float NEIGHBOR_SHADOW_REACH = 6.0;
const uint SOLID_ABOVE_BIT = 4u;
const uint SOLID_BELOW_BIT = 8u;

/**
 * How much of the wind's lean a point of the plant takes, 0..1 and beyond. A plant standing on the ground is pinned
 * at its foot and bends more the higher the point; one hanging from a ceiling is pinned at the top. A plant with
 * nothing solid at either end is the upper half of a tall plant, so its foot moves exactly as much as the top of the
 * half below it and the stem stays whole.
 */
float windBend(uint neighborMask, float heightInBlock) {
  if ((neighborMask & SOLID_BELOW_BIT) != 0u) return heightInBlock * heightInBlock;
  if ((neighborMask & SOLID_ABOVE_BIT) != 0u) return (1.0 - heightInBlock) * (1.0 - heightInBlock);
  return 1.0 + heightInBlock * heightInBlock;
}

void main() {
  uint surfaceWord = packedVertex.y;
  decodeSurface(surfaceWord, ${PLANT_UV_UNITS_PER_TEXTURE}.0);

  vec3 voxelPosition = decodeVoxelPosition(packedVertex.x);
  vec3 blockOrigin = vec3(
    float(instanceData & ${mask(PLANT_INSTANCE_COORDINATE_BITS)}),
    float((instanceData >> ${PLANT_INSTANCE_Y_SHIFT}u) & ${mask(PLANT_INSTANCE_COORDINATE_BITS)}),
    float((instanceData >> ${PLANT_INSTANCE_Z_SHIFT}u) & ${mask(PLANT_INSTANCE_COORDINATE_BITS)})
  );
  float lightLevel = float((instanceData >> ${PLANT_INSTANCE_LIGHT_SHIFT}u) & ${mask(SURFACE_LIGHT_BITS)});
  uint neighborMask = (instanceData >> ${PLANT_INSTANCE_MASK_SHIFT}u) & 63u;

  float shadowStrength = 0.0;
  for (int direction = 0; direction < 6; direction++) {
    if (((neighborMask >> uint(direction)) & 1u) == 0u) continue;
    float coordinate = voxelPosition[direction >> 1];
    float distanceInVoxels = (direction & 1) == 0 ? ${POSITION_UNITS_PER_BLOCK}.0 - coordinate : coordinate;
    float reach = max(0.0, 1.0 - distanceInVoxels / NEIGHBOR_SHADOW_REACH);
    shadowStrength += reach * reach;
  }
  float neighborAmbientOcclusion = 3.0 * (1.0 - min(1.0, shadowStrength));
  float ambientOcclusion = min(decodeAmbientOcclusion(surfaceWord), neighborAmbientOcclusion);
  vShade = shadeFor(lightLevel, ambientOcclusion);
  vSkyExposure = skyExposureForLightLevel(lightLevel);

  vec3 localPosition = blockOrigin + voxelPosition * ${(1 / POSITION_UNITS_PER_BLOCK).toFixed(6)};
  int plantTextureIndex = int((surfaceWord >> ${SURFACE_TEXTURE_SHIFT}u) & ${mask(SURFACE_TEXTURE_BITS)});
  if (!isWindlessTexture(plantTextureIndex)) {
    vec3 blockCenter = (modelMatrix * vec4(blockOrigin + 0.5, 1.0)).xyz;
    vec2 sway = windPlantLean(blockCenter, skyFogTime) * windBend(neighborMask, voxelPosition.y / ${POSITION_UNITS_PER_BLOCK}.0);
    localPosition.xz += sway;
    localPosition.y -= 0.5 * dot(sway, sway);
  }
  vFogWorldPosition = (modelMatrix * vec4(localPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(localPosition, 1.0);
}
`;

/**
 * Tiles the unwrapped coordinates: the texture repeats every whole unit. The
 * tile index is taken just below a boundary so a coordinate that lands on a
 * quad's far edge keeps sampling the last texel instead of wrapping to the
 * first. The gradients come from the unwrapped coordinates, which are
 * continuous across tile boundaries, so mip selection does not jump there.
 */
export const SAMPLE_TILED_TEXTURE_GLSL = `
vec4 sampleTiledTexture(sampler2DArray textureArray, vec2 unwrappedCoordinates, int textureIndex) {
  vec2 tileIndex = max(ceil(unwrappedCoordinates - ${TILE_EDGE_BIAS}) - 1.0, 0.0);
  return textureGrad(
    textureArray,
    vec3(unwrappedCoordinates - tileIndex, textureIndex),
    dFdx(unwrappedCoordinates),
    dFdy(unwrappedCoordinates)
  );
}
`;

export const FRAGMENT_SHADER = `
${FOG_GLSL}
${SURFACE_LIGHTING_GLSL}
${TEXTURE_FLAG_LOOKUP_GLSL}
${SAMPLE_TILED_TEXTURE_GLSL}
${WIND_GLSL}
${REFLECTIVE_LIGHTING_GLSL}
${SCREEN_SPACE_WATER_GLSL}
varying vec2 TextureCoordinates;
varying float vShade;
varying float vSkyExposure;
varying vec3 vFogWorldPosition;
flat in int TextureIndex;

uniform sampler2DArray Texture;
uniform int waterTextureIndex;

void main() {
  vec2 textureCoordinates = TextureCoordinates;
#ifndef IS_PLANT_MATERIAL
  bool isLeaf = isFoliageTexture(TextureIndex);
  if (isLeaf) textureCoordinates += windLeafFlutter(vFogWorldPosition, skyFogTime);
#endif
  vec4 textureColor = sampleTiledTexture(Texture, textureCoordinates, TextureIndex);
  bool isWater = TextureIndex == waterTextureIndex;
  bool isGlass = isGlassTexture(TextureIndex);
  if (!isWater && !isGlass && textureColor.a < 0.5) discard;

  vec3 surfaceNormal = flatNormalAt(vFogWorldPosition);
  vec3 finalColor;
  float alpha = textureColor.a;
  if (isWater) {
    vec4 plainWater = shadeWater(textureColor.rgb, vShade, surfaceNormal, vFogWorldPosition, vSkyExposure, 0.7);
    vec4 water = shadeScreenSpaceWater(textureColor.rgb, vShade, surfaceNormal, vFogWorldPosition, vSkyExposure, 0.7, plainWater);
    finalColor = water.rgb;
    alpha = water.a;
  } else {
#ifdef IS_PLANT_MATERIAL
    float foliage = 1.0;
#else
    float foliage = isLeaf ? 1.0 : 0.0;
#endif
    finalColor = shadeSurface(textureColor.rgb, vShade, surfaceNormal, vFogWorldPosition, vSkyExposure, foliage);
#ifndef IS_PLANT_MATERIAL
    if (isLeaf) finalColor *= windLeafShimmer(vFogWorldPosition, skyFogTime);
#endif
    if (isGlass || isGlossyTexture(TextureIndex)) {
      vec4 mirrored = shadeMirrorSurface(finalColor, textureColor.a, surfaceNormal, vFogWorldPosition, vShade, vSkyExposure, isGlass ? 0.14 : 0.07);
      finalColor = mirrored.rgb;
      alpha = isGlass ? mirrored.a : max(alpha, mirrored.a);
    }
    if (isEmissiveTexture(TextureIndex)) {
      float glow = smoothstep(0.1, 0.4, dot(textureColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
      finalColor = mix(finalColor, srgbEncode(textureColor.rgb * 1.15) * skyEmissiveGain, glow);
    }
  }

  gl_FragColor = vec4(applyFog(finalColor, vFogWorldPosition), alpha);
}
`;
