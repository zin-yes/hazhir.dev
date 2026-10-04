import type {
  BreakdownEntry,
  BreakdownSummary,
  CallTree,
  CallTreeNode,
  TraceSpan,
} from "./types";

/**
 * Shared engine behind both the main-thread profiler and the worker recorder:
 * a hierarchical call tree (calls, inclusive and self time per path), keyed
 * breakdowns (cost grouped by biome, feature, block, ...), sampled sections
 * for loops too hot to time on every call, and an optional span buffer for
 * the timeline export. Must stay free of DOM and main-thread profiler imports
 * because workers use it.
 */

export type RecorderClock = () => number;

export interface CallTreeRecorderOptions {
  maxNodes?: number;
  maxKeysPerDimension?: number;
  /** Zero disables span capture. */
  maxSpans?: number;
}

const DEFAULT_MAX_NODES = 3000;
const DEFAULT_MAX_KEYS_PER_DIMENSION = 1024;
const MAX_STACK_DEPTH = 96;
export const OVERFLOW_NODE_NAME = "<other>";
export const OVERFLOW_KEY = "<other>";

class CallNode {
  readonly children = new Map<string, CallNode>();
  calls = 0;
  totalMs = 0;
  selfMs = 0;
  maxMs = 0;
  estimated = false;
  timedCalls = 0;
  timedTotalMs = 0;
  timedSelfMs = 0;

  constructor(
    readonly name: string,
    readonly parent: CallNode | null,
  ) {}
}

interface BreakdownAccumulator {
  calls: number;
  selfMs: number;
  totalMs: number;
  units: number;
}

export class CallTreeRecorder {
  private readonly clock: RecorderClock;
  private readonly maxNodes: number;
  private readonly maxKeysPerDimension: number;
  private readonly maxSpans: number;

  private root = new CallNode("", null);
  private nodeCount = 0;
  private droppedNodes = 0;

  private nodeStack: CallNode[] = new Array(MAX_STACK_DEPTH);
  private startedAtMs = new Float64Array(MAX_STACK_DEPTH);
  private childMs = new Float64Array(MAX_STACK_DEPTH);
  private isTimed: boolean[] = new Array(MAX_STACK_DEPTH);
  private stackDimension: (string | undefined)[] = new Array(MAX_STACK_DEPTH);
  private stackKey: (string | undefined)[] = new Array(MAX_STACK_DEPTH);
  private depth = 0;

  private breakdowns = new Map<string, Map<string, BreakdownAccumulator>>();
  private droppedKeysByDimension = new Map<string, number>();

  private spans: TraceSpan[] = [];
  private droppedSpans = 0;
  private spanOriginMs = 0;

  constructor(clock: RecorderClock, options: CallTreeRecorderOptions = {}) {
    this.clock = clock;
    this.maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    this.maxKeysPerDimension = options.maxKeysPerDimension ?? DEFAULT_MAX_KEYS_PER_DIMENSION;
    this.maxSpans = options.maxSpans ?? 0;
    this.spanOriginMs = clock();
  }

  get currentDepth(): number {
    return this.depth;
  }

  get currentScopeName(): string | null {
    return this.depth > 0 ? this.nodeStack[this.depth - 1].name : null;
  }

  reset() {
    this.root = new CallNode("", null);
    this.nodeCount = 0;
    this.droppedNodes = 0;
    this.depth = 0;
    this.breakdowns.clear();
    this.droppedKeysByDimension.clear();
    this.spans = [];
    this.droppedSpans = 0;
    this.spanOriginMs = this.clock();
  }

