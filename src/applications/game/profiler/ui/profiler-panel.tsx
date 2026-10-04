"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { downloadJson, saveProfileReport } from "../export-report";
import type { RunBenchmark } from "../global-api";
import { profiler } from "../index";
import { renderMarkdownReport } from "../markdown-report";
import { buildProfileReport } from "../report";
import type { ProfileReport } from "../types";
import { isOverlayVisible, subscribeOverlayVisibility } from "./overlay-visibility";
import { getOptionalProfilerApi } from "./profiler-api-access";
import { BreakdownsTab } from "./tabs/breakdowns-tab";
import { CallTreeTab } from "./tabs/call-tree-tab";
import { CompareTab } from "./tabs/compare-tab";
import { EventsTab } from "./tabs/events-tab";
import { FramesTab } from "./tabs/frames-tab";
import { FlameTab } from "./tabs/flame-tab";
import { GpuTab } from "./tabs/gpu-tab";
import { LightTab } from "./tabs/light-tab";
import { MainThreadTab } from "./tabs/main-thread-tab";
import { MemoryTab } from "./tabs/memory-tab";
import { MeshesTab } from "./tabs/meshes-tab";
import { TargetsTab } from "./tabs/targets-tab";
import { TransfersTab } from "./tabs/transfers-tab";
import { WorkersTab } from "./tabs/workers-tab";

const REFRESH_INTERVAL_MILLISECONDS = 500;

const TABS = [
  { id: "targets", label: "Targets", Component: TargetsTab },
  { id: "frames", label: "Frames", Component: FramesTab },
  { id: "main", label: "Main", Component: MainThreadTab },
  { id: "calltree", label: "Call tree", Component: CallTreeTab },
  { id: "flame", label: "Flame", Component: FlameTab },
  { id: "breakdowns", label: "Breakdowns", Component: BreakdownsTab },
  { id: "workers", label: "Workers", Component: WorkersTab },
  { id: "light", label: "Light", Component: LightTab },
  { id: "gpu", label: "GPU", Component: GpuTab },
  { id: "transfers", label: "Transfers", Component: TransfersTab },
  { id: "memory", label: "Memory", Component: MemoryTab },
  { id: "meshes", label: "Meshes", Component: MeshesTab },
  { id: "events", label: "Events", Component: EventsTab },
  { id: "compare", label: "Compare", Component: CompareTab },
] as const;

type TabId = (typeof TABS)[number]["id"];

const BUTTON_CLASSES = "border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700 disabled:opacity-40";

