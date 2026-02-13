import { ThemeProvider } from "@/providers/theme-provider";

import "./global.css";

import "@xterm/xterm/css/xterm.css";

import { Fira_Code, Montserrat } from "next/font/google";
const default_font = Montserrat({
  subsets: ["latin"],
});

const fira_code = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira-code",
})

import type { Metadata } from "next";
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
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
