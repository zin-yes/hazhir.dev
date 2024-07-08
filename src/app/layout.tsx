import { ThemeProvider } from "@/components/providers/theme-proivider";

import "./global.css";

import "@xterm/xterm/css/xterm.css";

import { Montserrat } from "next/font/google";
const default_font = Montserrat({
  subsets: ["latin"],
});

import type { Metadata } from "next";
import { NextAuthSessionProvider } from "@/components/providers/session-provider";
export const metadata: Metadata = {
  title: "hazhir.dev",
  description:
    "Some cool projects that I have worked on, in a retro operating system theme.",
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
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <NextAuthSessionProvider>{children}</NextAuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
