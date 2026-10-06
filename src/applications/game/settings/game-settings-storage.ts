// Game settings kept in localStorage between sessions. Storage can be missing or throw (private windows, blocked site
// data): the defaults apply then.

import { profiler } from "../profiler";
import { defaultGameSettings, normalizeGameSettings, type GameSettings } from "./game-settings";

const STORAGE_KEY = "voxel-game.game-settings";

export function loadStoredGameSettings(storage: Pick<Storage, "getItem"> | undefined): GameSettings {
  const loadToken = profiler.begin("main.settings.load");
  profiler.addCounter("game.settings.loads");
  try {
    const readToken = profiler.begin("main.settings.load.read");
    let text: string | null | undefined;
    try {
      text = storage?.getItem(STORAGE_KEY);
    } finally {
      profiler.end(readToken);
    }
    if (!text) {
      profiler.addCounter("game.settings.loadsWithoutStoredValue");
      return defaultGameSettings();
    }
    profiler.recordBytes("bytes.settings.load", text.length);
    const stored = profiler.measure("main.settings.load.parse", () => JSON.parse(text) as Partial<GameSettings>);
    return normalizeGameSettings(stored);
  } catch {
    profiler.addCounter("game.settings.loadFailures");
    return defaultGameSettings();
  } finally {
    profiler.end(loadToken);
  }
}

export function storeGameSettings(storage: Pick<Storage, "setItem"> | undefined, settings: GameSettings): void {
  const saveToken = profiler.begin("main.settings.save");
  profiler.addCounter("game.settings.saves");
  try {
    const text = profiler.measure("main.settings.save.serialize", () => JSON.stringify(settings));
    profiler.recordBytes("bytes.settings.save", text.length);
    const writeToken = profiler.begin("main.settings.save.write");
    try {
      storage?.setItem(STORAGE_KEY, text);
    } finally {
      profiler.end(writeToken);
    }
  } catch {
    // Settings simply do not persist.
    profiler.addCounter("game.settings.saveFailures");
  } finally {
    profiler.end(saveToken);
  }
}