  /**
   * Opens a section. `sampleEvery` above 1 times only the first and every Nth
   * call and fills the rest with the running mean, so a section that runs a
   * million times per task costs one clock read per N calls. Call counts stay
   * exact; times are flagged as estimated.
   */
  begin(name: string, dimension?: string, key?: string, sampleEvery = 1) {
    if (this.depth >= MAX_STACK_DEPTH) return;
    const parent = this.depth > 0 ? this.nodeStack[this.depth - 1] : this.root;
    const node = this.childOf(parent, name);
    node.calls++;
    const timed = sampleEvery <= 1 || (node.calls - 1) % sampleEvery === 0;
    if (sampleEvery > 1) node.estimated = true;

    const slot = this.depth++;
    this.nodeStack[slot] = node;
    this.isTimed[slot] = timed;
    this.stackDimension[slot] = dimension;
    this.stackKey[slot] = key;
    this.childMs[slot] = 0;
    this.startedAtMs[slot] = timed ? this.clock() : 0;
  }

  /** Closes the innermost section and returns its (estimated) inclusive milliseconds. */
  end(): number {
    if (this.depth === 0) return 0;
    const slot = this.depth - 1;
    const node = this.nodeStack[slot];
    let totalMs: number;
    let selfMs: number;

    if (this.isTimed[slot]) {
      const endedAtMs = this.clock();
      totalMs = endedAtMs - this.startedAtMs[slot];
      selfMs = Math.max(0, totalMs - this.childMs[slot]);
      node.timedCalls++;
      node.timedTotalMs += totalMs;
      node.timedSelfMs += selfMs;
      if (totalMs > node.maxMs) node.maxMs = totalMs;
      this.recordSpan(node.name, this.startedAtMs[slot], totalMs, slot);
    } else {
      totalMs = node.timedCalls === 0 ? 0 : node.timedTotalMs / node.timedCalls;
      selfMs = node.timedCalls === 0 ? 0 : node.timedSelfMs / node.timedCalls;
    }

    node.totalMs += totalMs;
    node.selfMs += selfMs;
    this.depth--;
    if (slot > 0) this.childMs[slot - 1] += totalMs;

    const dimension = this.stackDimension[slot];
    if (dimension !== undefined) {
      const entry = this.breakdownEntry(dimension, this.stackKey[slot] ?? OVERFLOW_KEY);
      entry.calls++;
      entry.selfMs += selfMs;
      entry.totalMs += totalMs;
    }
    return totalMs;
  }

  /** Closes sections until only `targetDepth` remain open. */
  endTo(targetDepth: number) {
    while (this.depth > targetDepth) this.end();
  }

  /**
   * Records time measured elsewhere as a leaf under the current section and
   * credits it to that section's children, so nothing is counted twice.
   */
  addLeaf(name: string, durationMs: number) {
    const parent = this.depth > 0 ? this.nodeStack[this.depth - 1] : this.root;
    const node = this.childOf(parent, name);
    node.calls++;
    node.totalMs += durationMs;
    node.selfMs += durationMs;
    node.timedCalls++;
    node.timedTotalMs += durationMs;
    node.timedSelfMs += durationMs;
    if (durationMs > node.maxMs) node.maxMs = durationMs;
    if (this.depth > 0) this.childMs[this.depth - 1] += durationMs;
  }

  /** Adds units of work (and optionally time) to a breakdown key without opening a section. */
  addKeyed(dimension: string, key: string, amounts: { units?: number; calls?: number; selfMs?: number; totalMs?: number }) {
    const entry = this.breakdownEntry(dimension, key);
    entry.units += amounts.units ?? 0;
    entry.calls += amounts.calls ?? 0;
    entry.selfMs += amounts.selfMs ?? 0;
    entry.totalMs += amounts.totalMs ?? amounts.selfMs ?? 0;
  }

  /** Merges a finished tree (from a worker) into this one under `rootPrefix`. */
  mergeNodes(nodes: CallTreeNode[]) {
    for (const incoming of nodes) {
      const segments = incoming.path.split(">");
      let node = this.root;
      for (const segment of segments) node = this.childOf(node, segment);
      node.calls += incoming.calls;
      node.totalMs += incoming.totalMs;
      node.selfMs += incoming.selfMs;
      if (incoming.maxMs > node.maxMs) node.maxMs = incoming.maxMs;
      if (incoming.estimated) node.estimated = true;
    }
  }

