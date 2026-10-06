import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { profiler } from "../profiler";
import { defaultGameSettings } from "./game-settings";
import { loadStoredGameSettings, storeGameSettings } from "./game-settings-storage";

function memoryStorage(initialValues: [string, string][] = []) {
  const values = new Map<string, string>(initialValues);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

function counterTotal(name: string) {
  return profiler.snapshot().counters.find((counter) => counter.name === name)?.total ?? 0;
}

describe("settings storage profiling", () => {
  beforeEach(() => {
    profiler.reset("settings-storage-test");
    profiler.setEnabled(true);
  });
  afterEach(() => profiler.setEnabled(false));

  test("saving records the exact serialized size, and loading it back records the same size", () => {
    const storage = memoryStorage();
    const settings = { ...defaultGameSettings(), fieldOfViewDegrees: 95, lookSensitivity: 1.5 };
    storeGameSettings(storage, settings);
    const storedText = [...storage.values.values()][0];

    const loaded = loadStoredGameSettings(memoryStorage([["voxel-game.game-settings", storedText]]));

    expect(loaded.fieldOfViewDegrees).toBe(95);
    const bytes = profiler.snapshot().bytes;
    expect(bytes.find((meter) => meter.name === "bytes.settings.save")?.total).toBe(storedText.length);
    expect(bytes.find((meter) => meter.name === "bytes.settings.load")?.total).toBe(storedText.length);
    expect(counterTotal("game.settings.saves")).toBe(1);
    expect(counterTotal("game.settings.loads")).toBe(1);
  });

  test("a corrupt stored value counts as a load failure and still yields defaults", () => {
    const loaded = loadStoredGameSettings(memoryStorage([["voxel-game.game-settings", "{not json"]]));

    expect(loaded).toEqual(defaultGameSettings());
    expect(counterTotal("game.settings.loadFailures")).toBe(1);
  });

  test("a storage that throws on write counts a save failure", () => {
    const throwingStorage = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    storeGameSettings(throwingStorage, defaultGameSettings());
    expect(counterTotal("game.settings.saveFailures")).toBe(1);
  });
});
