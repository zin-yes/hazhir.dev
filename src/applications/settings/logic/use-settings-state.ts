"use client";

import { useSession } from "@/auth/client";
import {
  ClockFormat,
  getClockFormat,
  getWallpaperIndex,
  getWallpaperSlideshowEnabled,
  getWallpaperSlideshowIntervalMs,
  resetDesktopLayout,
  setClockFormat,
  setWallpaperIndex,
  setWallpaperSlideshowEnabled,
  setWallpaperSlideshowIntervalMs,
} from "@/lib/system-preferences";
import { getCurrentSystemUsername, getHomePath } from "@/lib/system-user";
import { WALLPAPERS } from "@/lib/wallpapers";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Wallpaper choice list derived from the global WALLPAPERS registry */
/* ------------------------------------------------------------------ */

export const WALLPAPER_CHOICES = WALLPAPERS.map((wallpaper, index) => ({
  label: wallpaper.label,
  value: String(index),
  previewUrl: wallpaper.url,
}));

/* ------------------------------------------------------------------ */
/*  Type definitions for structured information passed to tab views   */
/* ------------------------------------------------------------------ */

export type UserAccountInformation = {
  name: string;
  email: string;
  username: string;
  userId: string;
  homePath: string;
  accountType: string;
};

export type SystemEnvironmentInformation = {
  platform: string;
  language: string;
  cpuThreads: string;
  memory: string;
  resolution: string;
  userAgent: string;
};

/* ------------------------------------------------------------------ */
/*  Tab registry: declarative list of available settings tabs         */
/* ------------------------------------------------------------------ */

export type SettingsTabDefinition = {
  /** Unique identifier used as the tab value */
  id: string;
  /** Human-readable label displayed on the tab trigger */
  label: string;
  /** Lucide icon name (resolved by the component rendering the tab list) */
  iconName: "Wallpaper" | "User" | "Monitor";
};

export const SETTINGS_TABS: SettingsTabDefinition[] = [
  { id: "appearance", label: "Appearance", iconName: "Wallpaper" },
  { id: "account", label: "Account", iconName: "User" },
  { id: "system", label: "System", iconName: "Monitor" },
];

/**
 * Normalizes an initial tab identifier to a known settings tab id.
 * Falls back to "appearance" if the value is unknown or missing.
 */
export function normalizeInitialTabIdentifier(initialTab?: string): string {
  if (!initialTab) return "appearance";
  const knownTabIds = SETTINGS_TABS.map((tab) => tab.id);
  if (knownTabIds.includes(initialTab)) return initialTab;
  if (initialTab === "options") return "appearance";
  return "appearance";
}

/* ------------------------------------------------------------------ */
/*  Central settings state hook                                       */
/* ------------------------------------------------------------------ */

export function useSettingsState(initialTab?: string) {
  const session = useSession();

  /* ---- Active tab ---- */
  const [activeTabId, setActiveTabId] = useState(
    normalizeInitialTabIdentifier(initialTab),
  );

  /* ---- Appearance preferences ---- */
  const [clockFormatPreference, setClockFormatPreference] =
    useState<ClockFormat>("12h");
  const [selectedWallpaperIndex, setSelectedWallpaperIndex] = useState(0);
  const [isSlideshowEnabled, setIsSlideshowEnabled] = useState(false);
  const [slideshowIntervalMilliseconds, setSlideshowIntervalMilliseconds] =
    useState(30000);

  /* ---- Status bar message ---- */
  const [statusBarMessage, setStatusBarMessage] = useState("");

  /* Load persisted preferences on mount */
  useEffect(() => {
    setClockFormatPreference(getClockFormat());
    setSelectedWallpaperIndex(getWallpaperIndex(WALLPAPER_CHOICES.length));
    setIsSlideshowEnabled(getWallpaperSlideshowEnabled());
    setSlideshowIntervalMilliseconds(getWallpaperSlideshowIntervalMs());
  }, []);

  /* Sync tab when the external initialTab prop changes */
  useEffect(() => {
    setActiveTabId(normalizeInitialTabIdentifier(initialTab));
  }, [initialTab]);

  /* ---- Appearance action handlers ---- */

  const handleWallpaperSelected = useCallback((nextIndex: number) => {
    setWallpaperIndex(nextIndex);
    setSelectedWallpaperIndex(nextIndex);
    setStatusBarMessage("Wallpaper updated.");
  }, []);

  const handleClockFormatChanged = useCallback((nextFormat: ClockFormat) => {
    setClockFormat(nextFormat);
    setClockFormatPreference(nextFormat);
    setStatusBarMessage("Clock format updated.");
  }, []);

  const handleSlideshowToggled = useCallback((enabled: boolean) => {
    setWallpaperSlideshowEnabled(enabled);
    setIsSlideshowEnabled(enabled);
    setStatusBarMessage(
      enabled
        ? "Wallpaper slideshow enabled."
        : "Wallpaper slideshow disabled.",
    );
  }, []);

  const handleSlideshowIntervalChanged = useCallback(
    (nextIntervalMilliseconds: number) => {
      setWallpaperSlideshowIntervalMs(nextIntervalMilliseconds);
      setSlideshowIntervalMilliseconds(nextIntervalMilliseconds);
      setStatusBarMessage("Slideshow interval updated.");
    },
    [],
  );

  const handleDesktopLayoutReset = useCallback(() => {
    resetDesktopLayout();
    setStatusBarMessage("Desktop icon layout reset.");
  }, []);

  /* ---- Derived user account information ---- */

  const userAccountInformation: UserAccountInformation = useMemo(() => {
    const currentUser = session.data?.user as
      | { id?: string; name?: string; email?: string; username?: string }
      | undefined;

    return {
      name: currentUser?.name || "Guest",
      email: currentUser?.email || "guest@hazhir.local",
      username: currentUser?.username || getCurrentSystemUsername(),
      userId: currentUser?.id || "guest",
      homePath: getHomePath(),
      accountType: session.isGuest ? "Guest" : "Authenticated",
    };
  }, [session.data?.user, session.isGuest]);

  /* ---- Derived system environment information ---- */

  const systemEnvironmentInformation: SystemEnvironmentInformation =
    useMemo(() => {
      if (typeof window === "undefined") {
        return {
          platform: "Unknown",
          language: "Unknown",
          cpuThreads: "Unknown",
          memory: "Unknown",
          resolution: "Unknown",
          userAgent: "Unknown",
        };
      }

      const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
        .deviceMemory;

      return {
        platform: navigator.platform || "Unknown",
        language: navigator.language || "Unknown",
        cpuThreads: String(navigator.hardwareConcurrency || "Unknown"),
        memory: deviceMemory ? `${deviceMemory} GB` : "Unknown",
        resolution: `${window.screen.width} × ${window.screen.height}`,
        userAgent: navigator.userAgent,
      };
    }, []);

  return {
    /* Tab state */
    activeTabId,
    setActiveTabId,

    /* Appearance state */
    selectedWallpaperIndex,
    clockFormatPreference,
    isSlideshowEnabled,
    slideshowIntervalMilliseconds,

    /* Appearance handlers */
    handleWallpaperSelected,
    handleClockFormatChanged,
    handleSlideshowToggled,
    handleSlideshowIntervalChanged,
    handleDesktopLayoutReset,

    /* Derived info */
    userAccountInformation,
    systemEnvironmentInformation,

    /* Status bar */
    statusBarMessage,
  };
}
