import { OVERFLOW_KEY, OVERFLOW_NODE_NAME } from "./call-tree-recorder";
import type {
  BreakdownEntry,
  BreakdownSummary,
  CallTree,
  CallTreeNode,
  ProfileSnapshot,
} from "./types";

/**
 * Pure analysis of call trees and breakdowns shared by the markdown report,
 * the ranked targets and the hints, so all three agree on what "root",
 * "self share" and "unattributed" mean.
 */

export const PATH_SEPARATOR = ">";
export const CROSS_KEY_SEPARATOR = "|";

export function pathDepth(path: string): number {
  let depth = 0;
  let separatorIndex = path.indexOf(PATH_SEPARATOR);
  while (separatorIndex !== -1) {
    depth++;
    separatorIndex = path.indexOf(PATH_SEPARATOR, separatorIndex + 1);
  }
  return depth;
}

export function parentPath(path: string): string {
  const separatorIndex = path.lastIndexOf(PATH_SEPARATOR);
  return separatorIndex === -1 ? "" : path.slice(0, separatorIndex);
}

export function leafName(path: string): string {
  return path.slice(path.lastIndexOf(PATH_SEPARATOR) + 1);
}

export function isOverflowNode(node: CallTreeNode): boolean {
  return leafName(node.path) === OVERFLOW_NODE_NAME;
}

interface TreeRootTotals {
  allTopLevelMs: number;
  topLevelMsByName: Map<string, number>;
}

/** Snapshot trees never change, so each tree's top-level totals are computed once, however many nodes ask. */
const rootTotalsByTree = new WeakMap<CallTree, TreeRootTotals>();

function rootTotalsOf(tree: CallTree): TreeRootTotals {
  const cached = rootTotalsByTree.get(tree);
  if (cached) return cached;
  const topLevelMsByName = new Map<string, number>();
  let allTopLevelMs = 0;
  for (const node of tree.nodes) {
    if (pathDepth(node.path) !== 0) continue;
    allTopLevelMs += node.totalMs;
    if (!topLevelMsByName.has(node.path)) topLevelMsByName.set(node.path, node.totalMs);
  }
  const totals = { allTopLevelMs, topLevelMsByName };
  rootTotalsByTree.set(tree, totals);
  return totals;
}

/** Sum of the inclusive time of the top-level nodes: everything the tree accounts for. */
export function treeTotalMs(tree: CallTree): number {
  return rootTotalsOf(tree).allTopLevelMs;
}

/**
 * The time a node is a share of. A worker tree is one task, so its root is the
 * whole tree. Main-thread top-level scopes are independent, so the root is the
 * top-level scope the node sits under.
 */
export function rootTotalMsForNode(tree: CallTree, node: CallTreeNode): number {
  if (tree.thread === "worker") return treeTotalMs(tree);
  const firstSeparatorIndex = node.path.indexOf(PATH_SEPARATOR);
  const topLevelName = firstSeparatorIndex === -1 ? node.path : node.path.slice(0, firstSeparatorIndex);
  return rootTotalsOf(tree).topLevelMsByName.get(topLevelName) ?? 0;
}

