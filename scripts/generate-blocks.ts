import * as fs from "fs";
import * as path from "path";

const BLOCKS_DIR = path.join(
  process.cwd(),
  "src/applications/game/data/blocks"
);
const OUTPUT_FILE = path.join(process.cwd(), "src/applications/game/blocks.ts");

interface BlockDef {
  id: number;
  name: string;
  texture:
    | string
    | {
        default: string;
        sides?: string;
        top?: string;
        bottom?: string;
        left?: string;
        right?: string;
        front?: string;
        back?: string;
      };
  isTransparent?: boolean;
  isTranslucent?: boolean;
  isCollidable?: boolean;
  isWater?: boolean;
  waterLevel?: number;
  isReplaceable?: boolean;
  model?:
    | "CUBE"
    | "SLAB_BOTTOM"
    | "SLAB_TOP"
    | "X_SHAPE"
    | "FLAT_QUAD"
    | "CROP";
  hitbox?: {
    scale?: [number, number, number];
    offset?: [number, number, number];
  };
  itemTexture?: string;
}

function generateBlocks() {
  const files = fs.readdirSync(BLOCKS_DIR).filter((f) => f.endsWith(".json"));
  const blocks: BlockDef[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(BLOCKS_DIR, file), "utf-8");
    blocks.push(JSON.parse(content));
  }

  blocks.sort((a, b) => a.id - b.id);

  // Collect textures
  const textureMap = new Map<string, string>(); // filename -> key
  const textureKeys: string[] = [];

  // Add INVALID texture first as in original
  textureMap.set("invalid.png", "INVALID");
  textureKeys.push("INVALID");

  blocks.forEach((block) => {
    const addTexture = (filename: string) => {
      if (!textureMap.has(filename)) {
        const key = filename.replace(/\.png$/, "").toUpperCase();
        textureMap.set(filename, key);
        textureKeys.push(key);
      }
    };

    if (typeof block.texture === "string") {
      addTexture(block.texture);
    } else {
      if (block.texture.default) addTexture(block.texture.default);
      if (block.texture.sides) addTexture(block.texture.sides);
      if (block.texture.top) addTexture(block.texture.top);
      if (block.texture.bottom) addTexture(block.texture.bottom);
      if (block.texture.left) addTexture(block.texture.left);
      if (block.texture.right) addTexture(block.texture.right);
      if (block.texture.front) addTexture(block.texture.front);
      if (block.texture.back) addTexture(block.texture.back);
    }

    if (block.itemTexture) {
      addTexture(block.itemTexture);
    }
  });

  // Generate content
  let content = `// This file is auto-generated. Do not edit manually.
// Edit the JSON files in src/applications/game/data/blocks/ instead.

export enum BlockType {
${blocks.map((b) => `  ${b.name} = ${b.id},`).join("\n")}
}

export function isWater(block: BlockType): boolean {
  return (
${blocks
  .filter((b) => b.isWater)
  .map((b) => `    block === BlockType.${b.name}`)
  .join(" ||\n")}
  );
}

export function getWaterLevel(block: BlockType): number {
${blocks
  .filter((b) => b.waterLevel !== undefined)
  .map((b) => `  if (block === BlockType.${b.name}) return ${b.waterLevel};`)
  .join("\n")}
  return 0;
}

export function isReplaceable(block: BlockType): boolean {
  return (
${blocks
  .filter((b) => b.isReplaceable || b.isWater)
  .map((b) => `    block === BlockType.${b.name}`)
  .join(" ||\n")}
  );
}

export function isSlab(block: BlockType): boolean {
  return (
${blocks
  .filter((b) => b.model === "SLAB_BOTTOM" || b.model === "SLAB_TOP")
  .map((b) => `    block === BlockType.${b.name}`)
  .join(" ||\n")}
  );
}

export function isTopSlab(block: BlockType): boolean {
  return (
${blocks
  .filter((b) => b.model === "SLAB_TOP")
  .map((b) => `    block === BlockType.${b.name}`)
  .join(" ||\n")}
  );
}

export function isCrossBlock(block: BlockType): boolean {
  return (
${blocks
  .filter((b) => b.model === "X_SHAPE")
  .map((b) => `    block === BlockType.${b.name}`)
  .join(" ||\n")}
  );
}

export function isFlatQuad(block: BlockType): boolean {
  return (
${blocks
  .filter((b) => b.model === "FLAT_QUAD")
  .map((b) => `    block === BlockType.${b.name}`)
  .join(" ||\n")}
  );
}

export function isCrop(block: BlockType): boolean {
  return (
${blocks
  .filter((b) => b.model === "CROP")
  .map((b) => `    block === BlockType.${b.name}`)
  .join(" ||\n")}
  );
}

export function getHitbox(block: BlockType): { scale: [number, number, number]; offset: [number, number, number] } {
  switch (block) {
${blocks
  .map((b) => {
    let scale = [1.002, 1.002, 1.002];
    let offset = [0, 0, 0];

    if (b.hitbox) {
      if (b.hitbox.scale) scale = b.hitbox.scale;
      if (b.hitbox.offset) offset = b.hitbox.offset;
    } else if (b.model === "SLAB_BOTTOM") {
      scale = [1.002, 0.502, 1.002];
      offset = [0, -0.25, 0];
    } else if (b.model === "SLAB_TOP") {
      scale = [1.002, 0.502, 1.002];
      offset = [0, 0.25, 0];
    }

    // Only generate case if it differs from default cube
    if (
      scale[0] !== 1.002 ||
      scale[1] !== 1.002 ||
      scale[2] !== 1.002 ||
      offset[0] !== 0 ||
      offset[1] !== 0 ||
      offset[2] !== 0
    ) {
      return `    case BlockType.${b.name}: return { scale: [${scale.join(
        ", "
      )}], offset: [${offset.join(", ")}] };`;
    }
    return "";
  })
  .filter((s) => s)
  .join("\n")}
    default: return { scale: [1.002, 1.002, 1.002], offset: [0, 0, 0] };
  }
}

export const Texture = {
${textureKeys
  .map((key) => {
    for (const [filename, k] of textureMap.entries()) {
      if (k === key) return `  ${key}: "${filename}",`;
    }
    return "";
  })
  .join("\n")}
};

export const LOADING_SCREEN_TEXTURES = [
${textureKeys
  .map((key) => {
    for (const [filename, k] of textureMap.entries()) {
      if (k === key && key !== "INVALID") return `  "${filename}",`;
    }
    return "";
  })
  .join("\n")}
];

function getTextureIndexByName(name: string): number {
  const keys = Object.keys(Texture);

  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === name.toUpperCase()) return i;
  }

  return 0;
}

export let BLOCK_TEXTURES: {
  [type: number]: {
    DEFAULT: number;
    SIDES?: number;
    TOP_FACE?: number;
    BOTTOM_FACE?: number;
    LEFT_FACE?: number;
    RIGHT_FACE?: number;
    FRONT_FACE?: number;
    BACK_FACE?: number;
  };
} = {};

${blocks
  .map((b) => {
    let str = `BLOCK_TEXTURES[BlockType.${b.name}] = {\n`;
    if (typeof b.texture === "string") {
      const key = textureMap.get(b.texture);
      str += `  DEFAULT: getTextureIndexByName("${key}"),\n`;
    } else {
      if (b.texture.default)
        str += `  DEFAULT: getTextureIndexByName("${textureMap.get(
          b.texture.default
        )}"),\n`;
      if (b.texture.sides)
        str += `  SIDES: getTextureIndexByName("${textureMap.get(
          b.texture.sides
        )}"),\n`;
      if (b.texture.top)
        str += `  TOP_FACE: getTextureIndexByName("${textureMap.get(
          b.texture.top
        )}"),\n`;
      if (b.texture.bottom)
        str += `  BOTTOM_FACE: getTextureIndexByName("${textureMap.get(
          b.texture.bottom
        )}"),\n`;
      if (b.texture.left)
        str += `  LEFT_FACE: getTextureIndexByName("${textureMap.get(
          b.texture.left
        )}"),\n`;
      if (b.texture.right)
        str += `  RIGHT_FACE: getTextureIndexByName("${textureMap.get(
          b.texture.right
        )}"),\n`;
      if (b.texture.front)
        str += `  FRONT_FACE: getTextureIndexByName("${textureMap.get(
          b.texture.front
        )}"),\n`;
      if (b.texture.back)
        str += `  BACK_FACE: getTextureIndexByName("${textureMap.get(
          b.texture.back
        )}"),\n`;
    }
    str += `};`;
    return str;
  })
  .join("\n\n")}

