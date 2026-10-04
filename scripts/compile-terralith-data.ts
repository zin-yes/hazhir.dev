// Compiles Terralith 2.5.1 on vanilla 1.20.6 into the pruned JSON the game's worldgen engine loads at runtime
// (workers cannot read the filesystem). Output is deterministic and committed.
//
//   bun scripts/compile-terralith-data.ts [--pack <terralith dir>] [--vanilla <vanilla data dir>] [--out <dir>]
//
// Defaults come from TERRALITH_PACK_DIR / VANILLA_DATA_DIR / the shared scratch directory.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadTerralithOnVanilla } from "../src/applications/game/worldgen/engine/registry/datapack-loader";
import { compileTerralithData } from "../src/applications/game/worldgen/terralith/compile-data";

const DEFAULT_SCRATCH_DIRECTORY =
  "/private/tmp/claude-501/-Users-hazhir-code-zin-yes-hazhir-dev/72290beb-a2c3-4424-af2e-7aec7d1ca7d0/scratchpad";
const DEFAULT_OUTPUT_DIRECTORY = "src/applications/game/worldgen/terralith/data";

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const packDirectory = resolve(readArgument("pack") ?? process.env.TERRALITH_PACK_DIR ?? join(DEFAULT_SCRATCH_DIRECTORY, "Terralith"));
const vanillaDirectory = resolve(readArgument("vanilla") ?? process.env.VANILLA_DATA_DIR ?? join(DEFAULT_SCRATCH_DIRECTORY, "mc/vanilla/data"));
const outputDirectory = resolve(readArgument("out") ?? DEFAULT_OUTPUT_DIRECTORY);

const loaded = loadTerralithOnVanilla(vanillaDirectory, packDirectory);
const { files, summary } = compileTerralithData(loaded);

mkdirSync(outputDirectory, { recursive: true });
for (const staleFile of readdirSync(outputDirectory)) {
  if (staleFile.endsWith(".json") && !(staleFile in files)) rmSync(join(outputDirectory, staleFile));
}
for (const [fileName, text] of Object.entries(files)) writeFileSync(join(outputDirectory, fileName), text);

const totalBytes = Object.values(summary).reduce((sum, size) => sum + size, 0);
for (const [fileName, size] of Object.entries(summary)) console.log(`${fileName.padEnd(32)} ${(size / 1024).toFixed(0).padStart(6)} KiB`);
console.log(`${"total".padEnd(32)} ${(totalBytes / 1024).toFixed(0).padStart(6)} KiB -> ${outputDirectory}`);
