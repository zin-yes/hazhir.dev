// Precomputed chunk offsets of a desired volume around the player, sorted nearest-first. Built once per
// configuration and cached, so streaming never re-derives or re-sorts the volume while the player walks.

import { profiler } from "../profiler";

export type LoadVolumeShape = "ellipsoid" | "cylinder";

export interface LoadVolumeConfig {
  /** Horizontal radius in chunks. */
  horizontalRadius: number;
  /** Chunks included above the player's chunk. */
  verticalUp: number;
  /** Chunks included below the player's chunk. */
  verticalDown: number;
  /** "ellipsoid" (default) tapers vertically with distance; "cylinder" keeps the full vertical range at every column. */
  shape?: LoadVolumeShape;
}

export interface LoadOrder {
  readonly config: Required<LoadVolumeConfig>;
  readonly offsetCount: number;
  readonly offsetX: Int16Array;
  readonly offsetY: Int16Array;
  readonly offsetZ: Int16Array;
  readonly offsetDistanceSquared: Uint32Array;
  readonly columnCount: number;
  readonly columnOffsetX: Int16Array;
  readonly columnOffsetZ: Int16Array;
  readonly columnDistanceSquared: Uint32Array;
  /** Constant-time membership test of an offset in the volume. */
  contains(offsetX: number, offsetY: number, offsetZ: number): boolean;
}

const RADIUS_EDGE_MARGIN = 0.5;
const loadOrderCache = new Map<string, LoadOrder>();

/** Membership test traffic, kept as plain integers because contains() runs thousands of times a second. */
const membershipStats = { tests: 0, inside: 0 };

/** Returns the membership tests since the last call and resets them; the pipeline publishes them once a second. */
export function drainLoadOrderMembershipStats(): { tests: number; inside: number } {
  const drained = { tests: membershipStats.tests, inside: membershipStats.inside };
  membershipStats.tests = 0;
  membershipStats.inside = 0;
  return drained;
}

export function loadOrderCacheEntryCount(): number {
  return loadOrderCache.size;
}

