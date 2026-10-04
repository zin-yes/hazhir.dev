import { describe, expect, test } from "bun:test";
import { mainCallTreeWithDroppedParent, meshWorkerCallTree } from "./call-tree.test-helper";
import {
  buildCallTreeModel,
  findHottestPathPaths,
  flattenVisibleRows,
  listTopSelfNodes,
  resolveSelectedTree,
} from "./call-tree-model";

describe("buildCallTreeModel", () => {
  const model = buildCallTreeModel(meshWorkerCallTree());

  test("totals the top-level scopes and reports shares of root and parent", () => {
    expect(model.totalMs).toBe(80);
    const scan = model.nodeByPath.get("scan")!;
    expect(scan.fractionOfRoot).toBeCloseTo(0.5);
    const faceLoop = model.nodeByPath.get("scan>faceLoop")!;
    expect(faceLoop.fractionOfParent).toBeCloseTo(0.6);
    expect(faceLoop.fractionOfRoot).toBeCloseTo(0.3);
    expect(faceLoop.depth).toBe(1);
  });

  test("keeps the same leaf name under different parents as separate nodes", () => {
    const scanLookup = model.nodeByPath.get("scan>lookup")!;
    const packLookup = model.nodeByPath.get("pack>lookup")!;
    expect(scanLookup).not.toBe(packLookup);
    expect(scanLookup.name).toBe("lookup");
    expect(packLookup.inclusiveMs).toBe(26);
    expect(scanLookup.meanMsPerCall).toBeCloseTo(10 / 4000);
  });

  test("sorts siblings by inclusive time, or by self time on request", () => {
    expect(model.root.children.map((child) => child.name)).toEqual(["scan", "pack", "light"]);
    expect(model.nodeByPath.get("scan")!.children.map((child) => child.name)).toEqual(["faceLoop", "lookup"]);

    const bySelf = buildCallTreeModel(meshWorkerCallTree(), "self");
    expect(bySelf.root.children.map((child) => child.name)).toEqual(["light", "scan", "pack"]);
    expect(bySelf.nodeByPath.get("scan")!.children.map((child) => child.name)).toEqual(["faceLoop", "lookup"]);
  });

  test("carries the estimated flag only on sampled nodes", () => {
    expect(model.nodeByPath.get("scan>faceLoop")!.estimated).toBe(true);
    expect(model.nodeByPath.get("scan>lookup")!.estimated).toBe(false);
  });

  test("attaches a node under its nearest surviving ancestor when a parent was dropped", () => {
    const droppedModel = buildCallTreeModel(mainCallTreeWithDroppedParent());
    const orphan = droppedModel.nodeByPath.get("frame>render>upload>buffer")!;
    expect(droppedModel.nodeByPath.get("frame>render")!.children).toContain(orphan);
    expect(orphan.depth).toBe(2);
  });
});

describe("findHottestPathPaths", () => {
  test("follows the largest child at each level", () => {
    const model = buildCallTreeModel(meshWorkerCallTree());
    expect(findHottestPathPaths(model)).toEqual(["scan", "scan>faceLoop"]);
  });

  test("follows self-time ranking when the tree is ranked by self time", () => {
    const model = buildCallTreeModel(meshWorkerCallTree(), "self");
    expect(findHottestPathPaths(model)).toEqual(["light"]);
  });
});

describe("listTopSelfNodes", () => {
  test("ranks nodes by self time across parents", () => {
    const model = buildCallTreeModel(meshWorkerCallTree());
    const top = listTopSelfNodes(model, 3);
    expect(top.map((entry) => entry.path)).toEqual(["pack>lookup", "scan>faceLoop", "scan>lookup"]);
    expect(top[0].fractionOfRoot).toBeCloseTo(26 / 80);
  });
});

describe("flattenVisibleRows", () => {
  const model = buildCallTreeModel(meshWorkerCallTree());

  test("shows only top-level rows until a node is expanded", () => {
    const collapsed = flattenVisibleRows(model, new Set(), "");
    expect(collapsed.map((row) => row.node.path)).toEqual(["scan", "pack", "light"]);
    expect(collapsed[0].hasChildren).toBe(true);
    expect(collapsed[2].hasChildren).toBe(false);

    const expanded = flattenVisibleRows(model, new Set(["scan"]), "");
    expect(expanded.map((row) => row.node.path)).toEqual(["scan", "scan>faceLoop", "scan>lookup", "pack", "light"]);
  });

  test("search keeps matches and their ancestors, opened, and hides everything else", () => {
    const rows = flattenVisibleRows(model, new Set(), "LOOKUP");
    expect(rows.map((row) => row.node.path)).toEqual(["scan", "scan>lookup", "pack", "pack>lookup"]);
    expect(rows[0].isExpanded).toBe(true);
  });

  test("search matches the full path, so a parent name reveals its children", () => {
    const rows = flattenVisibleRows(model, new Set(), "pack");
    expect(rows.map((row) => row.node.path)).toEqual(["pack", "pack>lookup"]);
  });
});

describe("resolveSelectedTree", () => {
  const trees = [meshWorkerCallTree(), mainCallTreeWithDroppedParent()];

  test("honors the pick, otherwise main, otherwise the busiest tree", () => {
    expect(resolveSelectedTree(trees, "mesh.generateMesh")?.root).toBe("mesh.generateMesh");
    expect(resolveSelectedTree(trees, "gone.method")?.root).toBe("main");
    expect(resolveSelectedTree([trees[0], { ...trees[0], root: "light.relight", nodes: trees[0].nodes.slice(0, 1) }], null)?.root).toBe(
      "mesh.generateMesh",
    );
    expect(resolveSelectedTree([], null)).toBeNull();
  });
});
