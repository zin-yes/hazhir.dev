// How far the game draws real chunks and the far terrain (LOD), as runtime settings. The streaming volume is derived from them: one more
// chunk in every direction is generated and lit but never meshed, so every drawn chunk has its neighbors' border
// blocks and light before it is meshed.

import { buildLoadOrder, type LoadOrder, type LoadVolumeShape } from "./load-order";
import type { ChunkStreamConfig } from "./streaming-plan";

export interface RenderSettings {
  /** Chunks drawn around the player horizontally. */
  horizontalRadius: number;
  /** Chunks drawn above the player's chunk. */
  verticalUp: number;
  /** Chunks drawn below the player's chunk. */
  verticalDown: number;
  /** "cylinder" keeps the full vertical range out to the horizon; "ellipsoid" tapers it with distance. */
  shape: LoadVolumeShape;
  /** Far terrain (LOD) radius in chunks; 0 turns it off. */
  lodRenderDistanceChunks: number;
}

/** The range the video settings offer for real chunks. */
export const REAL_RENDER_DISTANCE_MINIMUM_CHUNKS = 2;
export const REAL_RENDER_DISTANCE_MAXIMUM_CHUNKS = 16;
export const VERTICAL_RENDER_DISTANCE_MINIMUM_CHUNKS = 1;
export const VERTICAL_RENDER_DISTANCE_MAXIMUM_CHUNKS = 6;
export const LOD_RENDER_DISTANCE_MINIMUM_CHUNKS = 32;
export const LOD_RENDER_DISTANCE_MAXIMUM_CHUNKS = 512;

export const DEFAULT_RENDER_SETTINGS: Readonly<RenderSettings> = {
  horizontalRadius: 8,
  verticalUp: 3,
  verticalDown: 3,
  shape: "cylinder",
  lodRenderDistanceChunks: 128,
};

/** Generated and lit, never meshed: supplies border data to the outermost drawn chunks. */
export const BORDER_RING_CHUNKS = 1;
/** Extra horizontal chunks kept beyond the loaded volume before unloading, so walking back and forth does not churn. */
export const UNLOAD_HYSTERESIS_CHUNKS = 2;
/** Columns whose surface is known skip chunks this many chunks above it (all air). */
export const SKIP_ABOVE_SURFACE_MARGIN = 2;
/** Lowest and highest chunk y the world generator fills; nothing outside is ever requested. */
export const WORLD_LOWEST_CHUNK_Y = -2;
export const WORLD_HIGHEST_CHUNK_Y = 10;

export function normalizeRenderSettings(settings: Partial<RenderSettings>): RenderSettings {
  const wholeNonNegative = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : fallback;
  return {
    horizontalRadius: wholeNonNegative(settings.horizontalRadius, DEFAULT_RENDER_SETTINGS.horizontalRadius),
    verticalUp: wholeNonNegative(settings.verticalUp, DEFAULT_RENDER_SETTINGS.verticalUp),
    verticalDown: wholeNonNegative(settings.verticalDown, DEFAULT_RENDER_SETTINGS.verticalDown),
    shape: settings.shape ?? DEFAULT_RENDER_SETTINGS.shape,
    lodRenderDistanceChunks: normalizeLodRenderDistance(
      wholeNonNegative(settings.lodRenderDistanceChunks, DEFAULT_RENDER_SETTINGS.lodRenderDistanceChunks),
    ),
  };
}

function normalizeLodRenderDistance(chunks: number): number {
  if (chunks === 0) return 0;
  return Math.min(LOD_RENDER_DISTANCE_MAXIMUM_CHUNKS, Math.max(LOD_RENDER_DISTANCE_MINIMUM_CHUNKS, chunks));
}

export function streamConfigFor(
  settings: RenderSettings,
  surfaceChunkY: (chunkX: number, chunkZ: number) => number | undefined,
): ChunkStreamConfig {
  const loadedHorizontalRadius = settings.horizontalRadius + BORDER_RING_CHUNKS;
  return {
    horizontalRadius: loadedHorizontalRadius,
    verticalUp: settings.verticalUp + BORDER_RING_CHUNKS,
    verticalDown: settings.verticalDown + BORDER_RING_CHUNKS,
    shape: settings.shape,
    horizontalUnloadRadius: loadedHorizontalRadius + UNLOAD_HYSTERESIS_CHUNKS,
    verticalUnloadMargin: 1,
    minChunkY: WORLD_LOWEST_CHUNK_Y,
    maxChunkY: WORLD_HIGHEST_CHUNK_Y,
    surfaceChunkY,
    skipAboveSurfaceMargin: SKIP_ABOVE_SURFACE_MARGIN,
  };
}

/** The chunks kept loaded around the player (drawn volume plus the border ring), without unload hysteresis. */
export function loadedVolumeOf(settings: RenderSettings): LoadOrder {
  return buildLoadOrder({
    horizontalRadius: settings.horizontalRadius + BORDER_RING_CHUNKS,
    verticalUp: settings.verticalUp + BORDER_RING_CHUNKS,
    verticalDown: settings.verticalDown + BORDER_RING_CHUNKS,
    shape: settings.shape,
  });
}

/** The chunks drawn around the player, as offsets from the player's chunk. */
export function renderVolumeOf(settings: RenderSettings): LoadOrder {
  return buildLoadOrder({
    horizontalRadius: settings.horizontalRadius,
    verticalUp: settings.verticalUp,
    verticalDown: settings.verticalDown,
    shape: settings.shape,
  });
}
