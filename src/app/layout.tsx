import { ThemeProvider } from "@/providers/theme-provider";

import "./global.css";

import "@xterm/xterm/css/xterm.css";

import { Montserrat } from "next/font/google";
const default_font = Montserrat({
  subsets: ["latin"],
});

import type { Metadata } from "next";
import { NextAuthSessionProvider } from "@/providers/session-provider";
export const metadata: Metadata = {
  title: "hazhir.dev",
  description:
    "My personal web dev portfolio, presented using a operating system theme.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={default_font.className}>
        <ThemeProvider
          enableSystem
          storageKey="currentTheme"
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
        >
          <NextAuthSessionProvider>{children}</NextAuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
