"use client";

import { SessionProvider, SessionProviderProps } from "next-auth/react";

export function NextAuthSessionProvider({
  children,
  ...props
}: SessionProviderProps) {
  return <SessionProvider {...props}>{children}</SessionProvider>;
}
