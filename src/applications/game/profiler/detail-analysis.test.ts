import { describe, expect, test } from "bun:test";
import {
  buildCrossMatrix,
  pathDepth,
  rootTotalMsForNode,
  rankedBreakdownEntries,
  selectCallTreeRows,
  topSelfTimePaths,
  treeTotalMs,
} from "./detail-analysis";
import type { BreakdownSummary, CallTree, CallTreeNode } from "./types";

function node(path: string, totalMs: number, selfMs: number, calls = 1): CallTreeNode {
  return { path, calls, totalMs, selfMs, maxMs: totalMs / calls, estimated: false };
}

function wideTree(): CallTree {
  const nodes: CallTreeNode[] = [node("root", 1000, 100)];
  for (let index = 0; index < 120; index++) {
    nodes.push(node(`root>child${index}`, 5 + (index % 7), 1));
  }
  nodes.push(node("root>heavy", 400, 50), node("root>heavy>deep", 300, 300), node("root>heavy>deep>deeper", 20, 20));
  return { root: "worldgen.test", thread: "worker", nodes, droppedNodes: 0 };
}

describe("selectCallTreeRows", () => {
  const tree = wideTree();

  test("keeps the node cap and reports how many nodes were left out", () => {
    const view = selectCallTreeRows(tree, { maxDepth: 8, maxNodes: 30 });
    expect(view.rows.length).toBe(30);
    expect(view.omittedNodes).toBe(tree.nodes.length - 30);
  });

  test("takes the heaviest nodes first and keeps every ancestor so the tree stays connected", () => {
    const view = selectCallTreeRows(tree, { maxDepth: 8, maxNodes: 5 });
    const paths = view.rows.map((row) => row.node.path);
    expect(paths).toEqual(["root", "root>heavy", "root>heavy>deep", "root>heavy>deep>deeper", expect.any(String)]);
  });

  test("lists children by inclusive time and limits depth", () => {
    const view = selectCallTreeRows(tree, { maxDepth: 3, maxNodes: 500 });
    expect(view.rows.map((row) => row.node.path)).not.toContain("root>heavy>deep>deeper");
    const rootChildren = view.rows.filter((row) => row.depth === 1).map((row) => row.node.totalMs);
    expect(rootChildren).toEqual([...rootChildren].sort((first, second) => second - first));
  });
});

describe("topSelfTimePaths", () => {
  test("orders by self time and expresses it as a share of the whole tree", () => {
    const rows = topSelfTimePaths(wideTree(), 3);
    expect(rows.map((row) => row.node.path)).toEqual(["root>heavy>deep", "root", "root>heavy"]);
    expect(rows[0].percentOfTree).toBeCloseTo(30, 5);
    expect(treeTotalMs(wideTree())).toBe(1000);
  });
});

describe("breakdown helpers", () => {
  const crossSummary: BreakdownSummary = {
    dimension: "worldgen.biomeStage",
    thread: "worker",
    totalSelfMs: 30,
    totalUnits: 0,
    droppedKeys: 0,
    entries: [
      { key: "forest|features", calls: 1, selfMs: 15, totalMs: 15, units: 0 },
      { key: "forest|noise", calls: 1, selfMs: 5, totalMs: 5, units: 0 },
      { key: "desert|noise", calls: 1, selfMs: 7, totalMs: 7, units: 0 },
      { key: "taiga|surface", calls: 1, selfMs: 3, totalMs: 3, units: 0 },
    ],
  };

  test("cross matrix splits keys on the first pipe and leaves unpaired cells empty", () => {
    const matrix = buildCrossMatrix(crossSummary, { maxRows: 2, maxColumns: 2 });
    expect(matrix.rowLabels).toEqual(["forest", "desert"]);
    expect(matrix.columnLabels).toEqual(["features", "noise"]);
    expect(matrix.values).toEqual([
      [15, 5],
      [null, 7],
    ]);
  });

  test("units-only dimensions rank by units, timed ones by self time", () => {
    const unitsOnly: BreakdownSummary = {
      dimension: "worldgen.block",
      thread: "worker",
      totalSelfMs: 0,
      totalUnits: 30,
      droppedKeys: 0,
      entries: [
        { key: "dirt", calls: 1, selfMs: 0, totalMs: 0, units: 10 },
        { key: "stone", calls: 1, selfMs: 0, totalMs: 0, units: 20 },
      ],
    };
    expect(rankedBreakdownEntries(unitsOnly).map((entry) => entry.key)).toEqual(["stone", "dirt"]);
    expect(rankedBreakdownEntries(crossSummary)[0].key).toBe("forest|features");
  });
});

describe("rootTotalMsForNode", () => {
  const mainTree: CallTree = {
    root: "main",
    thread: "main",
    nodes: [node("main.frame", 600, 100), node("main.frame>main.render", 400, 400), node("main.interval", 90, 90)],
    droppedNodes: 0,
  };

  test("on the main thread a node is a share of the top-level scope it sits under", () => {
    expect(rootTotalMsForNode(mainTree, mainTree.nodes[1])).toBe(600);
    expect(rootTotalMsForNode(mainTree, mainTree.nodes[2])).toBe(90);
  });

  test("in a worker tree every node is a share of all top-level time", () => {
    const workerTree: CallTree = { ...wideTree(), nodes: [...wideTree().nodes, node("second", 250, 250)] };
    expect(rootTotalMsForNode(workerTree, workerTree.nodes[1])).toBe(1250);
  });

  test("counts path depth by separators", () => {
    expect(pathDepth("a")).toBe(0);
    expect(pathDepth("a>b>c")).toBe(2);
  });
});
