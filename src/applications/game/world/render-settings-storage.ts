// The player's video settings (chunk range, volume shape and far terrain distance) kept in localStorage between sessions. Storage
// can be missing or throw (private windows, blocked site data): the defaults apply then.

import { profiler } from "../profiler";
import {
  REAL_RENDER_DISTANCE_MAXIMUM_CHUNKS,
  REAL_RENDER_DISTANCE_MINIMUM_CHUNKS,
  VERTICAL_RENDER_DISTANCE_MAXIMUM_CHUNKS,
  VERTICAL_RENDER_DISTANCE_MINIMUM_CHUNKS,
  normalizeRenderSettings,
  type RenderSettings,
} from "./render-settings";

const STORAGE_KEY = "voxel-game.video-settings";

type StoredVideoSettings = Pick<
  RenderSettings,
  "horizontalRadius" | "verticalUp" | "verticalDown" | "shape" | "lodRenderDistanceChunks"
>;

const VOLUME_SHAPES: readonly RenderSettings["shape"][] = ["cylinder", "ellipsoid"];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function loadStoredRenderSettings(storage: Pick<Storage, "getItem"> | undefined): Partial<RenderSettings> {
  const scopeToken = profiler.begin("main.settings.loadVideoSettings");
  try {
    return readStoredRenderSettings(storage);
  } finally {
    profiler.end(scopeToken);
  }
}

function readStoredRenderSettings(storage: Pick<Storage, "getItem"> | undefined): Partial<RenderSettings> {
  profiler.addCounter("game.settings.video.loads");
  try {
    const text = storage?.getItem(STORAGE_KEY);
    if (!text) {
      profiler.addCounter("game.settings.video.loadsWithoutStoredValue");
      return {};
    }
    profiler.recordBytes("bytes.settings.video.read", text.length);
    const stored = JSON.parse(text) as Partial<StoredVideoSettings>;
    const normalized = normalizeRenderSettings(stored);
    const settings: Partial<RenderSettings> = {};
    if (typeof stored.horizontalRadius === "number") {
      settings.horizontalRadius = clamp(
        normalized.horizontalRadius,
        REAL_RENDER_DISTANCE_MINIMUM_CHUNKS,
        REAL_RENDER_DISTANCE_MAXIMUM_CHUNKS,
      );
    }
    for (const verticalKey of ["verticalUp", "verticalDown"] as const) {
      if (typeof stored[verticalKey] === "number") {
        settings[verticalKey] = clamp(
          normalized[verticalKey],
          VERTICAL_RENDER_DISTANCE_MINIMUM_CHUNKS,
          VERTICAL_RENDER_DISTANCE_MAXIMUM_CHUNKS,
        );
      }
    }
    if (stored.shape && VOLUME_SHAPES.includes(stored.shape)) settings.shape = stored.shape;
    if (typeof stored.lodRenderDistanceChunks === "number") {
      settings.lodRenderDistanceChunks = normalized.lodRenderDistanceChunks;
    }
    profiler.addCounter("game.settings.video.fieldsRestored", Object.keys(settings).length);
    return settings;
  } catch {
    profiler.addCounter("game.settings.video.loadFailures");
    return {};
  }
}

export function storeRenderSettings(storage: Pick<Storage, "setItem"> | undefined, settings: RenderSettings): void {
  const scopeToken = profiler.begin("main.settings.storeVideoSettings");
  try {
    const stored: StoredVideoSettings = {
      horizontalRadius: settings.horizontalRadius,
      verticalUp: settings.verticalUp,
      verticalDown: settings.verticalDown,
      shape: settings.shape,
      lodRenderDistanceChunks: settings.lodRenderDistanceChunks,
    };
    const text = JSON.stringify(stored);
    storage?.setItem(STORAGE_KEY, text);
    profiler.addCounter("game.settings.video.stores");
    profiler.recordBytes("bytes.settings.video.written", text.length);
  } catch {
    // Settings simply do not persist.
    profiler.addCounter("game.settings.video.storeFailures");
  } finally {
    profiler.end(scopeToken);
  }
}

/** localStorage, or undefined where touching it throws. */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    profiler.addCounter("game.settings.video.storageUnavailable");
    return undefined;
  }
}
