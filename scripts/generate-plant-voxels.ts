import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

const BLOCKS_DIRECTORY = path.join(process.cwd(), "src/applications/game/data/blocks");
const TEXTURES_DIRECTORY = path.join(process.cwd(), "public/game");
const OUTPUT_FILE = path.join(
  process.cwd(),
  "src/applications/game/data/plant-pixel-masks.ts"
);
const PLANT_MODELS = ["X_SHAPE", "FLAT_QUAD", "CROP"];
const OPAQUE_ALPHA_THRESHOLD = 128;

async function readOpaqueRows(textureFileName: string): Promise<string[]> {
  const { data, info } = await sharp(path.join(TEXTURES_DIRECTORY, textureFileName))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rows: string[] = [];
  for (let row = 0; row < info.height; row++) {
    let rowCharacters = "";
    for (let column = 0; column < info.width; column++) {
      const alpha = data[(row * info.width + column) * 4 + 3];
      rowCharacters += alpha >= OPAQUE_ALPHA_THRESHOLD ? "#" : ".";
    }
    rows.push(rowCharacters);
  }
  return rows;
}

async function generatePlantPixelMasks() {
  const textureFileNames = new Set<string>();
  for (const file of fs.readdirSync(BLOCKS_DIRECTORY).filter((name) => name.endsWith(".json"))) {
    const block = JSON.parse(fs.readFileSync(path.join(BLOCKS_DIRECTORY, file), "utf-8"));
    if (PLANT_MODELS.includes(block.model) && typeof block.texture === "string") {
      textureFileNames.add(block.texture);
    }
  }

  const entries: string[] = [];
  for (const textureFileName of [...textureFileNames].sort()) {
    const rows = await readOpaqueRows(textureFileName);
    entries.push(
      `  "${textureFileName}": [\n${rows.map((row) => `    "${row}",`).join("\n")}\n  ],`
    );
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    `// This file is auto-generated. Do not edit manually.
// Run \`bun run generate:plant-voxels\` after changing a plant texture.
// "#" marks an opaque pixel, which becomes one voxel in the chunk mesh.

export const PLANT_PIXEL_MASKS: Record<string, string[]> = {
${entries.join("\n")}
};
`
  );
  console.log(`Wrote ${textureFileNames.size} plant masks to ${OUTPUT_FILE}`);
}

generatePlantPixelMasks();