export function ProfilerPanel({ runBenchmark }: { runBenchmark?: RunBenchmark }) {
  const isVisible = useSyncExternalStore(subscribeOverlayVisibility, isOverlayVisible, () => false);
  const [report, setReport] = useState<ProfileReport | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("targets");
  const [isRecording, setIsRecording] = useState(profiler.enabled);
  const [isPassBreakdownOn, setIsPassBreakdownOn] = useState(profiler.settings.gpuPassBreakdown);
  const [isTracing, setIsTracing] = useState(profiler.isTracing);
  const [statusText, setStatusText] = useState("");
  const [benchmarkStartedAtMs, setBenchmarkStartedAtMs] = useState<number | null>(null);

  useEffect(() => profiler.onEnabledChange(setIsRecording), []);

  useEffect(() => {
    if (!isVisible) return;
    const refresh = () => {
      const startedAtMs = performance.now();
      const nextReport = buildProfileReport(profiler.snapshot());
      profiler.recordMainThreadTimer("main.profilerOverlay", performance.now() - startedAtMs);
      setReport(nextReport);
      setIsTracing(profiler.isTracing);
    };
    refresh();
    const intervalHandle = setInterval(refresh, REFRESH_INTERVAL_MILLISECONDS);
    return () => clearInterval(intervalHandle);
  }, [isVisible]);

  if (!isVisible) return null;

  const activeDefinition = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
  const isBenchmarkRunning = benchmarkStartedAtMs !== null;

  const savePaths = async () => {
    if (!report) return;
    const paths = await saveProfileReport(report);
    setStatusText(paths ? `saved ${paths.markdownPath}` : "save failed (dev server only)");
  };

  const copyMarkdown = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(renderMarkdownReport(report));
    setStatusText("markdown copied");
  };

  const toggleTrace = (enabled: boolean) => {
    const profilerApi = getOptionalProfilerApi();
    if (profilerApi.trace) profilerApi.trace(enabled);
    else profiler.setTracing(enabled);
    setIsTracing(enabled);
  };

  const saveTrace = async () => {
    try {
      await getOptionalProfilerApi().saveTrace?.();
      setStatusText("trace saved");
    } catch (error) {
      setStatusText(`trace save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const startBenchmark = async () => {
    if (!runBenchmark) return;
    setBenchmarkStartedAtMs(performance.now());
    setStatusText("");
    try {
      await runBenchmark();
      setStatusText("benchmark saved to .profiles/latest-benchmark.md");
    } catch (error) {
      setStatusText(`benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBenchmarkStartedAtMs(null);
    }
  };

  return (
    <div className="pointer-events-auto fixed top-2 right-2 bottom-2 z-[2147483000] flex w-[580px] max-w-[96vw] flex-col border border-zinc-700 bg-zinc-950/95 font-mono text-[11px] text-zinc-200 shadow-xl">
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-700 p-1.5">
        <span className="mr-1 font-bold text-cyan-400">PROFILER (F4)</span>
        <button className={BUTTON_CLASSES} onClick={() => profiler.setEnabled(!isRecording)}>
          {isRecording ? "Pause" : "Record"}
        </button>
        <button className={BUTTON_CLASSES} onClick={() => profiler.reset("manual")}>
          Reset
        </button>
        <button className={BUTTON_CLASSES} onClick={savePaths} disabled={!report}>
          Save to .profiles
        </button>
        <button className={BUTTON_CLASSES} onClick={copyMarkdown} disabled={!report}>
          Copy markdown
        </button>
        <button
          className={BUTTON_CLASSES}
          onClick={() => report && downloadJson(`game-profile-${Date.now()}.json`, report)}
          disabled={!report}
        >
          Download JSON
        </button>
        <button className={BUTTON_CLASSES} onClick={startBenchmark} disabled={!runBenchmark || isBenchmarkRunning}>
          {isBenchmarkRunning
            ? `Benchmark ${((performance.now() - (benchmarkStartedAtMs ?? 0)) / 1000).toFixed(0)}s...`
            : "Run benchmark"}
        </button>
        <label className="ml-1 flex items-center gap-1 text-zinc-400" title="Splits the render into sky / opaque / transparent / overlay GPU queries; slightly distorts CPU render time">
          <input
            type="checkbox"
            checked={isPassBreakdownOn}
            onChange={(event) => {
              profiler.settings.gpuPassBreakdown = event.target.checked;
              setIsPassBreakdownOn(event.target.checked);
            }}
          />
          GPU pass split
        </label>
        <label className="flex items-center gap-1 text-zinc-400" title="Captures a timeline of spans while on; restarts call trees when toggled">
          <input type="checkbox" checked={isTracing} onChange={(event) => toggleTrace(event.target.checked)} />
          Trace
        </label>
        {isTracing && getOptionalProfilerApi().saveTrace ? (
          <button className={BUTTON_CLASSES} onClick={saveTrace}>
            Save trace
          </button>
        ) : null}
        <span className="ml-auto text-zinc-500">{isRecording ? "recording" : "paused"} {statusText}</span>
      </div>
      <div className="flex flex-wrap border-b border-zinc-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2 py-1 ${tab.id === activeTab ? "bg-zinc-800 text-cyan-300" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {report ? <activeDefinition.Component report={report} /> : <div className="p-2 text-zinc-500">collecting...</div>}
      </div>
    </div>
  );
}
