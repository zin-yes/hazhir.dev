// Markdown sections for the worldgen probe that turn the raw worker counters and keyed units into the numbers a
// reader wants: cold start costs, cache hit rates, modifier pass rates, feature outcomes with rejection reasons,
// and every counter normalised per game column. Pure functions over a profile snapshot.

import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import { markdownHeading, markdownTable } from "@/applications/game/profiler/markdown-table";
import type { BreakdownEntry, ProfileSnapshot } from "@/applications/game/profiler/types";

export const WORLDGEN_COUNTER_PREFIX = "work.generation.generateChunk.";
const WORLDGEN_CALL_TREE_ROOT = "generation.generateChunk";
const GAME_COLUMN_COUNTER = "gameColumnsConverted";
const MICROSECONDS_PER_MILLISECOND = 1000;
const TOP_CHAIN_ROWS = 30;
const TOP_REASONS_PER_TYPE = 3;

export type CounterTotals = ReadonlyMap<string, number>;

/** Worldgen worker counters by their short name (the pool and method prefix stripped). */
export function worldgenCounterTotals(snapshot: ProfileSnapshot): CounterTotals {
  const totals = new Map<string, number>();
  for (const counter of snapshot.counters) {
    if (counter.name.startsWith(WORLDGEN_COUNTER_PREFIX)) totals.set(counter.name.slice(WORLDGEN_COUNTER_PREFIX.length), counter.total);
  }
  return totals;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value >= 100 ? Math.round(value).toLocaleString("en-US") : value >= 1 ? value.toFixed(1) : value.toFixed(3);
}

function formatPercent(part: number, whole: number): string {
  return whole === 0 ? "-" : `${((part / whole) * 100).toFixed(1)}%`;
}

export interface ColdStartRow {
  label: string;
  calls: number;
  totalMs: number;
  units: number;
}

const COLD_START_COUNTER_PATTERN = /^coldStart\.(.+?)(\.deferred)?\.(calls|units|microseconds)$/;

/**
 * One-off setup work (code generation, data decoding, world construction). Events recorded before the profile began
 * arrive as `.deferred.*` counters; events inside the profile are call tree sections named `coldStart.<label>`.
 */
export function coldStartRows(snapshot: ProfileSnapshot, totals: CounterTotals): ColdStartRow[] {
  const rowsByLabel = new Map<string, ColdStartRow>();
  const rowOf = (label: string): ColdStartRow => {
    let row = rowsByLabel.get(label);
    if (row === undefined) {
      row = { label, calls: 0, totalMs: 0, units: 0 };
      rowsByLabel.set(label, row);
    }
    return row;
  };
  for (const [name, total] of totals) {
    const match = COLD_START_COUNTER_PATTERN.exec(name);
    if (match === null) continue;
    const row = rowOf(match[1]!);
    if (match[3] === "calls") row.calls += total;
    else if (match[3] === "units") row.units += total;
    else row.totalMs += total / MICROSECONDS_PER_MILLISECOND;
  }
  const tree = snapshot.callTrees.find((candidate) => candidate.root === WORLDGEN_CALL_TREE_ROOT);
  const sectionPrefix = "coldStart.";
  for (const node of tree?.nodes ?? []) {
    const leafName = node.path.slice(node.path.lastIndexOf(">") + 1);
    if (!leafName.startsWith(sectionPrefix)) continue;
    rowOf(leafName.slice(sectionPrefix.length)).totalMs += node.totalMs;
  }
  return [...rowsByLabel.values()].sort((left, right) => right.totalMs - left.totalMs || right.units - left.units);
}

export interface RateRow {
  name: string;
  hits: number;
  misses: number;
}

