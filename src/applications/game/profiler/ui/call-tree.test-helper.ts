import type { CallTree, CallTreeNode } from "../types";

function node(path: string, calls: number, totalMs: number, selfMs: number, estimated = false): CallTreeNode {
  return { path, calls, totalMs, selfMs, maxMs: totalMs / calls, estimated };
}

/** A worker mesh task: the same `lookup` leaf under two parents and a sampled hot loop. */
export function meshWorkerCallTree(): CallTree {
  return {
    root: "mesh.generateMesh",
    thread: "worker",
    droppedNodes: 0,
    nodes: [
      node("scan", 100, 40, 6),
      node("scan>lookup", 4000, 10, 10),
      node("scan>faceLoop", 100, 24, 24, true),
      node("pack", 100, 30, 4),
      node("pack>lookup", 3000, 26, 26),
      node("light", 100, 10, 10),
    ],
  };
}

/** Main thread tree where a deep node's parent was dropped by the node cap. */
export function mainCallTreeWithDroppedParent(): CallTree {
  return {
    root: "main",
    thread: "main",
    droppedNodes: 1,
    nodes: [
      node("frame", 60, 600, 100),
      node("frame>render", 60, 400, 150),
      node("frame>render>upload>buffer", 60, 250, 250),
    ],
  };
}
