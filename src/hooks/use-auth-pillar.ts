"use client";

import { useEffect, useState } from "react";

const GUEST_SESSION_STORAGE_KEY = "auth_guest_session_v1";
const AUTH_MODAL_STORAGE_KEY = "auth_modal_requested_v1";
const AUTH_PILLAR_EVENT = "auth-pillar-change";

export type GuestUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  image: string;
  isGuest: true;
};

export type GuestSession = {
  user: GuestUser;
  createdAt: number;
  expiresAt: number;
};

const DEFAULT_GUEST_DURATION_MS = 1000 * 60 * 60 * 8;

function safeParseGuestSession(value: string | null): GuestSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as GuestSession;
    if (!parsed?.user?.id || !parsed?.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getGuestSession(): GuestSession | null {
  if (typeof window === "undefined") return null;
  const session = safeParseGuestSession(
    window.sessionStorage.getItem(GUEST_SESSION_STORAGE_KEY)
  );

  if (!session) {
    window.sessionStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
  }

  return session;
}

export function createGuestSession(durationMs = DEFAULT_GUEST_DURATION_MS) {
  if (typeof window === "undefined") return null;

  const now = Date.now();
  const guestSession: GuestSession = {
    user: {
      id: `guest-${now}`,
      name: "Guest",
      username: "guest",
      email: "guest@hazhir.local",
      image: "",
      isGuest: true,
    },
    createdAt: now,
    expiresAt: now + durationMs,
  };

  window.sessionStorage.setItem(
    GUEST_SESSION_STORAGE_KEY,
    JSON.stringify(guestSession)
  );
  window.dispatchEvent(new Event(AUTH_PILLAR_EVENT));
  return guestSession;
}

export function clearGuestSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
  window.dispatchEvent(new Event(AUTH_PILLAR_EVENT));
}

export function requestSignInModal() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(AUTH_MODAL_STORAGE_KEY, "1");
  window.dispatchEvent(new Event(AUTH_PILLAR_EVENT));
}

export function dismissSignInModal() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTH_MODAL_STORAGE_KEY);
  window.dispatchEvent(new Event(AUTH_PILLAR_EVENT));
}

function getIsSignInModalRequested() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(AUTH_MODAL_STORAGE_KEY) === "1";
}

export function useAuthPillar() {
  const [guestSession, setGuestSession] = useState<GuestSession | null>(() =>
    getGuestSession()
  );
  const [isSignInModalRequested, setIsSignInModalRequested] = useState(() =>
    getIsSignInModalRequested()
  );

  useEffect(() => {
    const sync = () => {
      setGuestSession(getGuestSession());
      setIsSignInModalRequested(getIsSignInModalRequested());
    };

    sync();
    window.addEventListener(AUTH_PILLAR_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(AUTH_PILLAR_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return {
    guestSession,
    isGuestAuthenticated: Boolean(guestSession),
    isSignInModalRequested,
    beginGuestSession: createGuestSession,
    endGuestSession: clearGuestSession,
    requestSignInModal,
    dismissSignInModal,
  };
}
