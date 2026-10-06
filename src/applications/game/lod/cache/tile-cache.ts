// LRU cache of built LOD tiles under a byte budget (GPU geometry plus the packed surface kept for refinement and
// downsampling). Tiles the caller is drawing or fading are pinned and never evicted; everything else goes oldest
// first once the budget is exceeded. The payload (the GPU mesh) is released through `onEvict`.

import { profiler } from "../../profiler";
import { MAX_LOD_LEVEL } from "../core/lod-constants";
import { metricNameOfLevel, perLevelMetricNames } from "../core/lod-level-keys";
import { tileKeyOf, type TileAddress } from "../core/tile-address";
import type { PackedTileSurface } from "../data/packed-tile-surface";
import type { HeightRange } from "../data/tile-surface";

export interface CachedTile<Payload> {
  readonly key: number;
  readonly address: TileAddress;
  readonly packedSurface: PackedTileSurface;
  readonly heightRange: HeightRange;
  readonly geometryBytes: number;
  readonly payload: Payload;
  /** Version of the real data the tile was built with; a newer version marks it stale. */
  readonly realDataVersion: number;
  lastUsedSequence: number;
}

const LEVEL_COUNT = MAX_LOD_LEVEL + 1;
const HITS_PER_LEVEL = perLevelMetricNames("game.lod.cache.hits.");
const MISSES_PER_LEVEL = perLevelMetricNames("game.lod.cache.misses.");
const EVICTIONS_PER_LEVEL = perLevelMetricNames("game.lod.cache.evictions.");
const ENTRIES_PER_LEVEL = perLevelMetricNames("game.lod.cache.entries.");
const BYTES_PER_LEVEL = perLevelMetricNames("memory.lod.tileCache.");

function levelSlot(address: TileAddress): number {
  return address.level < LEVEL_COUNT ? address.level : LEVEL_COUNT - 1;
}

/** Operations since the last `reportToProfiler`, kept as plain integers so lookups stay cheap. */
class CacheActivity {
  getHits = 0;
  getMisses = 0;
  hasHits = 0;
  hasMisses = 0;
  touches = 0;
  inserts = 0;
  replacements = 0;
  evictedBytes = 0;
  budgetExceeded = 0;
  evictionCandidates = 0;
  stillOverBudget = 0;
  readonly hitsByLevel = new Int32Array(LEVEL_COUNT);
  readonly missesByLevel = new Int32Array(LEVEL_COUNT);
  readonly evictionsByLevel = new Int32Array(LEVEL_COUNT);

  clear(): void {
    this.getHits = 0;
    this.getMisses = 0;
    this.hasHits = 0;
    this.hasMisses = 0;
    this.touches = 0;
    this.inserts = 0;
    this.replacements = 0;
    this.evictedBytes = 0;
    this.budgetExceeded = 0;
    this.evictionCandidates = 0;
    this.stillOverBudget = 0;
    this.hitsByLevel.fill(0);
    this.missesByLevel.fill(0);
    this.evictionsByLevel.fill(0);
  }
}

export class LodTileCache<Payload> {
  private readonly tiles = new Map<number, CachedTile<Payload>>();
  private totalBytesHeld = 0;
  private useSequence = 0;
  private readonly activity = new CacheActivity();
  private readonly entriesByLevel = new Int32Array(LEVEL_COUNT);
  private readonly bytesByLevel = new Float64Array(LEVEL_COUNT);
  private readonly levelEverHeldTiles = new Uint8Array(LEVEL_COUNT);
  private geometryBytesHeld = 0;
  private packedBytesHeld = 0;
  evictionCount = 0;

  constructor(
    private readonly memoryBudgetBytes: number,
    private readonly onEvict: (tile: CachedTile<Payload>) => void,
  ) {}

  get size(): number {
    return this.tiles.size;
  }

  get totalBytes(): number {
    return this.totalBytesHeld;
  }

  get budgetBytes(): number {
    return this.memoryBudgetBytes;
  }

  static bytesOf(packedSurface: PackedTileSurface, geometryBytes: number): number {
    return packedSurface.byteLength + geometryBytes;
  }

  get(address: TileAddress): CachedTile<Payload> | undefined {
    const tile = this.tiles.get(tileKeyOf(address.level, address.tileX, address.tileZ));
    if (tile === undefined) {
      this.activity.getMisses++;
      this.activity.missesByLevel[levelSlot(address)]!++;
    } else {
      this.activity.getHits++;
      this.activity.hitsByLevel[levelSlot(address)]!++;
    }
    return tile;
  }

  has(address: TileAddress): boolean {
    const isCached = this.tiles.has(tileKeyOf(address.level, address.tileX, address.tileZ));
    if (isCached) {
      this.activity.hasHits++;
      this.activity.hitsByLevel[levelSlot(address)]!++;
    } else {
      this.activity.hasMisses++;
      this.activity.missesByLevel[levelSlot(address)]!++;
    }
    return isCached;
  }

  /** Marks a tile as used now (drawn, or read as a hint), which protects it from eviction for longer. */
  touch(address: TileAddress): void {
    this.activity.touches++;
    const tile = this.get(address);
    if (tile !== undefined) tile.lastUsedSequence = ++this.useSequence;
  }