/** Hit and miss counters that describe the same cache; the miss side is whatever work a miss costs. */
const CACHE_COUNTER_PAIRS: readonly (readonly [name: string, hits: string, misses: string])[] = [
  ["base column cache", "baseColumnCacheHits", "baseColumnCacheMisses"],
  ["decorated column cache", "decoratedColumnCacheHits", "decoratedColumnCacheMisses"],
  ["game column cache", "gameColumnCacheHits", "gameColumnCacheMisses"],
  ["decoration origin cache", "decoration.originCacheHits", "decoration.originCacheMisses"],
  ["region column loads", "region.columnCacheHits", "region.columnLoads"],
  ["region base heightmaps", "region.baseHeightmapCacheHits", "region.baseHeightmapPrimes"],
  ["biome grids", "biomeGridCacheHits", "biomeGridCacheMisses"],
  ["carver biome points", "carverBiomeCacheHits", "carverBiomeCacheMisses"],
  ["carver source chunks", "carver.sourceChunkCacheHits", "carver.sourceChunkCacheMisses"],
  ["preliminary surface level", "preliminarySurfaceCacheHits", "preliminarySurfaceCacheMisses"],
  ["surface preliminary level", "surfacePreliminaryLevelCacheHits", "surfacePreliminaryLevelCacheMisses"],
  ["aquifer locations", "aquiferLocationCacheHits", "aquiferLocationCacheMisses"],
  ["aquifer fluid status", "aquiferStatusCacheHits", "aquiferStatusCacheMisses"],
  ["corner sampler lookups", "cornerSampler.samplerCacheHits", "cornerSampler.samplersCreated"],
  ["biome manager last cube", "biomeManager.lastCubeHits", "biomeManager.cubeCacheFills"],
  ["biome manager cube cache", "biomeManager.cubeCacheHits", "biomeManager.cubeCacheFills"],
  ["biome manager fiddles", "biomeManager.fiddleCacheHits", "biomeManager.fiddleCacheFills"],
  ["height sampler corner positions", "heightSampler.cornerPositionHits", "heightSampler.cornerPositionsCreated"],
  ["height sampler corner columns", "heightSampler.cornerColumnsReused", "heightSampler.cornerColumnsExtended"],
  ["block state info", "blockState.infoCacheHits", "blockState.infoClassifications"],
  ["block state palette info", "blockState.paletteInfoHits", "blockState.paletteInfoMisses"],
  ["block state normalize", "blockState.normalizeCacheHits", "blockState.normalizeCacheMisses"],
  ["block state properties", "blockState.propertiesCacheHits", "blockState.propertiesCacheMisses"],
  ["game block map", "blockMap.cacheHits", "blockMap.resolutions"],
  ["lenient game block map", "lenientBlockMap.cacheHits", "lenientBlockMap.lookups"],
  ["placed feature parse", "featureResolver.placedCacheHits", "featureResolver.placedParsed"],
  ["configured feature parse", "featureResolver.configuredCacheHits", "featureResolver.configuredParsed"],
  ["surface biome stamp", "surfaceContext.biomeStampHits", "surfaceContext.biomeLookups"],
  ["surface secondary noise stamp", "surfaceContext.secondaryStampHits", "surfaceContext.secondaryComputed"],
  ["surface min level stamp", "surfaceContext.minSurfaceLevelStampHits", "surfaceContext.minSurfaceLevelComputed"],
];

const NAMED_CACHE_PATTERN = /^cache\.(.+)\.(hits|misses)$/;
const DENSITY_CACHE_PATTERN = /^densityCache(Hits|Misses)\.(.+)$/;

