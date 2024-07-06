"use client";

import MockCalculatorApplication from "@/components/mock-applications/calculator";
import Pane from "@/components/pane";
import { Calculator } from "lucide-react";

export default function OperatingSystemPage() {
  return (
    <main className="w-[100vw] h-[100vh]">
      <MockCalculatorApplicationPane />
    </main>
  );
}

function MockCalculatorApplicationPane() {
  return (
    <Pane
      action_bar={{
        title: "Calculator",
        icon: {
          svg: <Calculator />,
        },
      }}
      settings={{
        min_width: 300,
        min_height: 440,
        starting_width: 350,
        starting_height: 460,
        allow_overflow: false,
      }}
    >
      <MockCalculatorApplication />
    </Pane>
  );
}