export const TRANSPARENT_BLOCKS = [
${blocks
  .filter((b) => b.isTransparent)
  .map((b) => `  BlockType.${b.name},`)
  .join("\n")}
];

export const TRANSLUCENT_BLOCKS = [
${blocks
  .filter((b) => b.isTranslucent)
  .map((b) => `  BlockType.${b.name},`)
  .join("\n")}
];

export const NON_COLLIDABLE_BLOCKS = [
${blocks
  .filter((b) => b.isCollidable === false)
  .map((b) => `  BlockType.${b.name},`)
  .join("\n")}
];

export const BLOCK_ITEM_TEXTURES: Record<
  BlockType,
  (typeof Texture)[keyof typeof Texture]
> = {
${blocks
  .map((b) => {
    let texKey = "INVALID";
    if (b.itemTexture) {
      texKey = textureMap.get(b.itemTexture) || "INVALID";
    } else if (typeof b.texture === "string") {
      texKey = textureMap.get(b.texture) || "INVALID";
    } else {
      if (b.texture.sides)
        texKey = textureMap.get(b.texture.sides) || "INVALID";
      else if (b.texture.default)
        texKey = textureMap.get(b.texture.default) || "INVALID";
    }
    return `  [BlockType.${b.name}]: Texture.${texKey},`;
  })
  .join("\n")}
};
`;

  fs.writeFileSync(OUTPUT_FILE, content);
  console.log(`Generated ${OUTPUT_FILE}`);
}

generateBlocks();
