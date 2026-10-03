import {
  LIGHT_EDIT_KINDS,
  LIGHT_EDIT_METRICS,
  type LightEditKind,
} from "./light-trace";
import type { ProfileSnapshot, TimerSummary } from "./types";

export interface LightStageRow {
  name: string;
  timer: TimerSummary;
  /** Mean stage time as a share of the mean end to end time. Stages can overlap, so shares can exceed 100% together. */
  shareOfTotalPercent: number;
}

export interface LightEditRow {
  kind: LightEditKind;
  total: TimerSummary;
  firstMesh: TimerSummary | null;
  relight: TimerSummary | null;
  remesh: TimerSummary | null;
  stages: LightStageRow[];
  counters: { name: string; total: number; perEdit: number }[];
}

/** Joins every light.edit.* and light.stage.* metric into one row per edit kind. */
export function buildLightEditRows(snapshot: ProfileSnapshot): LightEditRow[] {
  const timersByName = new Map(
    snapshot.timers.map((timer) => [timer.name, timer]),
  );
  const rows: LightEditRow[] = [];

  for (const kind of LIGHT_EDIT_KINDS) {
    const total = timersByName.get(LIGHT_EDIT_METRICS.total(kind));
    if (!total || total.count === 0) continue;

    const stagePrefix = LIGHT_EDIT_METRICS.stage(kind, "");
    const stages = snapshot.timers
      .filter((timer) => timer.name.startsWith(stagePrefix))
      .map((timer) => ({
        name: timer.name.slice(stagePrefix.length),
        timer,
        shareOfTotalPercent:
          total.mean > 0 ? (timer.mean / total.mean) * 100 : 0,
      }))
      .sort((first, second) => second.timer.mean - first.timer.mean);

    const counterPrefix = `light.edit.${kind}.`;
    const counters = snapshot.counters
      .filter((counter) => counter.name.startsWith(counterPrefix))
      .map((counter) => ({
        name: counter.name.slice(counterPrefix.length),
        total: counter.total,
        perEdit: counter.total / total.count,
      }));

    rows.push({
      kind,
      total,
      firstMesh: timersByName.get(LIGHT_EDIT_METRICS.firstMesh(kind)) ?? null,
      relight: timersByName.get(LIGHT_EDIT_METRICS.relight(kind)) ?? null,
      remesh: timersByName.get(LIGHT_EDIT_METRICS.remesh(kind)) ?? null,
      stages,
      counters,
    });
  }
  return rows;
}
