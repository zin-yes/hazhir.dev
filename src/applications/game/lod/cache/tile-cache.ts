// LRU cache of built LOD tiles under a byte budget (GPU geometry plus the packed surface kept for refinement and
// downsampling). Tiles the caller is drawing or fading are pinned and never evicted; everything else goes oldest
// first once the budget is exceeded. The payload (the GPU mesh) is released through `onEvict`.

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

export class LodTileCache<Payload> {
  private readonly tiles = new Map<number, CachedTile<Payload>>();
  private totalBytesHeld = 0;
  private useSequence = 0;
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
    return this.tiles.get(tileKeyOf(address.level, address.tileX, address.tileZ));
  }

  has(address: TileAddress): boolean {
    return this.tiles.has(tileKeyOf(address.level, address.tileX, address.tileZ));
  }

  /** Marks a tile as used now (drawn, or read as a hint), which protects it from eviction for longer. */
  touch(address: TileAddress): void {
    const tile = this.get(address);
    if (tile !== undefined) tile.lastUsedSequence = ++this.useSequence;
  }

  /** Inserts or replaces a tile; a replaced tile's payload is released. */
  set(entry: Omit<CachedTile<Payload>, "key" | "lastUsedSequence">): CachedTile<Payload> {
    const key = tileKeyOf(entry.address.level, entry.address.tileX, entry.address.tileZ);
    const previous = this.tiles.get(key);
    if (previous !== undefined) this.remove(previous);
    const tile: CachedTile<Payload> = { ...entry, key, lastUsedSequence: ++this.useSequence };
    this.tiles.set(key, tile);
    this.totalBytesHeld += LodTileCache.bytesOf(tile.packedSurface, tile.geometryBytes);
    return tile;
  }

  private remove(tile: CachedTile<Payload>): void {
    this.tiles.delete(tile.key);
    this.totalBytesHeld -= LodTileCache.bytesOf(tile.packedSurface, tile.geometryBytes);
    this.onEvict(tile);
  }

  delete(address: TileAddress): void {
    const tile = this.get(address);
    if (tile !== undefined) this.remove(tile);
  }

  /** Evicts least recently used, unpinned tiles until the cache fits its budget. Returns how many were evicted. */
  enforceBudget(pinnedKeys: ReadonlySet<number>): number {
    if (this.totalBytesHeld <= this.memoryBudgetBytes) return 0;
    const candidates = [...this.tiles.values()]
      .filter((tile) => !pinnedKeys.has(tile.key))
      .sort((first, second) => first.lastUsedSequence - second.lastUsedSequence);
    let evicted = 0;
    for (const tile of candidates) {
      if (this.totalBytesHeld <= this.memoryBudgetBytes) break;
      this.remove(tile);
      evicted++;
    }
    this.evictionCount += evicted;
    return evicted;
  }

  values(): IterableIterator<CachedTile<Payload>> {
    return this.tiles.values();
  }

  clear(): void {
    for (const tile of [...this.tiles.values()]) this.remove(tile);
  }
}
