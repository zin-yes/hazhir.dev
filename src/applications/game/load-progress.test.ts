import { describe, expect, test } from "bun:test";
import { LOAD_STAGES, LoadTracker, type LoadSnapshot } from "./load-progress";

function createTracker() {
  const snapshots: LoadSnapshot[] = [];
  const tracker = new LoadTracker((snapshot) => snapshots.push(snapshot));
  return { tracker, snapshots };
}

describe("LoadTracker", () => {
  test("stage weights add up to a full bar", () => {
    const totalWeight = LOAD_STAGES.reduce((sum, stage) => sum + stage.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 10);
  });

  test("progress rises monotonically through every stage and only reaches 1 at the end", () => {
    const { tracker, snapshots } = createTracker();
    for (const stage of LOAD_STAGES) {
      for (let step = 1; step <= 10; step++) {
        tracker.report(stage.id, step / 10);
      }
    }
    for (let index = 1; index < snapshots.length; index++) {
      expect(snapshots[index].progress).toBeGreaterThanOrEqual(
        snapshots[index - 1].progress,
      );
    }
    expect(snapshots.slice(0, -1).every((s) => s.progress < 1)).toBe(true);
    expect(snapshots[snapshots.length - 1].progress).toBeCloseTo(1, 10);
  });

  test("labels the first unfinished stage", () => {
    const { tracker } = createTracker();
    tracker.report("threads", 1);
    tracker.report("textures", 0.4);
    expect(tracker.snapshot().label).toBe("Loading textures");
  });

  test("a second world keeps boot progress but restarts world stages", () => {
    const { tracker } = createTracker();
    LOAD_STAGES.forEach((stage) => tracker.report(stage.id, 1));
    tracker.resetWorldStages();
    expect(tracker.snapshot().progress).toBeCloseTo(0.25, 10);
    expect(tracker.snapshot().label).toBe("Shaping terrain");
  });

  test("a late lower report never moves a stage backwards", () => {
    const { tracker } = createTracker();
    tracker.report("terrain", 0.8);
    tracker.report("terrain", 0.3);
    expect(tracker.snapshot().progress).toBeCloseTo(0.25 * 0.8, 10);
  });
});
