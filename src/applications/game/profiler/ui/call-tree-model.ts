import type { CallTree, CallTreeNode } from "../types";

export type RankingMode = "inclusive" | "self";

export interface CallTreeModelNode {
  path: string;
  name: string;
  /** Root node is -1; its children are 0. */
  depth: number;
  calls: number;
  inclusiveMs: number;
  selfMs: number;
  maxMs: number;
  estimated: boolean;
  fractionOfRoot: number;
  fractionOfParent: number;
  meanMsPerCall: number;
  children: CallTreeModelNode[];
}

export interface CallTreeModel {
  /** Synthetic node named after the tree root whose children are the top-level scopes. */
  root: CallTreeModelNode;
  totalMs: number;
  nodeCount: number;
  nodeByPath: Map<string, CallTreeModelNode>;
}

export const CALL_PATH_SEPARATOR = ">";

function nameOfPath(path: string): string {
  const lastSeparatorIndex = path.lastIndexOf(CALL_PATH_SEPARATOR);
  return lastSeparatorIndex === -1 ? path : path.slice(lastSeparatorIndex + 1);
}

function createModelNode(source: CallTreeNode): CallTreeModelNode {
  return {
    path: source.path,
    name: nameOfPath(source.path),
    depth: 0,
    calls: source.calls,
    inclusiveMs: source.totalMs,
    selfMs: source.selfMs,
    maxMs: source.maxMs,
    estimated: source.estimated,
    fractionOfRoot: 0,
    fractionOfParent: 0,
    meanMsPerCall: source.calls > 0 ? source.totalMs / source.calls : 0,
    children: [],
  };
}

/** Nearest ancestor path that exists; nodes whose parent was dropped by the node cap attach higher up. */
function findExistingAncestorPath(path: string, nodeByPath: Map<string, CallTreeModelNode>): string {
  let candidate = path;
  while (true) {
    const lastSeparatorIndex = candidate.lastIndexOf(CALL_PATH_SEPARATOR);
    if (lastSeparatorIndex === -1) return "";
    candidate = candidate.slice(0, lastSeparatorIndex);
    if (nodeByPath.has(candidate)) return candidate;
  }
}

export function compareByRanking(ranking: RankingMode) {
  return (first: CallTreeModelNode, second: CallTreeModelNode) =>
    ranking === "self" ? second.selfMs - first.selfMs : second.inclusiveMs - first.inclusiveMs;
}

function finalizeNode(node: CallTreeModelNode, parent: CallTreeModelNode | null, totalMs: number, ranking: RankingMode) {
  node.depth = parent ? parent.depth + 1 : -1;
  node.fractionOfRoot = totalMs > 0 ? node.inclusiveMs / totalMs : 0;
  node.fractionOfParent = parent && parent.inclusiveMs > 0 ? node.inclusiveMs / parent.inclusiveMs : 0;
  node.children.sort(compareByRanking(ranking));
  for (const child of node.children) finalizeNode(child, node, totalMs, ranking);
}

export function buildCallTreeModel(callTree: CallTree, ranking: RankingMode = "inclusive"): CallTreeModel {
  const nodeByPath = new Map<string, CallTreeModelNode>();
  for (const source of callTree.nodes) nodeByPath.set(source.path, createModelNode(source));

  const root: CallTreeModelNode = {
    path: "",
    name: callTree.root,
    depth: -1,
    calls: 0,
    inclusiveMs: 0,
    selfMs: 0,
    maxMs: 0,
    estimated: false,
    fractionOfRoot: 1,
    fractionOfParent: 1,
    meanMsPerCall: 0,
    children: [],
  };

  for (const node of nodeByPath.values()) {
    const parentPath = findExistingAncestorPath(node.path, nodeByPath);
    const parent = parentPath === "" ? root : (nodeByPath.get(parentPath) as CallTreeModelNode);
    parent.children.push(node);
  }

  root.inclusiveMs = root.children.reduce((sum, child) => sum + child.inclusiveMs, 0);
  root.calls = root.children.reduce((sum, child) => sum + child.calls, 0);
  const totalMs = root.inclusiveMs;
  finalizeNode(root, null, totalMs, ranking);
  root.fractionOfParent = 1;
  root.fractionOfRoot = 1;

  return { root, totalMs, nodeCount: nodeByPath.size, nodeByPath };
}

