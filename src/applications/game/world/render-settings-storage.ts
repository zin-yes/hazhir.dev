// The player's video settings (real chunk and far terrain distances) kept in localStorage between sessions. Storage
// can be missing or throw (private windows, blocked site data): the defaults apply then.

import {
  REAL_RENDER_DISTANCE_MAXIMUM_CHUNKS,
  REAL_RENDER_DISTANCE_MINIMUM_CHUNKS,
  normalizeRenderSettings,
  type RenderSettings,
} from "./render-settings";

const STORAGE_KEY = "voxel-game.video-settings";

type StoredVideoSettings = Pick<RenderSettings, "horizontalRadius" | "lodRenderDistanceChunks">;

export function loadStoredRenderSettings(storage: Pick<Storage, "getItem"> | undefined): Partial<RenderSettings> {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    if (!text) return {};
    const stored = JSON.parse(text) as Partial<StoredVideoSettings>;
    const normalized = normalizeRenderSettings(stored);
    const settings: Partial<RenderSettings> = {};
    if (typeof stored.horizontalRadius === "number") {
      settings.horizontalRadius = Math.min(
        REAL_RENDER_DISTANCE_MAXIMUM_CHUNKS,
        Math.max(REAL_RENDER_DISTANCE_MINIMUM_CHUNKS, normalized.horizontalRadius),
      );
    }
    if (typeof stored.lodRenderDistanceChunks === "number") {
      settings.lodRenderDistanceChunks = normalized.lodRenderDistanceChunks;
    }
    return settings;
  } catch {
    return {};
  }
}

export function storeRenderSettings(storage: Pick<Storage, "setItem"> | undefined, settings: RenderSettings): void {
  try {
    const stored: StoredVideoSettings = {
      horizontalRadius: settings.horizontalRadius,
      lodRenderDistanceChunks: settings.lodRenderDistanceChunks,
    };
    storage?.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Settings simply do not persist.
  }
}

/** localStorage, or undefined where touching it throws. */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
