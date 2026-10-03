import type { Profiler } from "./profiler";

/**
 * What a block edit does to light, which decides the work it triggers:
 * placing or breaking a light source relights the surroundings, any other
 * edit only changes what sky light and nearby blocks let through.
 */
export type LightEditKind =
  "blockPlace" | "blockBreak" | "lightPlace" | "lightBreak";

export const LIGHT_EDIT_KINDS: LightEditKind[] = [
  "lightPlace",
  "lightBreak",
  "blockPlace",
  "blockBreak",
];

export function classifyLightEdit(
  oldBlockEmission: number,
  newBlockEmission: number,
  newBlockIsAir: boolean,
): LightEditKind {
  if (newBlockEmission > 0) return "lightPlace";
  if (oldBlockEmission > 0) return "lightBreak";
  return newBlockIsAir ? "blockBreak" : "blockPlace";
}

export const LIGHT_EDIT_METRICS = {
  total: (kind: LightEditKind) => `light.edit.${kind}.total`,
  firstMesh: (kind: LightEditKind) => `light.edit.${kind}.firstMesh`,
  relight: (kind: LightEditKind) => `light.edit.${kind}.relight`,
  remesh: (kind: LightEditKind) => `light.edit.${kind}.remesh`,
  stage: (kind: LightEditKind, stage: string) => `light.stage.${kind}.${stage}`,
};

/**
 * Follows one block edit from the click to the last re-meshed chunk on screen,
 * splitting the wall-clock time into the stages the light pipeline goes through.
 * Everything is a no-op for the profiler while it is disabled, but the trace
 * still tracks its mesh promises so callers can await them.
 */
export class LightEditTrace {
  private readonly startedAtMs: number;
  private relitAtMs: number | null = null;
  private firstMeshAtMs: number | null = null;
  private lastMeshAtMs: number | null = null;
  private readonly pendingMeshes: Promise<unknown>[] = [];

  constructor(
    private readonly profilerInstance: Profiler,
    readonly kind: LightEditKind,
  ) {
    this.startedAtMs = profilerInstance.now();
  }

  /** Times one stage of the pipeline, in wall-clock milliseconds. */
  async stage<Result>(
    name: string,
    work: () => Result | Promise<Result>,
  ): Promise<Result> {
    const stageStartedAtMs = this.profilerInstance.now();
    try {
      return await work();
    } finally {
      this.profilerInstance.recordTimer(
        LIGHT_EDIT_METRICS.stage(this.kind, name),
        this.profilerInstance.now() - stageStartedAtMs,
        "light",
      );
    }
  }

  /** Light data for every affected chunk is final; meshing is what remains. */
  markRelit() {
    if (this.relitAtMs === null) this.relitAtMs = this.profilerInstance.now();
  }

  count(name: string, amount = 1) {
    this.profilerInstance.addCounter(`light.edit.${this.kind}.${name}`, amount);
  }

  trackMesh(meshApplied: Promise<unknown>) {
    this.pendingMeshes.push(
      meshApplied.then(() => {
        const nowMs = this.profilerInstance.now();
        this.firstMeshAtMs ??= nowMs;
        this.lastMeshAtMs = nowMs;
      }),
    );
  }

  /** Resolves once every tracked mesh is on screen, then records the end to end timers. */
  async finish() {
    this.markRelit();
    await Promise.all(this.pendingMeshes);
    const { kind, profilerInstance: recorder } = this;
    const endedAtMs = this.lastMeshAtMs ?? this.relitAtMs ?? recorder.now();
    recorder.recordTimer(
      LIGHT_EDIT_METRICS.total(kind),
      endedAtMs - this.startedAtMs,
      "light",
    );
    recorder.recordTimer(
      LIGHT_EDIT_METRICS.relight(kind),
      (this.relitAtMs ?? endedAtMs) - this.startedAtMs,
      "light",
    );
    if (this.firstMeshAtMs !== null) {
      recorder.recordTimer(
        LIGHT_EDIT_METRICS.firstMesh(kind),
        this.firstMeshAtMs - this.startedAtMs,
        "light",
      );
      recorder.recordTimer(
        LIGHT_EDIT_METRICS.remesh(kind),
        endedAtMs - (this.relitAtMs ?? this.startedAtMs),
        "light",
      );
    }
    this.count("meshes", this.pendingMeshes.length);
  }
}
