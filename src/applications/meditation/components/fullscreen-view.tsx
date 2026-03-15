"use client";

import { Button } from "@/components/ui/button";
import { Minimize } from "lucide-react";
import { memo } from "react";

interface FullscreenViewProps {
  displayTime: string;
  displayedPhaseLabel: string;
  statusSummaryText: string;
  isBrightPhaseBackground: boolean;
  phaseTransitionDurationMilliseconds: number;
  onExitFullscreen: () => void;
}

/** Fullscreen meditation view — fills the entire screen with Timer and phase info */
const FullscreenView = memo(function FullscreenView({
  displayTime,
  displayedPhaseLabel,
  statusSummaryText,
  isBrightPhaseBackground,
  phaseTransitionDurationMilliseconds,
  onExitFullscreen,
}: FullscreenViewProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <Button
        onClick={onExitFullscreen}
        size="icon"
        variant="ghost"
        className="absolute right-4 top-4"
      >
        <Minimize className="h-5 w-5" />
      </Button>
      <div
        className={`flex h-full w-full items-center justify-center text-center transition-colors ${
          isBrightPhaseBackground
            ? "border-white bg-white text-black"
            : "border-foreground/20 bg-background text-foreground"
        }`}
        style={{
          transitionDuration: `${phaseTransitionDurationMilliseconds}ms`,
          transitionTimingFunction: "linear",
        }}
      >
        <div>
          <div className="font-mono text-8xl font-bold">{displayTime}</div>
          <p className="mt-6 text-2xl font-medium">{displayedPhaseLabel}</p>
          <p className="mt-3 text-lg opacity-70">{statusSummaryText}</p>
        </div>
      </div>
    </div>
  );
});

export default FullscreenView;