/** Paths to open so the chain of largest children (by the active ranking) is visible down to a leaf. */
export function findHottestPathPaths(model: CallTreeModel): string[] {
  const paths: string[] = [];
  let current = model.root.children[0];
  while (current) {
    paths.push(current.path);
    current = current.children[0];
  }
  return paths;
}

export interface TopSelfEntry {
  path: string;
  name: string;
  selfMs: number;
  calls: number;
  estimated: boolean;
  fractionOfRoot: number;
}

/** Every node ranked by self time, so a helper called from many parents is easy to see on its own row. */
export function listTopSelfNodes(model: CallTreeModel, limit: number): TopSelfEntry[] {
  return [...model.nodeByPath.values()]
    .filter((node) => node.selfMs > 0)
    .sort((first, second) => second.selfMs - first.selfMs)
    .slice(0, limit)
    .map((node) => ({
      path: node.path,
      name: node.name,
      selfMs: node.selfMs,
      calls: node.calls,
      estimated: node.estimated,
      fractionOfRoot: model.totalMs > 0 ? node.selfMs / model.totalMs : 0,
    }));
}

export interface VisibleCallTreeRow {
  node: CallTreeModelNode;
  hasChildren: boolean;
  isExpanded: boolean;
}

function matchesQuery(node: CallTreeModelNode, loweredQuery: string): boolean {
  return node.path.toLowerCase().includes(loweredQuery);
}

function subtreeHasMatch(node: CallTreeModelNode, loweredQuery: string): boolean {
  if (matchesQuery(node, loweredQuery)) return true;
  return node.children.some((child) => subtreeHasMatch(child, loweredQuery));
}

/**
 * Flattens the tree into the rows to draw. With a search query, only matching
 * nodes and their ancestors are kept and ancestors are shown open.
 */
export function flattenVisibleRows(
  model: CallTreeModel,
  expandedPaths: ReadonlySet<string>,
  searchQuery: string,
): VisibleCallTreeRow[] {
  const loweredQuery = searchQuery.trim().toLowerCase();
  const isSearching = loweredQuery.length > 0;
  const rows: VisibleCallTreeRow[] = [];

  const visit = (node: CallTreeModelNode) => {
    const visibleChildren = isSearching
      ? node.children.filter((child) => subtreeHasMatch(child, loweredQuery))
      : node.children;
    const isExpanded = isSearching ? visibleChildren.length > 0 : expandedPaths.has(node.path);
    rows.push({ node, hasChildren: node.children.length > 0, isExpanded });
    if (isExpanded) for (const child of visibleChildren) visit(child);
  };

  for (const topLevelNode of model.root.children) {
    if (isSearching && !subtreeHasMatch(topLevelNode, loweredQuery)) continue;
    visit(topLevelNode);
  }
  return rows;
}

function topLevelTotalMs(callTree: CallTree): number {
  return callTree.nodes.filter((node) => !node.path.includes(CALL_PATH_SEPARATOR)).reduce((sum, node) => sum + node.totalMs, 0);
}

/** The picked root if it still exists, else `main`, else the tree with the most time. */
export function resolveSelectedTree(callTrees: CallTree[], selectedRoot: string | null): CallTree | null {
  const selected = callTrees.find((callTree) => callTree.root === selectedRoot);
  if (selected) return selected;
  const main = callTrees.find((callTree) => callTree.root === "main");
  if (main) return main;
  return [...callTrees].sort((first, second) => topLevelTotalMs(second) - topLevelTotalMs(first))[0] ?? null;
}
