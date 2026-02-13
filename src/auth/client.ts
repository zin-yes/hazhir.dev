"use client";

import { authClient } from "@/lib/auth-client";
import {
  clearGuestSession,
  createGuestSession,
  dismissSignInModal,
  requestSignInModal,
  useAuthPillar,
} from "@/hooks/use-auth-pillar";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

type SignInOptions = {
  callbackUrl?: string;
};

type CredentialsSignInOptions = {
  email: string;
  password: string;
  callbackUrl?: string;
};

type SignOutOptions = {
  callbackUrl?: string;
};

export function useSession() {
  const session = authClient.useSession();
  const { guestSession } = useAuthPillar();

  if (session.data) {
    return {
      ...session,
      status: "authenticated" as SessionStatus,
      update: session.refetch,
      isGuest: false,
    };
  }

  if (guestSession) {
    return {
      ...session,
      data: {
        user: guestSession.user,
        session: {
          id: `session-${guestSession.createdAt}`,
          createdAt: new Date(guestSession.createdAt),
          expiresAt: new Date(guestSession.expiresAt),
        },
      },
      status: "authenticated" as SessionStatus,
      update: session.refetch,
      isGuest: true,
    };
  }

  const status: SessionStatus = session.isPending
    ? "loading"
    : "unauthenticated";

  return {
    ...session,
    status,
    update: session.refetch,
    isGuest: false,
  };
}

export async function signIn(provider?: string, options?: SignInOptions) {
  dismissSignInModal();
  const result = await authClient.signIn.social({
    provider: provider ?? "google",
    callbackURL: options?.callbackUrl,
  });

  return result;
}

export async function signInWithGoogle(options?: SignInOptions) {
  return signIn("google", options);
}

export async function signInWithCredentials(options: CredentialsSignInOptions) {
  const result = await authClient.signIn.email({
    email: options.email,
    password: options.password,
    callbackURL: options.callbackUrl,
  });

  if (result.data && !result.error) {
    dismissSignInModal();
  }

  return result;
}

export async function signOut(options?: SignOutOptions) {
  clearGuestSession();
  requestSignInModal();
  let result: Awaited<ReturnType<typeof authClient.signOut>> | undefined;

  try {
    result = await authClient.signOut();
  } catch {
    result = undefined;
  }

  if (options?.callbackUrl && typeof window !== "undefined") {
    window.location.assign(options.callbackUrl);
  }

  return result;
}

export function signInAsGuest() {
  dismissSignInModal();
  return createGuestSession();
}

export { requestSignInModal, dismissSignInModal };