  mergeBreakdowns(dimension: string, entries: BreakdownEntry[]) {
    for (const incoming of entries) {
      this.addKeyed(dimension, incoming.key, incoming);
    }
  }

  toCallTree(rootName: string, thread: CallTree["thread"]): CallTree {
    const nodes: CallTreeNode[] = [];
    const visit = (node: CallNode, parentPath: string) => {
      for (const child of node.children.values()) {
        const path = parentPath === "" ? child.name : `${parentPath}>${child.name}`;
        nodes.push({
          path,
          calls: child.calls,
          totalMs: child.totalMs,
          selfMs: child.selfMs,
          maxMs: child.maxMs,
          estimated: child.estimated,
        });
        visit(child, path);
      }
    };
    visit(this.root, "");
    return { root: rootName, thread, nodes, droppedNodes: this.droppedNodes };
  }

  toBreakdowns(thread: BreakdownSummary["thread"]): BreakdownSummary[] {
    const summaries: BreakdownSummary[] = [];
    for (const [dimension, keys] of this.breakdowns) {
      const entries: BreakdownEntry[] = [];
      let totalSelfMs = 0;
      let totalUnits = 0;
      for (const [key, accumulator] of keys) {
        entries.push({ key, ...accumulator });
        totalSelfMs += accumulator.selfMs;
        totalUnits += accumulator.units;
      }
      entries.sort((first, second) => second.selfMs - first.selfMs || second.units - first.units);
      summaries.push({
        dimension,
        thread,
        entries,
        totalSelfMs,
        totalUnits,
        droppedKeys: this.droppedKeysByDimension.get(dimension) ?? 0,
      });
    }
    return summaries;
  }

  hasContent(): boolean {
    return this.nodeCount > 0 || this.breakdowns.size > 0;
  }

  takeSpans(): { spans: TraceSpan[]; droppedSpans: number } {
    const result = { spans: this.spans, droppedSpans: this.droppedSpans };
    this.spans = [];
    this.droppedSpans = 0;
    return result;
  }

  peekSpans(): { spans: TraceSpan[]; droppedSpans: number } {
    return { spans: this.spans, droppedSpans: this.droppedSpans };
  }

  private recordSpan(name: string, startedAtMs: number, durationMs: number, depthIndex: number) {
    if (this.maxSpans === 0) return;
    if (this.spans.length >= this.maxSpans) {
      this.droppedSpans++;
      return;
    }
    this.spans.push({
      name,
      startMs: startedAtMs - this.spanOriginMs,
      durationMs,
      depth: depthIndex,
    });
  }

  private childOf(parent: CallNode, name: string): CallNode {
    let child = parent.children.get(name);
    if (child) return child;
    if (this.nodeCount >= this.maxNodes) {
      this.droppedNodes++;
      let overflow = this.root.children.get(OVERFLOW_NODE_NAME);
      if (!overflow) {
        overflow = new CallNode(OVERFLOW_NODE_NAME, this.root);
        this.root.children.set(OVERFLOW_NODE_NAME, overflow);
      }
      return overflow;
    }
    child = new CallNode(name, parent);
    parent.children.set(name, child);
    this.nodeCount++;
    return child;
  }

  private breakdownEntry(dimension: string, key: string): BreakdownAccumulator {
    let keys = this.breakdowns.get(dimension);
    if (!keys) {
      keys = new Map();
      this.breakdowns.set(dimension, keys);
    }
    let entry = keys.get(key);
    if (entry) return entry;
    if (keys.size >= this.maxKeysPerDimension) {
      this.droppedKeysByDimension.set(
        dimension,
        (this.droppedKeysByDimension.get(dimension) ?? 0) + 1,
      );
      let overflow = keys.get(OVERFLOW_KEY);
      if (!overflow) {
        overflow = { calls: 0, selfMs: 0, totalMs: 0, units: 0 };
        keys.set(OVERFLOW_KEY, overflow);
      }
      return overflow;
    }
    entry = { calls: 0, selfMs: 0, totalMs: 0, units: 0 };
    keys.set(key, entry);
    return entry;
  }
}
