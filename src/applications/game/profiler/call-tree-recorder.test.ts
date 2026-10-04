import { describe, expect, test } from "bun:test";
import { CallTreeRecorder, OVERFLOW_KEY } from "./call-tree-recorder";

function fakeClock() {
  let nowMs = 0;
  return { now: () => nowMs, advance: (ms: number) => (nowMs += ms) };
}

describe("CallTreeRecorder", () => {
  test("splits inclusive and self time by call path", () => {
    const clock = fakeClock();
    const recorder = new CallTreeRecorder(clock.now);
    recorder.begin("generate");
    clock.advance(2);
    recorder.begin("noise");
    clock.advance(5);
    recorder.end();
    recorder.begin("noise");
    clock.advance(3);
    recorder.end();
    clock.advance(1);
    recorder.end();

    const nodes = Object.fromEntries(
      recorder.toCallTree("task", "worker").nodes.map((node) => [node.path, node]),
    );
    expect(nodes["generate"]).toMatchObject({ calls: 1, totalMs: 11, selfMs: 3 });
    expect(nodes["generate>noise"]).toMatchObject({ calls: 2, totalMs: 8, selfMs: 8, maxMs: 5 });
  });

  test("keeps the same name under different parents apart", () => {
    const clock = fakeClock();
    const recorder = new CallTreeRecorder(clock.now);
    for (const parent of ["carve", "surface"]) {
      recorder.begin(parent);
      recorder.begin("lookup");
      clock.advance(parent === "carve" ? 4 : 1);
      recorder.end();
      recorder.end();
    }
    const paths = recorder.toCallTree("task", "worker").nodes.map((node) => node.path);
    expect(paths).toContain("carve>lookup");
    expect(paths).toContain("surface>lookup");
  });

  test("attributes tagged section self time to a breakdown key", () => {
    const clock = fakeClock();
    const recorder = new CallTreeRecorder(clock.now);
    recorder.begin("feature.place", "worldgen.feature", "oak_tree");
    clock.advance(6);
    recorder.end();
    recorder.begin("feature.place", "worldgen.feature", "oak_tree");
    clock.advance(2);
    recorder.end();
    recorder.begin("feature.place", "worldgen.feature", "ore_coal");
    clock.advance(1);
    recorder.end();
    recorder.addKeyed("worldgen.feature", "oak_tree", { units: 40 });

    const [summary] = recorder.toBreakdowns("worker");
    expect(summary.entries[0]).toMatchObject({ key: "oak_tree", calls: 2, selfMs: 8, units: 40 });
    expect(summary.totalSelfMs).toBe(9);
  });

  test("folds keys past the cap into one overflow entry without losing totals", () => {
    const recorder = new CallTreeRecorder(fakeClock().now, { maxKeysPerDimension: 3 });
    for (let index = 0; index < 10; index++) {
      recorder.addKeyed("block.type", `block_${index}`, { units: 5 });
    }
    const [summary] = recorder.toBreakdowns("worker");
    expect(summary.entries.length).toBe(4);
    expect(summary.entries.find((entry) => entry.key === OVERFLOW_KEY)?.units).toBe(35);
    expect(summary.totalUnits).toBe(50);
    expect(summary.droppedKeys).toBe(7);
  });

  test("sampled sections count every call and estimate the untimed ones from the mean", () => {
    const clock = fakeClock();
    const recorder = new CallTreeRecorder(clock.now);
    for (let call = 0; call < 100; call++) {
      recorder.begin("density.sample", undefined, undefined, 10);
      clock.advance(2);
      recorder.end();
    }
    const [node] = recorder.toCallTree("task", "worker").nodes;
    expect(node.calls).toBe(100);
    expect(node.estimated).toBe(true);
    expect(node.totalMs).toBeCloseTo(200, 5);
  });

  test("a sampled child inside a timed parent does not push parent self time negative", () => {
    const clock = fakeClock();
    const recorder = new CallTreeRecorder(clock.now);
    recorder.begin("parent");
    for (let call = 0; call < 50; call++) {
      recorder.begin("child", undefined, undefined, 5);
      clock.advance(1);
      recorder.end();
    }
    recorder.end();
    const nodes = Object.fromEntries(
      recorder.toCallTree("task", "worker").nodes.map((node) => [node.path, node]),
    );
    expect(nodes["parent"].selfMs).toBeGreaterThanOrEqual(0);
    expect(nodes["parent>child"].totalMs).toBeCloseTo(50, 5);
  });

  test("captures spans only when a span budget is set and counts drops", () => {
    const clock = fakeClock();
    const recorder = new CallTreeRecorder(clock.now, { maxSpans: 2 });
    for (let call = 0; call < 5; call++) {
      recorder.begin("step");
      clock.advance(1);
      recorder.end();
    }
    const { spans, droppedSpans } = recorder.takeSpans();
    expect(spans.length).toBe(2);
    expect(droppedSpans).toBe(3);
    expect(spans[1].startMs).toBe(1);
  });

  test("merging a tree twice doubles calls and time", () => {
    const clock = fakeClock();
    const source = new CallTreeRecorder(clock.now);
    source.begin("a");
    source.begin("b");
    clock.advance(4);
    source.end();
    source.end();
    const nodes = source.toCallTree("task", "worker").nodes;

    const target = new CallTreeRecorder(clock.now);
    target.mergeNodes(nodes);
    target.mergeNodes(nodes);
    const merged = target.toCallTree("task", "worker").nodes.find((node) => node.path === "a>b");
    expect(merged).toMatchObject({ calls: 2, totalMs: 8 });
  });
});
