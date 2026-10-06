import { useEffect, useLayoutEffect, useRef } from "react";
import { profiler as gameProfiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";
import type { Profiler } from "../profiler/profiler";

const NOT_MEASURING = -1;

const useCommitEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const renderTimerNameBySurface = new Map<string, string>();

function renderTimerNameFor(surfaceName: string) {
  let timerName = renderTimerNameBySurface.get(surfaceName);
  if (!timerName) {
    timerName = `main.ui.render.${surfaceName}`;
    renderTimerNameBySurface.set(surfaceName, timerName);
  }
  return timerName;
}

const mountCounterNameBySurface = new Map<string, string>();

/** Counts how often a surface appears on screen (menus and overlays mount and unmount as the phase changes). */
export function recordSurfaceMount(profilerInstance: Profiler, surfaceName: string) {
  let counterName = mountCounterNameBySurface.get(surfaceName);
  if (!counterName) {
    counterName = `game.ui.mounts.${surfaceName}`;
    mountCounterNameBySurface.set(surfaceName, counterName);
  }
  profilerInstance.addCounter(counterName);
}

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
    renderTimerNameFor(surfaceName),
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
  const hasMountedRef = useRef(false);
  useCommitEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      recordSurfaceMount(gameProfiler, surfaceName);
    }
    if (renderStartedAtMs === NOT_MEASURING) return;
    recordSurfaceRender(
      gameProfiler,
      surfaceName,
      renderStartedAtMs,
      gameProfiler.now(),
    );
  });
}
