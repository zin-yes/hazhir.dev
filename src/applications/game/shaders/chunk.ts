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
  SURFACE_LIGHT_BITS,
  SURFACE_LIGHT_SHIFT,
  SURFACE_OCCLUSION_BITS,
  SURFACE_OCCLUSION_SHIFT,
  SURFACE_TEXTURE_BITS,
  SURFACE_TEXTURE_SHIFT,
  SURFACE_V_SHIFT,
  UV_BITS,
  UV_UNITS_PER_TEXTURE,
} from "../vertex-format";

const mask = (bits: number) => `${(1 << bits) - 1}u`;

// Decodes a packed vertex (see vertex-format.ts) and computes the face shade.
// The shade is constant per face except for ambient occlusion, which is linear
// across a face, so doing the math per vertex matches doing it per fragment.
const VERTEX_DECODING = `
attribute uvec2 packedVertex;

varying vec2 TextureCoordinates;
varying float vShade;
flat out int TextureIndex;

vec3 decodeVoxelPosition(uint positionWord) {
  return vec3(
    float(positionWord & ${mask(POSITION_AXIS_BITS)}),
    float((positionWord >> ${POSITION_Y_SHIFT}u) & ${mask(POSITION_AXIS_BITS)}),
    float((positionWord >> ${POSITION_Z_SHIFT}u) & ${mask(POSITION_AXIS_BITS)})
  );
}

float shadeFor(float lightLevel, float ambientOcclusion) {
  float lightIntensity = pow(0.8, 15.0 - lightLevel);
  float ambientOcclusionFactor = 0.55 + 0.15 * ambientOcclusion;
  return lightIntensity * ambientOcclusionFactor;
}

float decodeLight(uint surfaceWord) {
  return float((surfaceWord >> ${SURFACE_LIGHT_SHIFT}u) & ${mask(SURFACE_LIGHT_BITS)});
}

float decodeAmbientOcclusion(uint surfaceWord) {
  return float((surfaceWord >> ${SURFACE_OCCLUSION_SHIFT}u) & ${mask(SURFACE_OCCLUSION_BITS)});
}

void decodeSurface(uint surfaceWord) {
  TextureCoordinates = vec2(
    float(surfaceWord & ${mask(UV_BITS)}),
    float((surfaceWord >> ${SURFACE_V_SHIFT}u) & ${mask(UV_BITS)})
  ) * ${(1 / UV_UNITS_PER_TEXTURE).toFixed(6)};
  TextureIndex = int((surfaceWord >> ${SURFACE_TEXTURE_SHIFT}u) & ${mask(SURFACE_TEXTURE_BITS)});
}
`;

export const VERTEX_SHADER = `
${VERTEX_DECODING}

void main() {
  uint surfaceWord = packedVertex.y;
  decodeSurface(surfaceWord);
  vShade = shadeFor(decodeLight(surfaceWord), decodeAmbientOcclusion(surfaceWord));

  vec3 localPosition = decodeVoxelPosition(packedVertex.x) * ${(1 / POSITION_UNITS_PER_BLOCK).toFixed(6)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(localPosition, 1.0);
}
`;

/**
 * One draw per plant type per chunk. The template (shared by every plant of the
 * type) holds the voxel faces; each instance supplies the block position, its
 * light and which of its six neighbors are solid, which darkens voxels near them.
 */
export const PLANT_VERTEX_SHADER = `
${VERTEX_DECODING}

attribute uint instanceData;

const float NEIGHBOR_SHADOW_REACH = 6.0;

void main() {
  uint surfaceWord = packedVertex.y;
  decodeSurface(surfaceWord);

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

  vec3 localPosition = blockOrigin + voxelPosition * ${(1 / POSITION_UNITS_PER_BLOCK).toFixed(6)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(localPosition, 1.0);
}
`;

export const FRAGMENT_SHADER = `
varying vec2 TextureCoordinates;
varying float vShade;
flat in int TextureIndex;

uniform sampler2DArray Texture;
uniform int waterTextureIndex;

void main() {
  vec3 lighting = max(vec3(vShade), vec3(0.05));

  vec4 textureColor = texture(Texture, vec3(TextureCoordinates, TextureIndex));

  if (TextureIndex == waterTextureIndex) {
    textureColor.a = 0.7;
  }

  if (textureColor.a < 0.5) discard;

  gl_FragColor = vec4((vec4(lighting, 1.0) * textureColor).rgb, textureColor.a);
}
`;
