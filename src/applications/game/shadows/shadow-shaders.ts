// Depth-only shaders for the shadow map: the chunk vertex decoding with the face corners pushed out by a fraction of a
// shadow texel (so T-junction cracks between merged quads cannot leak light), and an alpha test so leaves cast the
// dappled shadow of their cut-out texture.

import {
  CHUNK_UV_UNITS_PER_BLOCK,
  EDGE_NORMAL_AXIS_SHIFT,
  EDGE_OUTWARD_SHIFT,
  POSITION_UNITS_PER_BLOCK,
} from "../vertex-format";
import { SAMPLE_TILED_TEXTURE_GLSL, VERTEX_DECODING } from "../shaders/chunk";

export const SHADOW_DEPTH_VERTEX_SHADER = `
${VERTEX_DECODING}

uniform float edgeExpansionBlocks;

void main() {
  uint surfaceWord = packedVertex.y;
  decodeSurface(surfaceWord, ${CHUNK_UV_UNITS_PER_BLOCK}.0);

  vec3 localPosition = decodeVoxelPosition(packedVertex.x) * ${(1 / POSITION_UNITS_PER_BLOCK).toFixed(6)};
  uint normalAxisCode = packedVertex.x >> ${EDGE_NORMAL_AXIS_SHIFT}u;
  if (normalAxisCode != 0u) {
    int normalAxis = int(normalAxisCode) - 1;
    uint outwardBits = surfaceWord >> ${EDGE_OUTWARD_SHIFT}u;
    vec3 outward = vec3(0.0);
    outward[(normalAxis + 1) % 3] = (outwardBits & 1u) != 0u ? 1.0 : -1.0;
    outward[(normalAxis + 2) % 3] = (outwardBits & 2u) != 0u ? 1.0 : -1.0;
    localPosition += outward * edgeExpansionBlocks;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(localPosition, 1.0);
}
`;

export const SHADOW_DEPTH_FRAGMENT_SHADER = `
${SAMPLE_TILED_TEXTURE_GLSL}
varying vec2 TextureCoordinates;
flat in int TextureIndex;

uniform sampler2DArray Texture;

void main() {
  if (sampleTiledTexture(Texture, TextureCoordinates, TextureIndex).a < 0.5) discard;
}
`;
