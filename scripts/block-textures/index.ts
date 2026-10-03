// Entry point: `bun scripts/block-textures/index.ts [namePrefix...]` regenerates the block textures into public/game.

import * as path from "path";
import type { TextureDefinition } from "./texture";
import { soilTextures } from "./soil";
import { stoneTextures } from "./stone";
import { woodTextures } from "./wood";
import { foliageTextures } from "./foliage";
import { plantTextures } from "./plants";
import { coralTextures } from "./coral";
import { cactusTextures } from "./cactus";

const OUTPUT_DIRECTORY = path.join(process.cwd(), "public/game");

async function generateBlockTextures(): Promise<void> {
  const nameFilters = process.argv.slice(2);
  const definitions: TextureDefinition[] = [
    ...(await soilTextures()),
    ...(await stoneTextures()),
    ...(await woodTextures()),
    ...(await foliageTextures()),
    ...(await plantTextures()),
    ...(await coralTextures()),
    ...(await cactusTextures()),
  ];
  const selected = definitions.filter(
    (definition) => nameFilters.length === 0 || nameFilters.some((filter) => definition.fileName.startsWith(filter))
  );
  for (const definition of selected) {
    const texture = await definition.draw();
    await texture.savePng(path.join(OUTPUT_DIRECTORY, definition.fileName));
  }
  console.log(`Wrote ${selected.length} block textures to ${OUTPUT_DIRECTORY}`);
}

await generateBlockTextures();
