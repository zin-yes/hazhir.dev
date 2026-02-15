"use client";

import { getCurrentSystemUsername } from "@/lib/system-user";

export const SYSTEM_PREFERENCES_EVENT = "system-preferences-change";
export const DESKTOP_LAYOUT_RESET_EVENT = "desktop-layout-reset";

export const DESKTOP_LAYOUT_STORAGE_KEY_BASE = "desktop-icon-layout-v2";
const CLOCK_FORMAT_STORAGE_KEY = "os_clock_format_v1";
const WALLPAPER_INDEX_STORAGE_KEY = "os_wallpaper_index_v1";

export type ClockFormat = "12h" | "24h";

function emitPreferencesChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SYSTEM_PREFERENCES_EVENT));
}

export function subscribeSystemPreferenceChanges(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(SYSTEM_PREFERENCES_EVENT, listener);
  window.addEventListener("storage", listener);

  return () => {
    window.removeEventListener(SYSTEM_PREFERENCES_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function getClockFormat(): ClockFormat {
  if (typeof window === "undefined") return "12h";
  const raw = window.localStorage.getItem(CLOCK_FORMAT_STORAGE_KEY);
  return raw === "24h" ? "24h" : "12h";
}

export function setClockFormat(format: ClockFormat) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CLOCK_FORMAT_STORAGE_KEY, format);
  emitPreferencesChange();
}

export function getWallpaperIndex(maxCount: number): number {
  if (typeof window === "undefined") return 0;

  const raw = window.localStorage.getItem(WALLPAPER_INDEX_STORAGE_KEY);
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed >= maxCount) return 0;

  return parsed;
}

export function setWallpaperIndex(index: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WALLPAPER_INDEX_STORAGE_KEY, String(index));
  emitPreferencesChange();
}

export function getDesktopLayoutStorageKey(
  username = getCurrentSystemUsername(),
): string {
  return `${DESKTOP_LAYOUT_STORAGE_KEY_BASE}:${username}`;
}

export function resetDesktopLayout(username = getCurrentSystemUsername()) {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(getDesktopLayoutStorageKey(username));
  window.dispatchEvent(
    new CustomEvent(DESKTOP_LAYOUT_RESET_EVENT, {
      detail: { username },
    }),
  );
}
