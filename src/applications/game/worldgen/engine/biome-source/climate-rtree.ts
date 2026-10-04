// Port of net.minecraft.world.level.biome.Climate.RTree (construction and search), without the thread-local
// "last leaf" cache so lookups are deterministic. The cache only changes which of several exactly tied leaves wins.
import { CLIMATE_DIMENSION_COUNT, type ParameterPoint } from "./climate-parameter-list";

const CHILDREN_PER_NODE = 6;

interface TreeNode {
  /** Flat [min0, max0, min1, max1, ...] bounding box over all 7 dimensions. */
  bounds: number[];
}

interface LeafNode extends TreeNode {
  leafIndex: number;
}

interface SubTreeNode extends TreeNode {
  children: TreeNode[];
}

function isLeaf(node: TreeNode): node is LeafNode {
  return (node as LeafNode).leafIndex !== undefined;
}

function createSubTree(children: TreeNode[]): SubTreeNode {
  const bounds: number[] = [];
  for (let dimension = 0; dimension < CLIMATE_DIMENSION_COUNT; dimension++) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const child of children) {
      minimum = Math.min(minimum, child.bounds[dimension * 2]);
      maximum = Math.max(maximum, child.bounds[dimension * 2 + 1]);
    }
    bounds.push(minimum, maximum);
  }
  return { bounds, children };
}

// Java long division truncates toward zero.
function midpoint(node: TreeNode, dimension: number): number {
  return Math.trunc((node.bounds[dimension * 2] + node.bounds[dimension * 2 + 1]) / 2);
}

function comparatorForDimension(dimension: number, absolute: boolean): (left: TreeNode, right: TreeNode) => number {
  return (left, right) => {
    const leftKey = absolute ? Math.abs(midpoint(left, dimension)) : midpoint(left, dimension);
    const rightKey = absolute ? Math.abs(midpoint(right, dimension)) : midpoint(right, dimension);
    return leftKey - rightKey;
  };
}

function sortByDimension(nodes: TreeNode[], startDimension: number, absolute: boolean): void {
  const comparators: Array<(left: TreeNode, right: TreeNode) => number> = [];
  for (let offset = 0; offset < CLIMATE_DIMENSION_COUNT; offset++) {
    comparators.push(comparatorForDimension((startDimension + offset) % CLIMATE_DIMENSION_COUNT, absolute));
  }
  nodes.sort((left, right) => {
    for (const comparator of comparators) {
      const result = comparator(left, right);
      if (result !== 0) return result;
    }
    return 0;
  });
}

function bucketize(nodes: TreeNode[]): SubTreeNode[] {
  const buckets: SubTreeNode[] = [];
  let currentBucket: TreeNode[] = [];
  const bucketSize = Math.trunc(Math.pow(6, Math.floor(Math.log(nodes.length - 0.01) / Math.log(6))));
  for (const node of nodes) {
    currentBucket.push(node);
    if (currentBucket.length >= bucketSize) {
      buckets.push(createSubTree(currentBucket));
      currentBucket = [];
    }
  }
  if (currentBucket.length > 0) buckets.push(createSubTree(currentBucket));
  return buckets;
}

function boundsCost(bounds: number[]): number {
  let cost = 0;
  for (let dimension = 0; dimension < CLIMATE_DIMENSION_COUNT; dimension++) {
    cost += Math.abs(bounds[dimension * 2 + 1] - bounds[dimension * 2]);
  }
  return cost;
}

function buildTree(children: TreeNode[]): TreeNode {
  if (children.length === 0) throw new Error("Need at least one climate parameter point");
  if (children.length === 1) return children[0];
  if (children.length <= CHILDREN_PER_NODE) {
    const sortedChildren = children.slice().sort((left, right) => {
      let leftKey = 0;
      let rightKey = 0;
      for (let dimension = 0; dimension < CLIMATE_DIMENSION_COUNT; dimension++) {
        leftKey += Math.abs(midpoint(left, dimension));
        rightKey += Math.abs(midpoint(right, dimension));
      }
      return leftKey - rightKey;
    });
    return createSubTree(sortedChildren);
  }
  let lowestCost = Infinity;
  let bestDimension = -1;
  let bestBuckets: SubTreeNode[] = [];
  for (let dimension = 0; dimension < CLIMATE_DIMENSION_COUNT; dimension++) {
    sortByDimension(children, dimension, false);
    const buckets = bucketize(children);
    let totalCost = 0;
    for (const bucket of buckets) totalCost += boundsCost(bucket.bounds);
    if (lowestCost > totalCost) {
      lowestCost = totalCost;
      bestDimension = dimension;
      bestBuckets = buckets;
    }
  }
  sortByDimension(bestBuckets, bestDimension, true);
  return createSubTree(bestBuckets.map((bucket) => buildTree(bucket.children)));
}

export class ClimateRTree {
  // Flattened tree: node bounds are 14 numbers per node; subtree children are contiguous ranges of childNodeIds.
  private readonly nodeBounds: Float64Array;
  private readonly nodeLeafIndex: Int32Array;
  private readonly nodeChildStart: Int32Array;
  private readonly nodeChildCount: Int32Array;
  private readonly childNodeIds: Int32Array;
  private readonly rootNodeId: number;
  private readonly searchTarget = new Float64Array(CLIMATE_DIMENSION_COUNT);
  private bestDistance = 0;
  private bestNodeId = -1;

