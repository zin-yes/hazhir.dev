"use client";

const SYSTEM_USERNAME_STORAGE_KEY = "os_username_v1";
const GUEST_SESSION_STORAGE_KEY = "auth_guest_session_v1";

function sanitizeUsername(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return normalized.length > 0 ? normalized : "guest";
}

export function getCurrentSystemUsername(): string {
  if (typeof window === "undefined") return "guest";

  const guestRaw = window.sessionStorage.getItem(GUEST_SESSION_STORAGE_KEY);
  if (guestRaw) {
    try {
      const parsed = JSON.parse(guestRaw) as { user?: { username?: string } };
      if (parsed?.user?.username) {
        return sanitizeUsername(parsed.user.username);
      }
    } catch {
      // Ignore invalid guest payload
    }
  }

  const persisted = window.localStorage.getItem(SYSTEM_USERNAME_STORAGE_KEY);
  return sanitizeUsername(persisted);
}

export function setCurrentSystemUsername(username: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SYSTEM_USERNAME_STORAGE_KEY,
    sanitizeUsername(username)
  );
}

export function getHomePath(username = getCurrentSystemUsername()): string {
  return `/home/${sanitizeUsername(username)}`;
}