/** Every cache with both sides recorded: the explicit pairs above, the named bounded caches and the density caches. */
export function cacheRateRows(totals: CounterTotals): RateRow[] {
  const rows: RateRow[] = [];
  for (const [name, hitsName, missesName] of CACHE_COUNTER_PAIRS) {
    const hits = totals.get(hitsName);
    const misses = totals.get(missesName);
    if (hits === undefined && misses === undefined) continue;
    rows.push({ name, hits: hits ?? 0, misses: misses ?? 0 });
  }
  const boundedCaches = new Map<string, RateRow>();
  const densityCaches = new Map<string, RateRow>();
  for (const [name, total] of totals) {
    const bounded = NAMED_CACHE_PATTERN.exec(name);
    if (bounded !== null) {
      const row = boundedCaches.get(bounded[1]!) ?? { name: `bounded cache ${bounded[1]}`, hits: 0, misses: 0 };
      if (bounded[2] === "hits") row.hits += total;
      else row.misses += total;
      boundedCaches.set(bounded[1]!, row);
      continue;
    }
    const density = DENSITY_CACHE_PATTERN.exec(name);
    if (density !== null) {
      const row = densityCaches.get(density[2]!) ?? { name: `density ${density[2]}`, hits: 0, misses: 0 };
      if (density[1] === "Hits") row.hits += total;
      else row.misses += total;
      densityCaches.set(density[2]!, row);
    }
  }
  return [...rows, ...boundedCaches.values(), ...densityCaches.values()];
}

export interface ModifierRow {
  modifier: string;
  evaluated: number;
  positionsOut: number;
}

const MODIFIER_CALLS_PATTERN = /^placement\.(.+)\.calls$/;

export function modifierRows(totals: CounterTotals): ModifierRow[] {
  const rows: ModifierRow[] = [];
  for (const [name, evaluated] of totals) {
    const match = MODIFIER_CALLS_PATTERN.exec(name);
    if (match === null) continue;
    rows.push({ modifier: match[1]!, evaluated, positionsOut: totals.get(`placement.${match[1]}.positionsOut`) ?? 0 });
  }
  return rows.sort((left, right) => right.evaluated - left.evaluated);
}

function breakdownEntries(snapshot: ProfileSnapshot, dimension: string): BreakdownEntry[] {
  return snapshot.breakdowns.find((summary) => summary.dimension === dimension && summary.thread === "worker")?.entries ?? [];
}

const FEATURE_OUTCOMES = ["placed", "rejected", "placedNested", "rejectedNested"] as const;
const REASON_PREFIX = "reason:";

export interface FeatureOutcomeRow {
  featureType: string;
  placed: number;
  rejected: number;
  placedNested: number;
  rejectedNested: number;
  reasons: { reason: string; count: number }[];
}

/** Per feature type: how often it placed or gave up (top level and nested in patches or selectors) and the stated reasons. */
export function featureOutcomeRows(snapshot: ProfileSnapshot): FeatureOutcomeRow[] {
  const rowsByType = new Map<string, FeatureOutcomeRow>();
  for (const entry of breakdownEntries(snapshot, DIMENSIONS.worldgenFeatureOutcome)) {
    const separatorIndex = entry.key.lastIndexOf("|");
    const featureType = entry.key.slice(0, separatorIndex);
    const outcome = entry.key.slice(separatorIndex + 1);
    let row = rowsByType.get(featureType);
    if (row === undefined) {
      row = { featureType, placed: 0, rejected: 0, placedNested: 0, rejectedNested: 0, reasons: [] };
      rowsByType.set(featureType, row);
    }
    if (outcome.startsWith(REASON_PREFIX)) row.reasons.push({ reason: outcome.slice(REASON_PREFIX.length), count: entry.units });
    else if ((FEATURE_OUTCOMES as readonly string[]).includes(outcome)) row[outcome as (typeof FEATURE_OUTCOMES)[number]] += entry.units;
  }
  for (const row of rowsByType.values()) row.reasons.sort((left, right) => right.count - left.count);
  return [...rowsByType.values()].sort(
    (left, right) => right.placed + right.rejected + right.placedNested + right.rejectedNested - (left.placed + left.rejected + left.placedNested + left.rejectedNested),
  );
}

export interface ChainRow {
  feature: string;
  modifier: string;
  positionsIn: number;
  positionsOut: number;
}

