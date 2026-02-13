import { ThemeProvider } from "@/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";

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
    <html lang="en" suppressHydrationWarning className="h-full overflow-hidden">
      <body className={`${default_font.className} h-full overflow-hidden overscroll-none`}>
        <ThemeProvider
          enableSystem
          storageKey="currentTheme"
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
        >
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
