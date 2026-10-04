import { useEffect, useLayoutEffect } from "react";
import { profiler as gameProfiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";
import type { Profiler } from "../profiler/profiler";

const NOT_MEASURING = -1;

const useCommitEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Credits one render pass of a UI surface to its timer and breakdown key. Time
 * is inclusive of child components rendered in the same pass, and is recorded as
 * a plain timer so it is not counted again in the frame busy total (the React
 * commit timer already covers it).
 */
export function recordSurfaceRender(
  profilerInstance: Profiler,
  surfaceName: string,
  renderStartedAtMs: number,
  commitReachedAtMs: number,
) {
  if (renderStartedAtMs === NOT_MEASURING) return;
  const durationMs = commitReachedAtMs - renderStartedAtMs;
  profilerInstance.recordTimer(
    `main.ui.render.${surfaceName}`,
    durationMs,
    "main-cpu",
  );
  profilerInstance.recordBreakdown(DIMENSIONS.uiSurface, surfaceName, {
    calls: 1,
    totalMs: durationMs,
  });
}

/**
 * Call first in a component. Measures from the call to the layout effect that
 * runs once the render pass for this component has been committed.
 */
export function useProfiledRender(surfaceName: string) {
  const renderStartedAtMs = gameProfiler.enabled
    ? gameProfiler.now()
    : NOT_MEASURING;
  useCommitEffect(() => {
    if (renderStartedAtMs === NOT_MEASURING) return;
    recordSurfaceRender(
      gameProfiler,
      surfaceName,
      renderStartedAtMs,
      gameProfiler.now(),
    );
  });
}
