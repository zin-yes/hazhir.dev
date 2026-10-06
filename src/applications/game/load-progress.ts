import { profiler } from "./profiler";

export type LoadStageId =
  | "threads"
  | "textures"
  | "terrain"
  | "lighting"
  | "light-spread"
  | "meshing";

interface LoadStage {
  id: LoadStageId;
  label: string;
  weight: number;
}

/** Weights roughly follow how long each stage takes in practice. */
export const LOAD_STAGES: LoadStage[] = [
  { id: "threads", label: "Starting threads", weight: 0.05 },
  { id: "textures", label: "Loading textures", weight: 0.2 },
  { id: "terrain", label: "Shaping terrain", weight: 0.25 },
  { id: "lighting", label: "Lighting the sky", weight: 0.1 },
  { id: "light-spread", label: "Spreading light", weight: 0.15 },
  { id: "meshing", label: "Building meshes", weight: 0.25 },
];

const WORLD_STAGE_IDS: LoadStageId[] = [
  "terrain",
  "lighting",
  "light-spread",
  "meshing",
];

const STAGE_FRACTION_GAUGES: { [stage in LoadStageId]: string } = {
  threads: "game.load.stageFraction.threads",
  textures: "game.load.stageFraction.textures",
  terrain: "game.load.stageFraction.terrain",
  lighting: "game.load.stageFraction.lighting",
  "light-spread": "game.load.stageFraction.lightSpread",
  meshing: "game.load.stageFraction.meshing",
};
const STAGE_DURATION_TIMERS: { [stage in LoadStageId]: string } = {
  threads: "latency.load.stage.threads",
  textures: "latency.load.stage.textures",
  terrain: "latency.load.stage.terrain",
  lighting: "latency.load.stage.lighting",
  "light-spread": "latency.load.stage.lightSpread",
  meshing: "latency.load.stage.meshing",
};

export interface LoadStageStatus {
  id: LoadStageId;
  label: string;
  fraction: number;
}

export interface LoadSnapshot {
  progress: number;
  label: string;
  stages: LoadStageStatus[];
}

/**
 * Tracks weighted progress across the real stages of getting a world on
 * screen. Boot stages (threads, textures) persist across worlds; world stages
 * reset each time a world is entered.
 */
export class LoadTracker {
  private fractions: Record<LoadStageId, number> = {
    threads: 0,
    textures: 0,
    terrain: 0,
    lighting: 0,
    "light-spread": 0,
    meshing: 0,
  };

  /** profiler.now() when each stage first reported progress, or undefined while it has not. */
  private stageStartedAtMs: { [stage in LoadStageId]?: number } = {};
  private worldLoadStartedAtMs: number | undefined;

  constructor(private readonly onChange: (snapshot: LoadSnapshot) => void) {}

  report(stageId: LoadStageId, fraction: number) {
    const reportToken = profiler.begin("main.load.report");
    const clamped = Math.min(1, Math.max(0, fraction));
    const previousFraction = this.fractions[stageId];
    this.fractions[stageId] = Math.max(previousFraction, clamped);
    this.recordStageProgress(stageId, previousFraction);
    this.notifyChange();
    profiler.end(reportToken);
  }

  /** The world is on screen, so nothing can still be pending. */
  finish() {
    const finishToken = profiler.begin("main.load.finish");
    LOAD_STAGES.forEach((stage) => {
      const previousFraction = this.fractions[stage.id];
      this.fractions[stage.id] = 1;
      this.recordStageProgress(stage.id, previousFraction);
    });
    profiler.addCounter("game.load.finishes");
    if (this.worldLoadStartedAtMs !== undefined) {
      profiler.recordTimer("latency.load.worldOnScreen", profiler.now() - this.worldLoadStartedAtMs, "latency");
      this.worldLoadStartedAtMs = undefined;
    }
    this.notifyChange();
    profiler.end(finishToken);
  }

  resetWorldStages() {
    WORLD_STAGE_IDS.forEach((stageId) => {
      this.fractions[stageId] = 0;
      delete this.stageStartedAtMs[stageId];
    });
    this.worldLoadStartedAtMs = undefined;
    profiler.addCounter("game.load.worldResets");
    this.notifyChange();
  }

  private notifyChange() {
    const snapshotToken = profiler.begin("main.load.snapshot");
    const snapshot = this.snapshot();
    profiler.end(snapshotToken);
    profiler.addCounter("game.load.snapshotsPublished");
    profiler.sampleGauge("game.load.progress", snapshot.progress, "fraction");
    const changeToken = profiler.begin("main.load.onChange");
    this.onChange(snapshot);
    profiler.end(changeToken);
  }

  /** Counts the report and times each stage from its first progress to completion. */
  private recordStageProgress(stageId: LoadStageId, previousFraction: number) {
    profiler.addCounter("game.load.reports");
    const fraction = this.fractions[stageId];
    if (fraction === previousFraction) {
      profiler.addCounter("game.load.reportsWithoutProgress");
      return;
    }
    profiler.sampleGauge(STAGE_FRACTION_GAUGES[stageId], fraction, "fraction");
    const nowMs = profiler.now();
    if (this.stageStartedAtMs[stageId] === undefined) this.stageStartedAtMs[stageId] = nowMs;
    if (WORLD_STAGE_IDS.includes(stageId) && this.worldLoadStartedAtMs === undefined) this.worldLoadStartedAtMs = nowMs;
    if (fraction === 1 && previousFraction < 1) {
      profiler.recordTimer(STAGE_DURATION_TIMERS[stageId], nowMs - this.stageStartedAtMs[stageId]!, "latency");
    }
  }

  snapshot(): LoadSnapshot {
    let progress = 0;
    let label = LOAD_STAGES[LOAD_STAGES.length - 1].label;
    let foundActiveStage = false;
    for (const stage of LOAD_STAGES) {
      progress += stage.weight * this.fractions[stage.id];
      if (!foundActiveStage && this.fractions[stage.id] < 1) {
        label = stage.label;
        foundActiveStage = true;
      }
    }
    return {
      progress: Math.min(1, progress),
      label,
      stages: LOAD_STAGES.map((stage) => ({
        id: stage.id,
        label: stage.label,
        fraction: this.fractions[stage.id],
      })),
    };
  }
}