  /** Inserts or replaces a tile; a replaced tile's payload is released. */
  set(entry: Omit<CachedTile<Payload>, "key" | "lastUsedSequence">): CachedTile<Payload> {
    const key = tileKeyOf(entry.address.level, entry.address.tileX, entry.address.tileZ);
    const previous = this.tiles.get(key);
    if (previous !== undefined) {
      this.activity.replacements++;
      this.remove(previous);
    }
    this.activity.inserts++;
    const tile: CachedTile<Payload> = { ...entry, key, lastUsedSequence: ++this.useSequence };
    this.tiles.set(key, tile);
    const tileBytes = LodTileCache.bytesOf(tile.packedSurface, tile.geometryBytes);
    this.totalBytesHeld += tileBytes;
    this.geometryBytesHeld += tile.geometryBytes;
    this.packedBytesHeld += tile.packedSurface.byteLength;
    this.entriesByLevel[levelSlot(tile.address)]!++;
    this.bytesByLevel[levelSlot(tile.address)]! += tileBytes;
    this.levelEverHeldTiles[levelSlot(tile.address)] = 1;
    return tile;
  }

  private remove(tile: CachedTile<Payload>): void {
    this.tiles.delete(tile.key);
    const tileBytes = LodTileCache.bytesOf(tile.packedSurface, tile.geometryBytes);
    this.totalBytesHeld -= tileBytes;
    this.geometryBytesHeld -= tile.geometryBytes;
    this.packedBytesHeld -= tile.packedSurface.byteLength;
    this.entriesByLevel[levelSlot(tile.address)]!--;
    this.bytesByLevel[levelSlot(tile.address)]! -= tileBytes;
    this.onEvict(tile);
  }

  delete(address: TileAddress): void {
    const tile = this.get(address);
    if (tile !== undefined) this.remove(tile);
  }

  /** Evicts least recently used, unpinned tiles until the cache fits its budget. Returns how many were evicted. */
  enforceBudget(pinnedKeys: ReadonlySet<number>): number {
    if (this.totalBytesHeld <= this.memoryBudgetBytes) return 0;
    const token = profiler.begin("main.lod.cache.enforceBudget");
    try {
      this.activity.budgetExceeded++;
      const candidates = [...this.tiles.values()]
        .filter((tile) => !pinnedKeys.has(tile.key))
        .sort((first, second) => first.lastUsedSequence - second.lastUsedSequence);
      this.activity.evictionCandidates += candidates.length;
      let evicted = 0;
      for (const tile of candidates) {
        if (this.totalBytesHeld <= this.memoryBudgetBytes) break;
        this.activity.evictedBytes += LodTileCache.bytesOf(tile.packedSurface, tile.geometryBytes);
        this.activity.evictionsByLevel[levelSlot(tile.address)]!++;
        this.remove(tile);
        evicted++;
      }
      if (this.totalBytesHeld > this.memoryBudgetBytes) this.activity.stillOverBudget++;
      this.evictionCount += evicted;
      return evicted;
    } finally {
      profiler.end(token);
    }
  }

  /** Flushes the operation counts since the last call and samples the cache's size per level. Call once per frame. */
  reportToProfiler(): void {
    const activity = this.activity;
    if (!profiler.enabled) {
      activity.clear();
      return;
    }
    profiler.addCounter("game.lod.cache.getHits", activity.getHits);
    profiler.addCounter("game.lod.cache.getMisses", activity.getMisses);
    profiler.addCounter("game.lod.cache.hasHits", activity.hasHits);
    profiler.addCounter("game.lod.cache.hasMisses", activity.hasMisses);
    profiler.addCounter("game.lod.cache.touches", activity.touches);
    profiler.addCounter("game.lod.cache.inserts", activity.inserts);
    profiler.addCounter("game.lod.cache.replacements", activity.replacements);
    profiler.addCounter("game.lod.cache.budgetExceeded", activity.budgetExceeded);
    profiler.addCounter("game.lod.cache.evictionCandidates", activity.evictionCandidates);
    profiler.addCounter("game.lod.cache.stillOverBudget", activity.stillOverBudget);
    let evictions = 0;
    for (let level = 0; level < LEVEL_COUNT; level++) {
      if (activity.hitsByLevel[level]! > 0) profiler.addCounter(metricNameOfLevel(HITS_PER_LEVEL, level), activity.hitsByLevel[level]!);
      if (activity.missesByLevel[level]! > 0) profiler.addCounter(metricNameOfLevel(MISSES_PER_LEVEL, level), activity.missesByLevel[level]!);
      if (activity.evictionsByLevel[level]! > 0) profiler.addCounter(metricNameOfLevel(EVICTIONS_PER_LEVEL, level), activity.evictionsByLevel[level]!);
      evictions += activity.evictionsByLevel[level]!;
      if (this.levelEverHeldTiles[level] === 1) {
        profiler.sampleGauge(metricNameOfLevel(ENTRIES_PER_LEVEL, level), this.entriesByLevel[level]!);
        profiler.sampleGauge(metricNameOfLevel(BYTES_PER_LEVEL, level), this.bytesByLevel[level]!, "bytes");
      }
    }
    if (evictions > 0) {
      profiler.addCounter("game.lod.cache.evictions", evictions);
      profiler.recordBytes("bytes.lod.cache.evicted", activity.evictedBytes);
    }
    profiler.sampleGauge("game.lod.cache.entries", this.tiles.size);
    profiler.sampleGauge("memory.lod.tileGeometry", this.geometryBytesHeld, "bytes");
    profiler.sampleGauge("memory.lod.packedSurfaces", this.packedBytesHeld, "bytes");
    activity.clear();
  }

  values(): IterableIterator<CachedTile<Payload>> {
    return this.tiles.values();
  }

  clear(): void {
    for (const tile of [...this.tiles.values()]) this.remove(tile);
  }
}
