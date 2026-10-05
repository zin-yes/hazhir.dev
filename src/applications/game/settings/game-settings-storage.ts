// Game settings kept in localStorage between sessions. Storage can be missing or throw (private windows, blocked site
// data): the defaults apply then.

import { defaultGameSettings, normalizeGameSettings, type GameSettings } from "./game-settings";

const STORAGE_KEY = "voxel-game.game-settings";

export function loadStoredGameSettings(storage: Pick<Storage, "getItem"> | undefined): GameSettings {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    if (!text) return defaultGameSettings();
    return normalizeGameSettings(JSON.parse(text) as Partial<GameSettings>);
  } catch {
    return defaultGameSettings();
  }
}

export function storeGameSettings(storage: Pick<Storage, "setItem"> | undefined, settings: GameSettings): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings simply do not persist.
  }
}
