"use client";

import { memo } from "react";

interface BreathingDisplayProps {
  displayTime: string;
  displayedPhaseLabel: string;
  detailSummaryText: string;
  targetMinutes: number;
  isBrightPhaseBackground: boolean;
  phaseTransitionDurationMilliseconds: number;
}

/** Central timer display showing elapsed time, current phase, and detail text */
const BreathingDisplay = memo(function BreathingDisplay({
  displayTime,
  displayedPhaseLabel,
  detailSummaryText,
  targetMinutes,
  isBrightPhaseBackground,
  phaseTransitionDurationMilliseconds,
}: BreathingDisplayProps) {
  return (
    <div
      className={`rounded-xl border p-6 text-center transition-colors ${
        isBrightPhaseBackground
          ? "bg-white text-black"
          : "bg-background text-foreground"
      }`}
      style={{
        transitionDuration: `${phaseTransitionDurationMilliseconds}ms`,
        transitionTimingFunction: "linear",
      }}
    >
      <div className="font-mono text-5xl font-bold">{displayTime}</div>
      <p className="mt-3 text-lg font-medium">{displayedPhaseLabel}</p>
      <p className="mt-2 text-sm opacity-70">{detailSummaryText}</p>
      {targetMinutes > 0 && (
        <p className="mt-1 text-xs opacity-60">Target: {targetMinutes} min</p>
      )}
    </div>
  );
});

export default BreathingDisplay;
