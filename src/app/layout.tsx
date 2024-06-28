import "./global.css";

import { Jost } from "next/font/google";
const default_font = Jost({ subsets: ["latin"] });

import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "hazhir.dev",
  description: "Some cool projects that I have worked on.",
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
