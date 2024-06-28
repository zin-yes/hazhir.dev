import "./global.css";

import { Silkscreen } from "next/font/google";
const default_font = Silkscreen({ subsets: ["latin"], weight: ["400", "700"] });

import type { Metadata } from "next";
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
      <body className={default_font.className}>{children}</body>
    </html>
  );
}
