import { createRoot } from "react-dom/client";

import { installGlobalProfilerApi, type RunBenchmark } from "./global-api";
import { profiler } from "./index";
import { isOverlayVisible, setOverlayVisible } from "./ui/overlay-visibility";
import { ProfilerPanel } from "./ui/profiler-panel";

const ENABLED_STORAGE_KEY = "gameProfilerEnabled";
const PROFILE_QUERY_PARAMETER = "profile";
const TOGGLE_KEY_CODE = "F4";

function readPersistedEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // storage can be blocked; the toggle still works for this page load
  }
}

/**
 * Mounts the profiler overlay in its own React root, separate from the Game
 * component, so showing it never re-renders the game and skews measurements.
 * F4 toggles both the panel and recording; `?profile=1` starts it open.
 */
export function mountProfilerOverlay(options: { runBenchmark?: RunBenchmark }): () => void {
  const container = document.createElement("div");
  container.id = "game-profiler-overlay-root";
  document.body.appendChild(container);
  const root = createRoot(container);

  const removeGlobalApi = installGlobalProfilerApi(options);
  const runBenchmarkThroughApi: RunBenchmark | undefined = options.runBenchmark
    ? (benchmarkOptions) => window.__gameProfiler!.runBenchmark(benchmarkOptions)
    : undefined;
  root.render(<ProfilerPanel runBenchmark={runBenchmarkThroughApi} />);

  const shouldStartOpen =
    new URLSearchParams(window.location.search).get(PROFILE_QUERY_PARAMETER) === "1" ||
    readPersistedEnabled();
  if (shouldStartOpen) {
    setOverlayVisible(true);
    profiler.setEnabled(true);
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== TOGGLE_KEY_CODE) return;
    event.preventDefault();
    const nextVisible = !isOverlayVisible();
    setOverlayVisible(nextVisible);
    profiler.setEnabled(nextVisible);
    persistEnabled(nextVisible);
  };
  window.addEventListener("keydown", onKeyDown);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    removeGlobalApi();
    setOverlayVisible(false);
    profiler.setEnabled(false);
    setTimeout(() => {
      root.unmount();
      container.remove();
    }, 0);
  };
}
