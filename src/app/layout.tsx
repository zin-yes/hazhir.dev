import "./global.css";

import { Montserrat } from "next/font/google";
const default_font = Montserrat({
  subsets: ["latin"],
});

import type { Metadata } from "next";
import { ThemeProvider } from "@/components/providers/theme-proivider";
export const metadata: Metadata = {
  title: "hazhir.dev",
  description:
    "Some cool projects that I have worked on in a retro operating system theme.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={default_font.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
