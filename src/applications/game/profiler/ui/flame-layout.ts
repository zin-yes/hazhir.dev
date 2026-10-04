import type { CallTreeModel, CallTreeModelNode } from "./call-tree-model";

export interface FlameBlock {
  path: string;
  name: string;
  /** Rows below the zoom root; the zoom root is 0. */
  depth: number;
  /** Left edge and width as fractions of the full flame width. */
  x: number;
  width: number;
  calls: number;
  inclusiveMs: number;
  selfMs: number;
  estimated: boolean;
  /** Share of the whole call tree, not of the zoomed subtree. */
  fractionOfRoot: number;
}

export interface FlameLayout {
  blocks: FlameBlock[];
  maxDepth: number;
  zoomPath: string;
  zoomInclusiveMs: number;
}

export const DEFAULT_MIN_BLOCK_WIDTH_FRACTION = 0.002;

export interface LayoutFlameOptions {
  /** Path of the node to zoom into; empty or unknown means the whole tree. */
  zoomPath?: string;
  minBlockWidthFraction?: number;
}

/**
 * Icicle layout: the zoom root spans the full width, each child gets a width
 * proportional to its inclusive time, children of one parent never exceed the
 * parent, and blocks narrower than the minimum are culled with their subtree.
 */
export function layoutFlame(model: CallTreeModel, options: LayoutFlameOptions = {}): FlameLayout {
  const minBlockWidthFraction = options.minBlockWidthFraction ?? DEFAULT_MIN_BLOCK_WIDTH_FRACTION;
  const zoomNode = (options.zoomPath && model.nodeByPath.get(options.zoomPath)) || model.root;
  const blocks: FlameBlock[] = [];
  let maxDepth = 0;

  const place = (node: CallTreeModelNode, depth: number, x: number, width: number) => {
    blocks.push({
      path: node.path,
      name: node.name,
      depth,
      x,
      width,
      calls: node.calls,
      inclusiveMs: node.inclusiveMs,
      selfMs: node.selfMs,
      estimated: node.estimated,
      fractionOfRoot: node.fractionOfRoot,
    });
    maxDepth = Math.max(maxDepth, depth);

    const childrenInclusiveMs = node.children.reduce((sum, child) => sum + child.inclusiveMs, 0);
    const denominatorMs = Math.max(node.inclusiveMs, childrenInclusiveMs);
    if (denominatorMs <= 0) return;
    let childX = x;
    for (const child of node.children) {
      const childWidth = width * (child.inclusiveMs / denominatorMs);
      if (childWidth >= minBlockWidthFraction) place(child, depth + 1, childX, childWidth);
      childX += childWidth;
    }
  };

  place(zoomNode, 0, 0, 1);
  return { blocks, maxDepth, zoomPath: zoomNode.path, zoomInclusiveMs: zoomNode.inclusiveMs };
}

export interface FlameBreadcrumb {
  path: string;
  label: string;
}

/** Ancestors from the tree root down to the zoomed node, for the "back" breadcrumb. */
export function buildBreadcrumbs(model: CallTreeModel, zoomPath: string): FlameBreadcrumb[] {
  const breadcrumbs: FlameBreadcrumb[] = [{ path: "", label: model.root.name }];
  if (!zoomPath || !model.nodeByPath.has(zoomPath)) return breadcrumbs;
  const segments = zoomPath.split(">");
  let accumulatedPath = "";
  for (const segment of segments) {
    accumulatedPath = accumulatedPath ? `${accumulatedPath}>${segment}` : segment;
    if (model.nodeByPath.has(accumulatedPath)) breadcrumbs.push({ path: accumulatedPath, label: segment });
  }
  return breadcrumbs;
}

const FLAME_HUES = [199, 142, 38, 262, 330, 12, 172, 84, 224, 290, 52, 350];
export const ESTIMATED_BLOCK_COLOR = "hsl(220 8% 42%)";

function hashName(name: string): number {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable color per node name from a fixed palette; estimated nodes share one gray. */
export function flameBlockColor(name: string, estimated: boolean): string {
  if (estimated) return ESTIMATED_BLOCK_COLOR;
  const hue = FLAME_HUES[hashName(name) % FLAME_HUES.length];
  return `hsl(${hue} 55% 40%)`;
}
