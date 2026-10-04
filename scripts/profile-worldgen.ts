// World generation profiling probe. Usage:
//   bun run profile:worldgen [--seed N] [--columns-per-biome N] [--warmup N] [--biomes plains,taiga] [--max-biomes N]
//     [--all] [--cold] [--sea-level-chunk-only] [--radius BLOCKS] [--step BLOCKS] [--out DIR]
// Writes worldgen-latest.{md,json} plus timestamped copies into --out (default .profiles).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { renderProbeMarkdown, renderProbeSummaryText } from "@/applications/game/worldgen/profile/probe-report";
import { runWorldgenProbe } from "@/applications/game/worldgen/profile/worldgen-probe";

const DEFAULT_SEED = 20240607;
const DEFAULT_MAX_BIOMES = 40;
const DEFAULT_SCAN_STEP_BLOCKS = 128;

const { values: flags } = parseArgs({
  options: {
    seed: { type: "string", default: String(DEFAULT_SEED) },
    "columns-per-biome": { type: "string", default: "1" },
    warmup: { type: "string", default: "1" },
    biomes: { type: "string" },
    "max-biomes": { type: "string", default: String(DEFAULT_MAX_BIOMES) },
    all: { type: "boolean", default: false },
    cold: { type: "boolean", default: false },
    "sea-level-chunk-only": { type: "boolean", default: false },
    radius: { type: "string", default: "8000" },
    step: { type: "string", default: String(DEFAULT_SCAN_STEP_BLOCKS) },
    out: { type: "string", default: ".profiles" },
  },
});

const requestedBiomes = flags.biomes?.split(",").map((name) => name.trim()).filter(Boolean);
console.log(`Locating biomes (radius ${flags.radius}, step ${flags.step})...`);

const result = runWorldgenProbe({
  seed: Number(flags.seed),
  columnsPerBiome: Number(flags["columns-per-biome"]),
  warmupColumns: Number(flags.warmup),
  biomes: requestedBiomes,
  maxBiomes: flags.all || requestedBiomes ? undefined : Number(flags["max-biomes"]),
  wholeGameChunks: !flags["sea-level-chunk-only"],
  cold: flags.cold,
  locator: { radiusBlocks: Number(flags.radius), stepBlocks: Number(flags.step) },
  onProgress(event) {
    if (event.phase === "locate-done") {
      const { located, locateMs } = event;
      console.log(
        `Located ${located.biomes.length} biomes in ${(locateMs / 1000).toFixed(1)}s; never found: ${located.missingBiomes.length}`,
      );
    } else if (event.phase === "warmup-done") {
      console.log(`Warmup ${(event.warmupMs / 1000).toFixed(1)}s`);
    } else {
      const { row } = event;
      console.log(
        `[${event.biomeNumber}/${event.biomeCount}] ${row.biome}: ${row.meanMsPerColumn.toFixed(0)} ms/column over ${row.columns}`,
      );
    }
  },
});

console.log(`\n${renderProbeSummaryText(result)}`);
if (result.unmatchedRequestedBiomes.length > 0) {
  console.log(`\nNot found in the scan: ${result.unmatchedRequestedBiomes.join(", ")}`);
}

const outputDirectory = join(process.cwd(), flags.out!);
mkdirSync(outputDirectory, { recursive: true });
const markdown = renderProbeMarkdown(result);
const json = JSON.stringify({ ...result.snapshot, worldgenProbe: { ...result, snapshot: undefined } }, null, 2);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const stem of ["worldgen-latest", `worldgen-${timestamp}`]) {
  writeFileSync(join(outputDirectory, `${stem}.md`), markdown);
  writeFileSync(join(outputDirectory, `${stem}.json`), json);
}
console.log(`\nWrote ${join(flags.out!, "worldgen-latest.md")} and .json (total ${(result.wallClockMs / 1000).toFixed(1)}s)`);
