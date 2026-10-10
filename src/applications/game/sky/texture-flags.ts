// Which entries of the block texture array have a special surface, as bit sets the terrain fragment shader can test.
// Foliage lets sunlight through and sways in the wind, emissive textures give off their own light, glass mirrors the sky
// strongly and glossy ones (ice, obsidian, amethyst) mirror it softly. Windless plants are stiff or float on water, so
// the wind never bends them. Plants are foliage by being drawn with the plant material.

import { profiler } from "../profiler";

const BITS_PER_WORD = 30;
export const TEXTURE_FLAG_WORD_COUNT = 12;

export type TextureFlag = "foliage" | "emissive" | "glass" | "glossy" | "windless";

export const TEXTURE_FLAGS: readonly TextureFlag[] = ["foliage", "emissive", "glass", "glossy", "windless"];

const EMISSIVE_TEXTURE_NAMES = new Set(["GLOWSTONE", "LAVA", "MAGMA", "TORCH"]);
const GLASS_TEXTURE_NAMES = new Set(["GLASS", "DECORATIVE_GLASS"]);
const GLOSSY_TEXTURE_NAMES = new Set(["ICE", "PACKED_ICE", "BLUE_ICE", "OBSIDIAN", "AMETHYST_BLOCK"]);
const WINDLESS_TEXTURE_NAMES = new Set([
  "TORCH",
  "COBWEB",
  "POINTED_DRIPSTONE_UP",
  "POINTED_DRIPSTONE_DOWN",
  "BROWN_MUSHROOM",
  "RED_MUSHROOM",
  "DEAD_BUSH",
  "LILY_PAD",
]);

const FLAG_TESTS: Record<TextureFlag, (textureName: string) => boolean> = {
  foliage: (textureName) => textureName.startsWith("LEAVES"),
  emissive: (textureName) => EMISSIVE_TEXTURE_NAMES.has(textureName),
  glass: (textureName) => GLASS_TEXTURE_NAMES.has(textureName),
  glossy: (textureName) => GLOSSY_TEXTURE_NAMES.has(textureName),
  windless: (textureName) => WINDLESS_TEXTURE_NAMES.has(textureName),
};

/** `textureNames` are the keys of the texture table in texture-array order. */
export function buildTextureFlagBits(textureNames: readonly string[], flag: TextureFlag): Int32Array {
  const words = new Int32Array(TEXTURE_FLAG_WORD_COUNT);
  textureNames.forEach((textureName, textureIndex) => {
    if (!FLAG_TESTS[flag](textureName)) return;
    const wordIndex = Math.floor(textureIndex / BITS_PER_WORD);
    if (wordIndex >= TEXTURE_FLAG_WORD_COUNT) return;
    words[wordIndex]! |= 1 << textureIndex % BITS_PER_WORD;
  });
  return words;
}

export function textureFlagUniformName(flag: TextureFlag): string {
  return `${flag}TextureBits`;
}

/** The uniforms for every flag, keyed as the shader declares them. */
export function buildTextureFlagUniforms(textureNames: readonly string[]): Record<string, { value: Int32Array }> {
  const scopeToken = profiler.begin("main.sky.textureFlags.build");
  try {
    profiler.addCounter("game.sky.textureFlags.texturesScanned", textureNames.length);
    return Object.fromEntries(
      TEXTURE_FLAGS.map((flag) => [textureFlagUniformName(flag), { value: buildTextureFlagBits(textureNames, flag) }]),
    );
  } finally {
    profiler.end(scopeToken);
  }
}

export const TEXTURE_FLAG_LOOKUP_GLSL = TEXTURE_FLAGS.map(
  (flag) => `
uniform int ${textureFlagUniformName(flag)}[${TEXTURE_FLAG_WORD_COUNT}];

bool is${flag[0]!.toUpperCase()}${flag.slice(1)}Texture(int textureIndex) {
  int word = ${textureFlagUniformName(flag)}[textureIndex / ${BITS_PER_WORD}];
  return ((word >> (textureIndex % ${BITS_PER_WORD})) & 1) != 0;
}
`,
).join("");
