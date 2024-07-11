"use client";

import dynamic from "next/dynamic";

const TerminalApplication = dynamic(
  () => import("@/components/applications/terminal"),
  {
    ssr: false,
  }
);

export default function TerminalPage() {
  return (
    <main className="w-[100vw] h-[100vh]">
      <TerminalApplication />
    </main>
  );
}