export function percentOf(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

export interface CallTreeRow {
  node: CallTreeNode;
  depth: number;
  percentOfRoot: number;
}

export interface CallTreeView {
  rows: CallTreeRow[];
  omittedNodes: number;
}

/**
 * Pre-order rows for printing: children sorted by inclusive time, limited in
 * depth and, by taking the heaviest nodes first, in total size.
 */
export function selectCallTreeRows(
  tree: CallTree,
  limits: { maxDepth: number; maxNodes: number },
): CallTreeView {
  const childrenByParent = new Map<string, CallTreeNode[]>();
  for (const node of tree.nodes) {
    const parent = parentPath(node.path);
    const siblings = childrenByParent.get(parent);
    if (siblings) siblings.push(node);
    else childrenByParent.set(parent, [node]);
  }
  childrenByParent.forEach((siblings) => siblings.sort((first, second) => second.totalMs - first.totalMs));

  const included = new Set<string>();
  const frontier: CallTreeNode[] = [...(childrenByParent.get("") ?? [])];
  while (frontier.length > 0 && included.size < limits.maxNodes) {
    let heaviestIndex = 0;
    for (let index = 1; index < frontier.length; index++) {
      if (frontier[index].totalMs > frontier[heaviestIndex].totalMs) heaviestIndex = index;
    }
    const [heaviest] = frontier.splice(heaviestIndex, 1);
    included.add(heaviest.path);
    if (pathDepth(heaviest.path) + 1 >= limits.maxDepth) continue;
    frontier.push(...(childrenByParent.get(heaviest.path) ?? []));
  }

  const rows: CallTreeRow[] = [];
  const visit = (currentParentPath: string) => {
    for (const node of childrenByParent.get(currentParentPath) ?? []) {
      if (!included.has(node.path)) continue;
      rows.push({
        node,
        depth: pathDepth(node.path),
        percentOfRoot: percentOf(node.totalMs, rootTotalMsForNode(tree, node)),
      });
      visit(node.path);
    }
  };
  visit("");
  return { rows, omittedNodes: tree.nodes.length - rows.length };
}

export interface SelfPathRow {
  node: CallTreeNode;
  percentOfTree: number;
  percentOfRoot: number;
}

export function topSelfTimePaths(tree: CallTree, count: number): SelfPathRow[] {
  const total = treeTotalMs(tree);
  return tree.nodes
    .filter((node) => node.selfMs > 0)
    .sort((first, second) => second.selfMs - first.selfMs)
    .slice(0, count)
    .map((node) => ({
      node,
      percentOfTree: percentOf(node.selfMs, total),
      percentOfRoot: percentOf(node.selfMs, rootTotalMsForNode(tree, node)),
    }));
}

export interface WorkerUnattributedGap {
  taskCount: number;
  execTotalMs: number;
  instrumentedMs: number;
  gapMs: number;
  gapShare: number;
}

/** Task execution time minus the time covered by instrumented root sections. */
export function workerUnattributedGap(
  snapshot: ProfileSnapshot,
  tree: CallTree,
): WorkerUnattributedGap | null {
  if (tree.thread !== "worker") return null;
  const execTimer = snapshot.timers.find((timer) => timer.name === `worker.${tree.root}.exec`);
  if (!execTimer || execTimer.total <= 0) return null;
  const instrumentedMs = treeTotalMs(tree);
  const gapMs = Math.max(0, execTimer.total - instrumentedMs);
  return {
    taskCount: execTimer.count,
    execTotalMs: execTimer.total,
    instrumentedMs,
    gapMs,
    gapShare: gapMs / execTimer.total,
  };
}

export function isCrossDimension(summary: BreakdownSummary): boolean {
  return summary.entries.some((entry) => entry.key.includes(CROSS_KEY_SEPARATOR));
}

export function isUnitsOnly(summary: BreakdownSummary): boolean {
  return summary.totalSelfMs <= 0;
}

export function rankedBreakdownEntries(summary: BreakdownSummary): BreakdownEntry[] {
  const unitsOnly = isUnitsOnly(summary);
  return [...summary.entries].sort((first, second) =>
    unitsOnly
      ? second.units - first.units
      : second.selfMs - first.selfMs || second.units - first.units,
  );
}

export function isOverflowKey(entry: BreakdownEntry): boolean {
  return entry.key === OVERFLOW_KEY;
}

export interface CrossMatrix {
  rowLabels: string[];
  columnLabels: string[];
  /** values[row][column], null where the pair has no entry. */
  values: (number | null)[][];
  metric: "selfMs" | "units";
}

export function buildCrossMatrix(
  summary: BreakdownSummary,
  limits: { maxRows: number; maxColumns: number },
): CrossMatrix {
  const metric = isUnitsOnly(summary) ? "units" : "selfMs";
  const cellByPair = new Map<string, number>();
  const rowTotals = new Map<string, number>();
  const columnTotals = new Map<string, number>();
  for (const entry of summary.entries) {
    const separatorIndex = entry.key.indexOf(CROSS_KEY_SEPARATOR);
    if (separatorIndex === -1) continue;
    const rowLabel = entry.key.slice(0, separatorIndex);
    const columnLabel = entry.key.slice(separatorIndex + 1);
    const value = entry[metric];
    cellByPair.set(entry.key, value);
    rowTotals.set(rowLabel, (rowTotals.get(rowLabel) ?? 0) + value);
    columnTotals.set(columnLabel, (columnTotals.get(columnLabel) ?? 0) + value);
  }
  const topLabels = (totals: Map<string, number>, limit: number) =>
    [...totals.entries()]
      .sort((first, second) => second[1] - first[1])
      .slice(0, limit)
      .map(([label]) => label);
  const rowLabels = topLabels(rowTotals, limits.maxRows);
  const columnLabels = topLabels(columnTotals, limits.maxColumns);
  const values = rowLabels.map((rowLabel) =>
    columnLabels.map(
      (columnLabel) => cellByPair.get(`${rowLabel}${CROSS_KEY_SEPARATOR}${columnLabel}`) ?? null,
    ),
  );
  return { rowLabels, columnLabels, values, metric };
}
