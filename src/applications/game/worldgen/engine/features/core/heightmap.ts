// Mirrors net.minecraft.world.level.levelgen.Heightmap: the six Types with their opacity predicates, priming
// (Heightmap.primeHeightmaps) and the incremental update ProtoChunk.setBlockState applies after every write.
// Values are "first available" y (highest matching block + 1, or minY for an empty column), which is what
// WorldGenRegion.getHeight returns.

import type { BlockStateInfo } from "../../block-state";

export type HeightmapType =
  | "WORLD_SURFACE_WG"
  | "WORLD_SURFACE"
  | "OCEAN_FLOOR_WG"
  | "OCEAN_FLOOR"
  | "MOTION_BLOCKING"
  | "MOTION_BLOCKING_NO_LEAVES";

export const HEIGHTMAP_TYPES: readonly HeightmapType[] = [
  "WORLD_SURFACE_WG",
  "WORLD_SURFACE",
  "OCEAN_FLOOR_WG",
  "OCEAN_FLOOR",
  "MOTION_BLOCKING",
  "MOTION_BLOCKING_NO_LEAVES",
];

/** ChunkStatus.PRE_FEATURES: frozen during decoration (the CARVERS status updates POST_FEATURES heightmaps only). */
export function isWorldgenHeightmap(type: HeightmapType): boolean {
  return type === "WORLD_SURFACE_WG" || type === "OCEAN_FLOOR_WG";
}

export function isHeightmapOpaque(type: HeightmapType, info: BlockStateInfo): boolean {
  switch (type) {
    case "WORLD_SURFACE_WG":
    case "WORLD_SURFACE":
      return !info.isAir;
    case "OCEAN_FLOOR_WG":
    case "OCEAN_FLOOR":
      return info.blocksMotion;
    case "MOTION_BLOCKING":
      return info.blocksMotion || info.fluid !== "empty";
    case "MOTION_BLOCKING_NO_LEAVES":
      return (info.blocksMotion || info.fluid !== "empty") && !info.isLeaves;
  }
}

export function parseHeightmapType(name: string): HeightmapType {
  if (!(HEIGHTMAP_TYPES as readonly string[]).includes(name)) throw new Error(`Unknown heightmap type "${name}"`);
  return name as HeightmapType;
}

/** Read access to the 16x16 column the heightmap belongs to. */
export interface HeightmapColumnReader {
  readonly minY: number;
  readonly maxYExclusive: number;
  infoAt(localX: number, y: number, localZ: number): BlockStateInfo;
}

export class ChunkHeightmap {
  private readonly firstAvailable = new Int32Array(256);

  /** Primes by scanning the column, or copies `primedFrom` when the column's blocks are known to match it. */
  constructor(
    readonly type: HeightmapType,
    private readonly column: HeightmapColumnReader,
    primedFrom?: ChunkHeightmap,
  ) {
    if (primedFrom !== undefined) {
      this.firstAvailable.set(primedFrom.firstAvailable);
      return;
    }
    for (let localZ = 0; localZ < 16; localZ++) {
      for (let localX = 0; localX < 16; localX++) {
        this.firstAvailable[localZ * 16 + localX] = this.scanDown(localX, localZ, column.maxYExclusive - 1);
      }
    }
  }

  private scanDown(localX: number, localZ: number, startY: number): number {
    for (let y = startY; y >= this.column.minY; y--) {
      if (isHeightmapOpaque(this.type, this.column.infoAt(localX, y, localZ))) return y + 1;
    }
    return this.column.minY;
  }

  getFirstAvailable(localX: number, localZ: number): number {
    return this.firstAvailable[localZ * 16 + localX]!;
  }

  /** Heightmap.update, called after (localX, y, localZ) changed to `info`. */
  update(localX: number, y: number, localZ: number, info: BlockStateInfo): void {
    const index = localZ * 16 + localX;
    const current = this.firstAvailable[index]!;
    if (y <= current - 2) return;
    if (isHeightmapOpaque(this.type, info)) {
      if (y >= current) this.firstAvailable[index] = y + 1;
    } else if (current - 1 === y) {
      this.firstAvailable[index] = this.scanDown(localX, localZ, y - 1);
    }
  }
}