/** Placement chains: positions entering and leaving each modifier of each placed feature, biggest losers first. */
export function placementChainRows(snapshot: ProfileSnapshot): ChainRow[] {
  const rowsByKey = new Map<string, ChainRow>();
  for (const entry of breakdownEntries(snapshot, DIMENSIONS.worldgenPlacementChain)) {
    const parts = entry.key.split("|");
    const direction = parts.pop()!;
    const modifier = parts.pop()!;
    const feature = parts.join("|");
    const rowKey = `${feature}|${modifier}`;
    let row = rowsByKey.get(rowKey);
    if (row === undefined) {
      row = { feature, modifier, positionsIn: 0, positionsOut: 0 };
      rowsByKey.set(rowKey, row);
    }
    if (direction === "in") row.positionsIn += entry.units;
    else row.positionsOut += entry.units;
  }
  return [...rowsByKey.values()].sort((left, right) => right.positionsIn - right.positionsOut - (left.positionsIn - left.positionsOut));
}

function counterGroupOf(name: string): string {
  const dotIndex = name.indexOf(".");
  if (dotIndex !== -1) return name.slice(0, dotIndex);
  const upperIndex = name.search(/[A-Z]/);
  return upperIndex > 0 ? name.slice(0, upperIndex) : name;
}

/** All worldgen counters grouped by their first word, with totals and the value per generated game column. */
export function renderCounterGroups(totals: CounterTotals): string {
  const gameColumns = totals.get(GAME_COLUMN_COUNTER) ?? 0;
  const groups = new Map<string, [string, number][]>();
  for (const [name, total] of totals) {
    if (name.startsWith("coldStart.")) continue;
    const group = counterGroupOf(name);
    const members = groups.get(group) ?? [];
    members.push([name, total]);
    groups.set(group, members);
  }
  const sections: string[] = [];
  for (const group of [...groups.keys()].sort()) {
    const members = groups.get(group)!.sort((left, right) => right[1] - left[1]);
    sections.push(
      markdownHeading(4, group),
      markdownTable(
        ["counter", "total", "per game column"],
        members.map(([name, total]) => [`\`${name}\``, formatNumber(total), gameColumns === 0 ? "-" : formatNumber(total / gameColumns)]),
      ),
      "",
    );
  }
  return sections.join("\n");
}

export interface DataFileSize {
  fileName: string;
  bytes: number;
}

export interface WorldgenDetailInput {
  snapshot: ProfileSnapshot;
  /** Sizes of the bundled Terralith data files, when the caller can read them (the headless probe can). */
  dataFileSizes?: DataFileSize[];
}

