import { describe, expect, test } from "bun:test";
import { DEFAULT_GAME_SETTINGS, normalizeGameSettings } from "./game-settings";
import { loadStoredGameSettings, storeGameSettings } from "./game-settings-storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

describe("game settings", () => {
  test("out of range numbers clamp and unknown options fall back", () => {
    const startedAt = performance.now();
    const normalized = normalizeGameSettings({
      fieldOfViewDegrees: 400.4,
      lookSensitivity: -2,
      touchControlSize: "huge",
      touchHandedness: "left",
      touchOpacity: 7,
      touchJoystickMode: 42,
    });
    expect(normalized).toEqual({
      ...DEFAULT_GAME_SETTINGS,
      fieldOfViewDegrees: 110,
      lookSensitivity: 0.25,
      touchHandedness: "left",
      touchOpacity: 1,
    });
    expect(normalizeGameSettings({ fieldOfViewDegrees: Number.NaN, touchOpacity: "0.5" })).toEqual(DEFAULT_GAME_SETTINGS);
    console.log(`game settings normalize test: ${(performance.now() - startedAt).toFixed(2)} ms`);
  });

  test("stored settings round trip, and a partial or broken store reads as defaults", () => {
    const storage = memoryStorage();
    const customized = { ...DEFAULT_GAME_SETTINGS, fieldOfViewDegrees: 100, touchControlSize: "large" as const, touchJoystickMode: "fixed" as const };
    storeGameSettings(storage, customized);
    expect(loadStoredGameSettings(storage)).toEqual(customized);

    storage.setItem("voxel-game.game-settings", JSON.stringify({ lookSensitivity: 2 }));
    expect(loadStoredGameSettings(storage)).toEqual({ ...DEFAULT_GAME_SETTINGS, lookSensitivity: 2 });

    expect(loadStoredGameSettings({ getItem: () => "{not json" })).toEqual(DEFAULT_GAME_SETTINGS);
    expect(
      loadStoredGameSettings({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(DEFAULT_GAME_SETTINGS);
    expect(() =>
      storeGameSettings(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        DEFAULT_GAME_SETTINGS,
      ),
    ).not.toThrow();
  });
});
