import { describe, expect, test } from "bun:test";
import { DEFAULT_GAME_SETTINGS, SHADOW_QUALITIES, defaultBloomEnabled, defaultGameSettings, defaultShadowQuality, defaultWaterReflections, normalizeGameSettings } from "./game-settings";
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

  test("shadow quality defaults per device and keeps valid stored values", () => {
    const startedAt = performance.now();
    const touchDevice = (query: string) => ({ matches: query === "(pointer: coarse)" });
    const desktopDevice = () => ({ matches: false });

    expect(defaultShadowQuality(touchDevice)).toBe("off");
    expect(defaultShadowQuality(desktopDevice)).toBe("high");
    expect(defaultShadowQuality()).toBe("high");
    expect(SHADOW_QUALITIES).toEqual(["off", "low", "high"]);

    expect(normalizeGameSettings({ shadowQuality: "ultra" }).shadowQuality).toBe("high");
    expect(normalizeGameSettings({ shadowQuality: 3 }).shadowQuality).toBe("high");
    for (const shadowQuality of SHADOW_QUALITIES) {
      expect(normalizeGameSettings({ shadowQuality }).shadowQuality).toBe(shadowQuality);
    }

    const storage = memoryStorage();
    storage.setItem("voxel-game.game-settings", JSON.stringify({ shadowQuality: "low" }));
    expect(loadStoredGameSettings(storage).shadowQuality).toBe("low");
    storage.setItem("voxel-game.game-settings", JSON.stringify({ shadowQuality: "junk" }));
    expect(loadStoredGameSettings(storage).shadowQuality).toBe("high");
    console.log(`shadow quality defaults test: ${(performance.now() - startedAt).toFixed(2)} ms`);
  });

  test("bloom defaults per device and keeps valid stored values", () => {
    const startedAt = performance.now();
    const touchDevice = (query: string) => ({ matches: query === "(pointer: coarse)" });
    const desktopDevice = () => ({ matches: false });

    expect(defaultBloomEnabled(touchDevice)).toBe(false);
    expect(defaultBloomEnabled(desktopDevice)).toBe(true);
    expect(defaultBloomEnabled()).toBe(true);
    expect(defaultGameSettings(touchDevice).bloomEnabled).toBe(false);
    expect(defaultGameSettings(desktopDevice).bloomEnabled).toBe(true);

    expect(normalizeGameSettings({ bloomEnabled: "yes" }).bloomEnabled).toBe(true);
    expect(normalizeGameSettings({ bloomEnabled: 0 }).bloomEnabled).toBe(true);
    expect(normalizeGameSettings({ bloomEnabled: null }).bloomEnabled).toBe(true);
    expect(normalizeGameSettings({ bloomEnabled: false }).bloomEnabled).toBe(false);
    expect(normalizeGameSettings({ bloomEnabled: true }).bloomEnabled).toBe(true);

    const storage = memoryStorage();
    storage.setItem("voxel-game.game-settings", JSON.stringify({ bloomEnabled: false }));
    expect(loadStoredGameSettings(storage).bloomEnabled).toBe(false);
    storage.setItem("voxel-game.game-settings", JSON.stringify({ shadowQuality: "low" }));
    expect(loadStoredGameSettings(storage).bloomEnabled).toBe(true);
    storage.setItem("voxel-game.game-settings", JSON.stringify({ bloomEnabled: "junk" }));
    expect(loadStoredGameSettings(storage).bloomEnabled).toBe(true);
    console.log(`bloom defaults test: ${(performance.now() - startedAt).toFixed(2)} ms`);
  });

  test("water reflections default per device and keep valid stored values", () => {
    const startedAt = performance.now();
    const touchDevice = (query: string) => ({ matches: query === "(pointer: coarse)" });
    const desktopDevice = () => ({ matches: false });

    expect(defaultWaterReflections(touchDevice)).toBe(false);
    expect(defaultWaterReflections(desktopDevice)).toBe(true);
    expect(defaultWaterReflections()).toBe(true);
    expect(defaultGameSettings(touchDevice).waterReflections).toBe(false);
    expect(defaultGameSettings(desktopDevice).waterReflections).toBe(true);

    expect(normalizeGameSettings({ waterReflections: "yes" }).waterReflections).toBe(true);
    expect(normalizeGameSettings({ waterReflections: 0 }).waterReflections).toBe(true);
    expect(normalizeGameSettings({ waterReflections: null }).waterReflections).toBe(true);
    expect(normalizeGameSettings({ waterReflections: false }).waterReflections).toBe(false);
    expect(normalizeGameSettings({ waterReflections: true }).waterReflections).toBe(true);

    const storage = memoryStorage();
    storage.setItem("voxel-game.game-settings", JSON.stringify({ waterReflections: false }));
    expect(loadStoredGameSettings(storage).waterReflections).toBe(false);
    storage.setItem("voxel-game.game-settings", JSON.stringify({ shadowQuality: "low" }));
    expect(loadStoredGameSettings(storage).waterReflections).toBe(true);
    storage.setItem("voxel-game.game-settings", JSON.stringify({ waterReflections: "junk" }));
    expect(loadStoredGameSettings(storage).waterReflections).toBe(true);
    console.log(`water reflections defaults test: ${(performance.now() - startedAt).toFixed(2)} ms`);
  });
});