  private lastLeafNodeId = -1;
  private searchCount = 0;
  private nodeDistanceCount = 0;

  /** @param reuseLastLeaf mirrors vanilla's thread-local last-leaf hint: faster on coherent queries, but exact ties then depend on query order. */
  constructor(
    points: ParameterPoint[],
    private readonly reuseLastLeaf = false,
  ) {
    const leaves: LeafNode[] = points.map((point, leafIndex) => ({
      leafIndex,
      bounds: point.intervals.flatMap((interval) => [interval[0], interval[1]]),
    }));
    const root = buildTree(leaves);

    const orderedNodes: TreeNode[] = [];
    const childIds: number[] = [];
    const registerNode = (node: TreeNode): number => {
      const nodeId = orderedNodes.length;
      orderedNodes.push(node);
      return nodeId;
    };
    const childStartByNode = new Map<TreeNode, number>();
    const pending: TreeNode[] = [];
    this.rootNodeId = registerNode(root);
    pending.push(root);
    const nodeIdByNode = new Map<TreeNode, number>([[root, this.rootNodeId]]);
    while (pending.length > 0) {
      const node = pending.shift() as TreeNode;
      if (isLeaf(node)) continue;
      const children = (node as SubTreeNode).children;
      childStartByNode.set(node, childIds.length);
      for (const child of children) {
        const childId = registerNode(child);
        nodeIdByNode.set(child, childId);
        childIds.push(childId);
        pending.push(child);
      }
    }

    this.nodeBounds = new Float64Array(orderedNodes.length * CLIMATE_DIMENSION_COUNT * 2);
    this.nodeLeafIndex = new Int32Array(orderedNodes.length).fill(-1);
    this.nodeChildStart = new Int32Array(orderedNodes.length);
    this.nodeChildCount = new Int32Array(orderedNodes.length);
    this.childNodeIds = Int32Array.from(childIds);
    orderedNodes.forEach((node, nodeId) => {
      this.nodeBounds.set(node.bounds, nodeId * CLIMATE_DIMENSION_COUNT * 2);
      if (isLeaf(node)) this.nodeLeafIndex[nodeId] = node.leafIndex;
      else {
        this.nodeChildStart[nodeId] = childStartByNode.get(node) as number;
        this.nodeChildCount[nodeId] = (node as SubTreeNode).children.length;
      }
    });
  }

  /** Index (into the construction list) of the leaf with minimal fitness; vanilla tie behavior except the last-leaf cache. */
  search(targetArray: number[]): number {
    this.searchCount++;
    for (let dimension = 0; dimension < CLIMATE_DIMENSION_COUNT; dimension++) this.searchTarget[dimension] = targetArray[dimension];
    this.bestDistance = Infinity;
    this.bestNodeId = -1;
    if (this.reuseLastLeaf && this.lastLeafNodeId >= 0) {
      this.bestDistance = this.nodeDistance(this.lastLeafNodeId);
      this.bestNodeId = this.lastLeafNodeId;
    }
    this.searchNode(this.rootNodeId);
    this.lastLeafNodeId = this.bestNodeId;
    return this.bestNodeId < 0 ? -1 : this.nodeLeafIndex[this.bestNodeId];
  }

  /** Returns the searches and bounding box distance evaluations since the last call, then resets both. */
  drainSearchStatistics(): { searches: number; nodeDistanceEvaluations: number } {
    const statistics = { searches: this.searchCount, nodeDistanceEvaluations: this.nodeDistanceCount };
    this.searchCount = 0;
    this.nodeDistanceCount = 0;
    return statistics;
  }

  private nodeDistance(nodeId: number): number {
    this.nodeDistanceCount++;
    let distance = 0;
    const boundsBase = nodeId * CLIMATE_DIMENSION_COUNT * 2;
    for (let dimension = 0; dimension < CLIMATE_DIMENSION_COUNT; dimension++) {
      const target = this.searchTarget[dimension];
      const above = target - this.nodeBounds[boundsBase + dimension * 2 + 1];
      if (above > 0) distance += above * above;
      else {
        const below = this.nodeBounds[boundsBase + dimension * 2] - target;
        if (below > 0) distance += below * below;
      }
    }
    return distance;
  }

  /**
   * Mirrors Climate.RTree.SubTree.search: visit children in order, descend only when the child's box distance is
   * strictly below the best so far, so earlier children win exact ties.
   */
  private searchNode(nodeId: number): void {
    const childCount = this.nodeChildCount[nodeId];
    const childStart = this.nodeChildStart[nodeId];
    for (let childOffset = 0; childOffset < childCount; childOffset++) {
      const childId = this.childNodeIds[childStart + childOffset];
      const childDistance = this.nodeDistance(childId);
      if (this.bestDistance > childDistance) {
        if (this.nodeLeafIndex[childId] >= 0) {
          this.bestDistance = childDistance;
          this.bestNodeId = childId;
        } else {
          this.searchNode(childId);
        }
      }
    }
  }
}
