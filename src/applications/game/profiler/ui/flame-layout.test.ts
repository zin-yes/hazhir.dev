import { describe, expect, test } from "bun:test";
import { mainCallTreeWithDroppedParent, meshWorkerCallTree } from "./call-tree.test-helper";
import { buildCallTreeModel } from "./call-tree-model";
import { buildBreadcrumbs, ESTIMATED_BLOCK_COLOR, flameBlockColor, layoutFlame } from "./flame-layout";

describe("layoutFlame", () => {
  const model = buildCallTreeModel(meshWorkerCallTree());

  test("top-level blocks fill the width in proportion to inclusive time", () => {
    const layout = layoutFlame(model);
    const topLevel = layout.blocks.filter((block) => block.depth === 1);
    expect(topLevel.reduce((sum, block) => sum + block.width, 0)).toBeCloseTo(1);
    const scan = topLevel.find((block) => block.name === "scan")!;
    expect(scan.width).toBeCloseTo(0.5);
    expect(scan.x).toBe(0);
    expect(topLevel.find((block) => block.name === "pack")!.x).toBeCloseTo(0.5);
  });

  test("children never extend past their parent", () => {
    const layout = layoutFlame(model);
    const scan = layout.blocks.find((block) => block.path === "scan")!;
    const scanChildren = layout.blocks.filter((block) => block.path.startsWith("scan>"));
    const rightEdge = Math.max(...scanChildren.map((block) => block.x + block.width));
    expect(rightEdge).toBeLessThanOrEqual(scan.x + scan.width + 1e-9);
  });

  test("culls blocks narrower than the minimum along with their subtree", () => {
    const layout = layoutFlame(model, { minBlockWidthFraction: 0.2 });
    const paths = layout.blocks.map((block) => block.path);
    expect(paths).toContain("scan");
    expect(paths).toContain("scan>faceLoop");
    expect(paths).not.toContain("scan>lookup");
    expect(paths).not.toContain("light");
  });

  test("zooming makes the chosen subtree the full-width root and keeps shares relative to the whole tree", () => {
    const layout = layoutFlame(model, { zoomPath: "pack" });
    const zoomRoot = layout.blocks[0];
    expect(zoomRoot).toMatchObject({ path: "pack", depth: 0, x: 0, width: 1 });
    expect(zoomRoot.fractionOfRoot).toBeCloseTo(30 / 80);
    expect(layout.blocks.map((block) => block.path)).toEqual(["pack", "pack>lookup"]);
    expect(layout.blocks[1].width).toBeCloseTo(26 / 30);
    expect(layout.zoomInclusiveMs).toBe(30);
  });

  test("an unknown zoom path falls back to the whole tree", () => {
    expect(layoutFlame(model, { zoomPath: "missing" }).zoomPath).toBe("");
  });

  test("rescales children when estimated times add up to more than the parent", () => {
    const overshoot = buildCallTreeModel({
      root: "task",
      thread: "worker",
      droppedNodes: 0,
      nodes: [
        { path: "outer", calls: 1, totalMs: 10, selfMs: 0, maxMs: 10, estimated: false },
        { path: "outer>a", calls: 50, totalMs: 9, selfMs: 9, maxMs: 1, estimated: true },
        { path: "outer>b", calls: 50, totalMs: 9, selfMs: 9, maxMs: 1, estimated: true },
      ],
    });
    const blocks = layoutFlame(overshoot).blocks;
    const outer = blocks.find((block) => block.path === "outer")!;
    const children = blocks.filter((block) => block.depth === 2);
    expect(children.reduce((sum, block) => sum + block.width, 0)).toBeCloseTo(outer.width);
  });
});

describe("buildBreadcrumbs", () => {
  test("lists the tree root and each surviving ancestor down to the zoomed node", () => {
    const model = buildCallTreeModel(mainCallTreeWithDroppedParent());
    const crumbs = buildBreadcrumbs(model, "frame>render>upload>buffer");
    expect(crumbs.map((crumb) => crumb.path)).toEqual(["", "frame", "frame>render", "frame>render>upload>buffer"]);
    expect(crumbs[0].label).toBe("main");
  });

  test("is just the root when not zoomed", () => {
    const model = buildCallTreeModel(mainCallTreeWithDroppedParent());
    expect(buildBreadcrumbs(model, "")).toHaveLength(1);
  });
});

describe("flameBlockColor", () => {
  test("is stable per name and distinct for estimated nodes", () => {
    expect(flameBlockColor("faceLoop", false)).toBe(flameBlockColor("faceLoop", false));
    expect(flameBlockColor("faceLoop", true)).toBe(ESTIMATED_BLOCK_COLOR);
    expect(flameBlockColor("faceLoop", false)).not.toBe(ESTIMATED_BLOCK_COLOR);
    const colors = new Set(["scan", "pack", "light", "lookup", "faceLoop", "render", "upload"].map((name) => flameBlockColor(name, false)));
    expect(colors.size).toBeGreaterThan(2);
  });
});
