import { describe, expect, test } from "bun:test";
import { DEFAULT_RENDER_SETTINGS } from "./render-settings";
import { loadStoredRenderSettings, storeRenderSettings } from "./render-settings-storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

describe("render settings storage", () => {
  test("stored chunk range, shape and distances come back, clamped", () => {
    const startedAt = performance.now();
    const storage = memoryStorage();
    storeRenderSettings(storage, { ...DEFAULT_RENDER_SETTINGS, horizontalRadius: 12, lodRenderDistanceChunks: 0, verticalUp: 9 });
    expect(loadStoredRenderSettings(storage)).toEqual({
      horizontalRadius: 12,
      verticalUp: 6,
      verticalDown: DEFAULT_RENDER_SETTINGS.verticalDown,
      shape: DEFAULT_RENDER_SETTINGS.shape,
      lodRenderDistanceChunks: 0,
    });
    storage.setItem(
      "voxel-game.video-settings",
      JSON.stringify({ horizontalRadius: 100, verticalDown: 0, shape: "cube", lodRenderDistanceChunks: 9000 }),
    );
    expect(loadStoredRenderSettings(storage)).toEqual({
      horizontalRadius: 16,
      verticalDown: 1,
      lodRenderDistanceChunks: 512,
    });
    console.log(`storage test: ${(performance.now() - startedAt).toFixed(2)} ms`);
  });

  test("broken JSON and throwing storage fall back to defaults", () => {
    expect(loadStoredRenderSettings({ getItem: () => "{not json" })).toEqual({});
    expect(
      loadStoredRenderSettings({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual({});
    expect(() =>
      storeRenderSettings(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        { ...DEFAULT_RENDER_SETTINGS },
      ),
    ).not.toThrow();
  });
});