export function renderWorldgenDetailMarkdown(input: WorldgenDetailInput): string {
  const { snapshot } = input;
  const totals = worldgenCounterTotals(snapshot);
  const lines: string[] = [markdownHeading(2, "Worldgen detail"), ""];

  lines.push(
    markdownHeading(3, "Cold start and one-off setup"),
    "",
    "Totals since the process started (events before profiling arrive as deferred counters). Nested events are inclusive, so rows overlap.",
    "",
    markdownTable(
      ["event", "calls", "total ms", "units"],
      coldStartRows(snapshot, totals).map((row) => [`\`${row.label}\``, formatNumber(row.calls), formatNumber(row.totalMs), row.units === 0 ? "-" : formatNumber(row.units)]),
    ),
    "",
  );

  if (input.dataFileSizes !== undefined) {
    const totalBytes = input.dataFileSizes.reduce((sum, file) => sum + file.bytes, 0);
    lines.push(
      markdownHeading(3, "Terralith data on disk"),
      "",
      markdownTable(
        ["file", "bytes"],
        [...input.dataFileSizes.map((file) => [file.fileName, formatNumber(file.bytes)]), ["total", formatNumber(totalBytes)]],
      ),
      "",
    );
  }

  lines.push(
    markdownHeading(3, "Cache hit rates"),
    "",
    markdownTable(
      ["cache", "hits", "misses", "hit rate"],
      cacheRateRows(totals).map((row) => [row.name, formatNumber(row.hits), formatNumber(row.misses), formatPercent(row.hits, row.hits + row.misses)]),
    ),
    "",
  );

  lines.push(
    markdownHeading(3, "Placement modifier pass rates"),
    "",
    markdownTable(
      ["modifier", "positions in", "positions out", "out / in"],
      modifierRows(totals).map((row) => [row.modifier, formatNumber(row.evaluated), formatNumber(row.positionsOut), row.evaluated === 0 ? "-" : (row.positionsOut / row.evaluated).toFixed(2)]),
    ),
    "",
    "Filters keep a position or drop it (out / in below 1); count style modifiers multiply positions (above 1).",
    "",
  );

  const stepEntries = breakdownEntries(snapshot, DIMENSIONS.worldgenDecorationStep);
  const stepLabels = stepEntries.filter((entry) => !entry.key.includes("|"));
  const stepUnits = (label: string, suffix: string) => stepEntries.find((entry) => entry.key === `${label}|${suffix}`)?.units ?? 0;
  lines.push(
    markdownHeading(3, "Decoration steps"),
    "",
    markdownTable(
      ["step", "origins x steps", "self ms", "features attempted", "placed something", "placed nothing", "errors"],
      stepLabels
        .sort((left, right) => right.selfMs - left.selfMs)
        .map((entry) => [
          entry.key,
          formatNumber(entry.calls),
          formatNumber(entry.selfMs),
          formatNumber(entry.units),
          formatNumber(stepUnits(entry.key, "placed")),
          formatNumber(stepUnits(entry.key, "nothingPlaced")),
          formatNumber(stepUnits(entry.key, "errors")),
        ]),
    ),
    "",
  );

  lines.push(
    markdownHeading(3, "Feature outcomes by type"),
    "",
    markdownTable(
      ["feature type", "placed", "rejected", "success", "nested placed", "nested rejected", "top rejection reasons"],
      featureOutcomeRows(snapshot).map((row) => [
        row.featureType,
        formatNumber(row.placed),
        formatNumber(row.rejected),
        formatPercent(row.placed, row.placed + row.rejected),
        formatNumber(row.placedNested),
        formatNumber(row.rejectedNested),
        row.reasons.slice(0, TOP_REASONS_PER_TYPE).map((reason) => `${reason.reason} ${formatNumber(reason.count)}`).join(", ") || "-",
      ]),
    ),
    "",
    "A rejection is a placement that returned false; reasons are only stated by feature types that name them, so counts can be lower than the rejections.",
    "",
  );

  lines.push(
    markdownHeading(3, `Placement chains with the most dropped positions (top ${TOP_CHAIN_ROWS})`),
    "",
    markdownTable(
      ["placed feature", "modifier", "in", "out", "dropped"],
      placementChainRows(snapshot)
        .slice(0, TOP_CHAIN_ROWS)
        .map((row) => [row.feature, row.modifier, formatNumber(row.positionsIn), formatNumber(row.positionsOut), formatNumber(Math.max(0, row.positionsIn - row.positionsOut))]),
    ),
    "",
  );

  const treeEntries = breakdownEntries(snapshot, DIMENSIONS.worldgenTreePart).filter((entry) => entry.key.endsWith("|placements"));
  lines.push(
    markdownHeading(3, "Tree parts by placer type"),
    "",
    markdownTable(
      ["part", "placements", "blocks written", "blocks per placement"],
      treeEntries
        .sort((left, right) => right.units - left.units)
        .map((entry) => {
          const partKey = entry.key.slice(0, -"|placements".length);
          const blocks = breakdownEntries(snapshot, DIMENSIONS.worldgenTreePart).find((candidate) => candidate.key === `${partKey}|blocks`)?.units ?? 0;
          return [partKey, formatNumber(entry.units), formatNumber(blocks), entry.units === 0 ? "-" : formatNumber(blocks / entry.units)];
        }),
    ),
    "",
  );

  lines.push(markdownHeading(3, "All worldgen counters by group"), "", renderCounterGroups(totals));
  return lines.join("\n");
}
