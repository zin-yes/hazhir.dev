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

export interface LoadSnapshot {
  progress: number;
  label: string;
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

  constructor(private readonly onChange: (snapshot: LoadSnapshot) => void) {}

  report(stageId: LoadStageId, fraction: number) {
    const clamped = Math.min(1, Math.max(0, fraction));
    this.fractions[stageId] = Math.max(this.fractions[stageId], clamped);
    this.onChange(this.snapshot());
  }

  resetWorldStages() {
    WORLD_STAGE_IDS.forEach((stageId) => {
      this.fractions[stageId] = 0;
    });
    this.onChange(this.snapshot());
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
    return { progress: Math.min(1, progress), label };
  }
}
