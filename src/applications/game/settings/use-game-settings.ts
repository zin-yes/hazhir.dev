import { useCallback, useRef, useState } from "react";
import { profiler } from "../profiler";
import { browserStorage } from "../world/render-settings-storage";
import { normalizeGameSettings, type GameSettings } from "./game-settings";
import { loadStoredGameSettings, storeGameSettings } from "./game-settings-storage";

/** The player's game settings, remembered on this device. `settingsRef` always holds the latest value for game loops. */
export function useGameSettings() {
  const [settings, setSettings] = useState<GameSettings>(() => loadStoredGameSettings(browserStorage()));
  const settingsRef = useRef(settings);

  const updateSettings = useCallback((changes: Partial<GameSettings>) => {
    const updateToken = profiler.begin("main.settings.update");
    try {
      profiler.addCounter("game.settings.updates");
      if (profiler.enabled) profiler.addCounter("game.settings.keysChanged", Object.keys(changes).length);
      const updated = normalizeGameSettings({ ...settingsRef.current, ...changes });
      settingsRef.current = updated;
      storeGameSettings(browserStorage(), updated);
      setSettings(updated);
    } finally {
      profiler.end(updateToken);
    }
  }, []);

  return { settings, settingsRef, updateSettings };
}
