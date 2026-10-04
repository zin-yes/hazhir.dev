import { useCallback, useRef, useState } from "react";
import { browserStorage } from "../world/render-settings-storage";
import { normalizeGameSettings, type GameSettings } from "./game-settings";
import { loadStoredGameSettings, storeGameSettings } from "./game-settings-storage";

/** The player's game settings, remembered on this device. `settingsRef` always holds the latest value for game loops. */
export function useGameSettings() {
  const [settings, setSettings] = useState<GameSettings>(() => loadStoredGameSettings(browserStorage()));
  const settingsRef = useRef(settings);

  const updateSettings = useCallback((changes: Partial<GameSettings>) => {
    const updated = normalizeGameSettings({ ...settingsRef.current, ...changes });
    settingsRef.current = updated;
    storeGameSettings(browserStorage(), updated);
    setSettings(updated);
  }, []);

  return { settings, settingsRef, updateSettings };
}
