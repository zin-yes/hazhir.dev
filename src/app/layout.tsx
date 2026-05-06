import { PostHogPageView } from "@/components/posthog-pageview";
import { Toaster } from "@/components/ui/sonner";
import { PostHogProvider } from "@/providers/posthog-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { TrpcProvider } from "@/providers/trpc-provider";
import { Suspense } from "react";

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
});

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
    <html
      lang="en"
      suppressHydrationWarning
      className="dark h-full overflow-hidden"
    >
      <body
        className={`${default_font.className} h-full overflow-hidden overscroll-none`}
      >
        <PostHogProvider>
          <TrpcProvider>
            <ThemeProvider
              enableSystem
              storageKey="currentTheme"
              attribute="class"
              defaultTheme="dark"
              forcedTheme="dark"
            >
              <Suspense>
                <PostHogPageView />
              </Suspense>
              {children}
              <Toaster richColors position="top-right" />
            </ThemeProvider>
          </TrpcProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
