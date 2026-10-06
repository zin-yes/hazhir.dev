// Text and markdown rendering of a worldgen probe result: biome ranking, hottest call-tree paths, breakdown keys.

import { buildProfileReport } from "@/applications/game/profiler/report";
import { renderMarkdownReport } from "@/applications/game/profiler/markdown-report";
import type { BreakdownEntry, ProfileSnapshot } from "@/applications/game/profiler/types";
import { readTerralithDataFileSizes } from "./terralith-data-sizes";
import { renderWorldgenDetailMarkdown } from "./worldgen-detail-report";
import type { BiomeProbeRow, WorldgenProbeResult } from "./worldgen-probe";

const DEFAULT_TOP_COUNT = 15;
const BREAKDOWN_KEYS_PER_DIMENSION = 5;

export interface HotPath {
  root: string;
  path: string;
  calls: number;
  selfMs: number;
  totalMs: number;
  estimated: boolean;
}

export interface BreakdownRow extends BreakdownEntry {
  dimension: string;
}

export function topCallTreePaths(snapshot: ProfileSnapshot, count = DEFAULT_TOP_COUNT): HotPath[] {
  return snapshot.callTrees
    .flatMap((tree) => tree.nodes.map((node) => ({ root: tree.root, ...node })))
    .sort((left, right) => right.selfMs - left.selfMs)
    .slice(0, count);
}

export function topBreakdownRows(
  snapshot: ProfileSnapshot,
  keysPerDimension = BREAKDOWN_KEYS_PER_DIMENSION,
): BreakdownRow[] {
  return snapshot.breakdowns.flatMap((summary) =>
    [...summary.entries]
      .sort((left, right) => right.selfMs - left.selfMs || right.units - left.units)
      .slice(0, keysPerDimension)
      .map((entry) => ({ dimension: summary.dimension, ...entry })),
  );
}

function padCell(value: string, width: number): string {
  return value.padEnd(width);
}

function formatMs(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function biomeRowCells(row: BiomeProbeRow): string[] {
  return [
    `${row.rank}`,
    row.biome,
    `${row.columns}`,
    formatMs(row.totalMs),
    formatMs(row.meanMsPerColumn),
    formatMs(row.p95MsPerColumn),
    formatMs(row.msPerGameChunk),
    Math.round(row.solidBlocksPerSecond).toLocaleString("en-US"),
    row.startupMs === null ? "-" : formatMs(row.startupMs),
  ];
}

const BIOME_TABLE_HEADER = ["rank", "biome", "columns", "total ms", "mean ms/col", "p95 ms", "ms/chunk", "blocks/s", "startup ms"];

export function renderBiomeRankingText(rows: BiomeProbeRow[], limit = rows.length): string {
  const cells = [BIOME_TABLE_HEADER, ...rows.slice(0, limit).map(biomeRowCells)];
  const widths = BIOME_TABLE_HEADER.map((_, columnIndex) => Math.max(...cells.map((line) => line[columnIndex]!.length)));
  return cells.map((line) => line.map((cell, columnIndex) => padCell(cell, widths[columnIndex]!)).join("  ").trimEnd()).join("\n");
}

function markdownTable(header: string[], lines: string[][]): string {
  const render = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [render(header), render(header.map(() => "---")), ...lines.map(render)].join("\n");
}

export function renderProbeSummaryText(result: WorldgenProbeResult, topCount = DEFAULT_TOP_COUNT): string {
  const sections: string[] = [];
  sections.push(`Slowest biomes (mean ms per game column, ${result.cold ? "cold" : "warm"}):`);
  sections.push(renderBiomeRankingText(result.rows, topCount));

  const hotPaths = topCallTreePaths(result.snapshot, topCount);
  sections.push("", `Top ${hotPaths.length} call-tree paths by self time:`);
  for (const hotPath of hotPaths) {
    sections.push(`  ${formatMs(hotPath.selfMs).padStart(9)} ms self  ${`${hotPath.calls}x`.padStart(7)}  ${hotPath.path}`);
  }

  const breakdownRows = topBreakdownRows(result.snapshot);
  sections.push("", "Breakdown keys (top per dimension):");
  for (const breakdownRow of breakdownRows) {
    sections.push(
      `  ${breakdownRow.dimension}  ${breakdownRow.key}  self ${formatMs(breakdownRow.selfMs)} ms  units ${breakdownRow.units}`,
    );
  }
  if (breakdownRows.length === 0) sections.push("  none recorded");
  return sections.join("\n");
}

export function renderProbeMarkdown(result: WorldgenProbeResult): string {
  const lines = [
    "# World generation probe",
    "",
    `- Seed ${result.seed}, ${result.cold ? "cold (fresh world per biome)" : "warm"}, ${result.wholeGameChunks ? "all vertical chunks" : "sea-level chunk only"}`,
    `- ${result.rows.length} biomes probed of ${result.locatedBiomeCount} located; locate ${formatMs(result.locateMs)} ms, warmup ${formatMs(result.warmupMs)} ms, total ${formatMs(result.wallClockMs)} ms`,
    `- Biomes never found in the scan: ${result.missingBiomes.length === 0 ? "none" : result.missingBiomes.join(", ")}`,
  ];
  if (result.unmatchedRequestedBiomes.length > 0) {
    lines.push(`- Requested but not probed: ${result.unmatchedRequestedBiomes.join(", ")}`);
  }
  lines.push("", "## Biomes by mean ms per column", "");
  lines.push(markdownTable(BIOME_TABLE_HEADER, result.rows.map(biomeRowCells)), "");
  lines.push("## Hottest call-tree paths by self time", "");
  lines.push(
    markdownTable(
      ["self ms", "total ms", "calls", "path"],
      topCallTreePaths(result.snapshot).map((hotPath) => [
        formatMs(hotPath.selfMs),
        formatMs(hotPath.totalMs),
        `${hotPath.calls}`,
        `\`${hotPath.path}\``,
      ]),
    ),
    "",
  );
  lines.push(renderMarkdownReport(buildProfileReport(result.snapshot)));
  lines.push("", renderWorldgenDetailMarkdown({ snapshot: result.snapshot, dataFileSizes: readTerralithDataFileSizes() }));
  return lines.join("\n");
}