function assertValidRadius(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number, received ${value}`);
  }
}

function isOffsetInsideVolume(
  config: Required<LoadVolumeConfig>,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
): boolean {
  const horizontalReach = config.horizontalRadius + RADIUS_EDGE_MARGIN;
  const horizontalDistanceSquared = offsetX * offsetX + offsetZ * offsetZ;
  if (horizontalDistanceSquared > horizontalReach * horizontalReach) return false;
  const verticalExtent = offsetY >= 0 ? config.verticalUp : config.verticalDown;
  if (offsetY > 0 && offsetY > config.verticalUp) return false;
  if (offsetY < 0 && -offsetY > config.verticalDown) return false;
  if (config.shape === "cylinder") return true;
  const verticalReach = verticalExtent + RADIUS_EDGE_MARGIN;
  return (
    horizontalDistanceSquared / (horizontalReach * horizontalReach) +
      (offsetY * offsetY) / (verticalReach * verticalReach) <=
    1
  );
}

function compareNearestFirst(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): number {
  return (
    left[3] - right[3] ||
    Math.abs(left[1]) - Math.abs(right[1]) ||
    left[0] - right[0] ||
    left[2] - right[2] ||
    left[1] - right[1]
  );
}

function buildLoadOrderUncached(config: Required<LoadVolumeConfig>): LoadOrder {
  const enumerateToken = profiler.begin("main.streaming.loadOrder.enumerate");
  const horizontalExtent = Math.ceil(config.horizontalRadius);
  const horizontalWidth = 2 * horizontalExtent + 1;
  const verticalHeight = config.verticalUp + config.verticalDown + 1;

  const volumeEntries: [number, number, number, number][] = [];
  const membershipGrid = new Uint8Array(horizontalWidth * verticalHeight * horizontalWidth);
  const columnEntries: [number, number, number, number][] = [];

  for (let offsetX = -horizontalExtent; offsetX <= horizontalExtent; offsetX++) {
    for (let offsetZ = -horizontalExtent; offsetZ <= horizontalExtent; offsetZ++) {
      let columnHasChunks = false;
      for (let offsetY = -config.verticalDown; offsetY <= config.verticalUp; offsetY++) {
        if (!isOffsetInsideVolume(config, offsetX, offsetY, offsetZ)) continue;
        columnHasChunks = true;
        const distanceSquared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
        volumeEntries.push([offsetX, offsetY, offsetZ, distanceSquared]);
        const gridIndex =
          ((offsetX + horizontalExtent) * verticalHeight + (offsetY + config.verticalDown)) * horizontalWidth +
          (offsetZ + horizontalExtent);
        membershipGrid[gridIndex] = 1;
      }
      if (columnHasChunks) columnEntries.push([offsetX, 0, offsetZ, offsetX * offsetX + offsetZ * offsetZ]);
    }
  }

  profiler.end(enumerateToken);

  const sortToken = profiler.begin("main.streaming.loadOrder.sort");
  volumeEntries.sort(compareNearestFirst);
  columnEntries.sort(compareNearestFirst);
  profiler.end(sortToken);

  const packToken = profiler.begin("main.streaming.loadOrder.pack");
  const offsetX = new Int16Array(volumeEntries.length);
  const offsetY = new Int16Array(volumeEntries.length);
  const offsetZ = new Int16Array(volumeEntries.length);
  const offsetDistanceSquared = new Uint32Array(volumeEntries.length);
  volumeEntries.forEach(([entryX, entryY, entryZ, distanceSquared], entryIndex) => {
    offsetX[entryIndex] = entryX;
    offsetY[entryIndex] = entryY;
    offsetZ[entryIndex] = entryZ;
    offsetDistanceSquared[entryIndex] = distanceSquared;
  });

  const columnOffsetX = new Int16Array(columnEntries.length);
  const columnOffsetZ = new Int16Array(columnEntries.length);
  const columnDistanceSquared = new Uint32Array(columnEntries.length);
  columnEntries.forEach(([entryX, , entryZ, distanceSquared], entryIndex) => {
    columnOffsetX[entryIndex] = entryX;
    columnOffsetZ[entryIndex] = entryZ;
    columnDistanceSquared[entryIndex] = distanceSquared;
  });
  profiler.end(packToken);

  if (profiler.enabled) {
    profiler.addCounter("game.streaming.loadOrder.offsetsBuilt", volumeEntries.length);
    profiler.addCounter("game.streaming.loadOrder.columnsBuilt", columnEntries.length);
    profiler.sampleGauge("game.streaming.loadOrder.volumeOffsets", volumeEntries.length);
    profiler.sampleGauge("game.streaming.loadOrder.volumeColumns", columnEntries.length);
    profiler.recordBytes(
      "bytes.streaming.loadOrder",
      offsetX.byteLength * 3 + offsetDistanceSquared.byteLength + columnOffsetX.byteLength * 2 +
        columnDistanceSquared.byteLength + membershipGrid.byteLength,
    );
  }

  return {
    config,
    offsetCount: volumeEntries.length,
    offsetX,
    offsetY,
    offsetZ,
    offsetDistanceSquared,
    columnCount: columnEntries.length,
    columnOffsetX,
    columnOffsetZ,
    columnDistanceSquared,
    contains(queryX, queryY, queryZ) {
      membershipStats.tests++;
      const gridX = queryX + horizontalExtent;
      const gridY = queryY + config.verticalDown;
      const gridZ = queryZ + horizontalExtent;
      if (gridX < 0 || gridX >= horizontalWidth || gridZ < 0 || gridZ >= horizontalWidth) return false;
      if (gridY < 0 || gridY >= verticalHeight) return false;
      const isInside = membershipGrid[(gridX * verticalHeight + gridY) * horizontalWidth + gridZ] === 1;
      if (isInside) membershipStats.inside++;
      return isInside;
    },
  };
}

/** Nearest-first offsets of the desired volume and of its columns; cached per configuration. */
export function buildLoadOrder(config: LoadVolumeConfig): LoadOrder {
  assertValidRadius("horizontalRadius", config.horizontalRadius);
  assertValidRadius("verticalUp", config.verticalUp);
  assertValidRadius("verticalDown", config.verticalDown);
  const resolvedConfig: Required<LoadVolumeConfig> = {
    horizontalRadius: config.horizontalRadius,
    verticalUp: Math.floor(config.verticalUp),
    verticalDown: Math.floor(config.verticalDown),
    shape: config.shape ?? "ellipsoid",
  };
  const cacheKey = `${resolvedConfig.shape}:${resolvedConfig.horizontalRadius}:${resolvedConfig.verticalUp}:${resolvedConfig.verticalDown}`;
  let loadOrder = loadOrderCache.get(cacheKey);
  if (loadOrder) {
    profiler.addCounter("game.streaming.loadOrder.cacheHits");
    return loadOrder;
  }
  profiler.addCounter("game.streaming.loadOrder.cacheMisses");
  const buildToken = profiler.begin("main.streaming.loadOrder.build");
  try {
    loadOrder = buildLoadOrderUncached(resolvedConfig);
  } finally {
    profiler.end(buildToken);
  }
  loadOrderCache.set(cacheKey, loadOrder);
  profiler.sampleGauge("game.streaming.loadOrder.cacheEntries", loadOrderCache.size);
  return loadOrder;
}
