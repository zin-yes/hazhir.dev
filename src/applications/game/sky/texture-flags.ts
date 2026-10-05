// Which entries of the block texture array are foliage, as a bit set the terrain fragment shader can test. Foliage lets
// sunlight through, so it glows when the sun is behind it. Plants are foliage by being drawn with the plant material.

const BITS_PER_WORD = 30;
export const FOLIAGE_WORD_COUNT = 12;

export function isFoliageTextureName(textureName: string): boolean {
  return textureName.startsWith("LEAVES");
}

/** `textureNames` are the keys of the texture table in texture-array order. */
export function buildFoliageTextureBits(textureNames: readonly string[]): Int32Array {
  const words = new Int32Array(FOLIAGE_WORD_COUNT);
  textureNames.forEach((textureName, textureIndex) => {
    if (!isFoliageTextureName(textureName)) return;
    const wordIndex = Math.floor(textureIndex / BITS_PER_WORD);
    if (wordIndex >= FOLIAGE_WORD_COUNT) return;
    words[wordIndex]! |= 1 << textureIndex % BITS_PER_WORD;
  });
  return words;
}

export const FOLIAGE_LOOKUP_GLSL = `
uniform int foliageTextureBits[${FOLIAGE_WORD_COUNT}];

bool isFoliageTexture(int textureIndex) {
  int word = foliageTextureBits[textureIndex / ${BITS_PER_WORD}];
  return ((word >> (textureIndex % ${BITS_PER_WORD})) & 1) != 0;
}
`;
