import {
  buildCrossMatrix,
  isCrossDimension,
  isOverflowKey,
  isUnitsOnly,
  leafName,
  percentOf,
  rankedBreakdownEntries,
  selectCallTreeRows,
  topSelfTimePaths,
  treeTotalMs,
  workerUnattributedGap,
  CROSS_KEY_SEPARATOR,
  PATH_SEPARATOR,
} from "./detail-analysis";
import { markdownHeading, markdownTable } from "./markdown-table";
import type { BreakdownEntry, BreakdownSummary, CallTree, ProfileSnapshot } from "./types";
import { formatCount, formatMilliseconds, formatNanosecondsPerUnit } from "./ui/format";

export const CALL_TREE_MAX_DEPTH = 8;
export const CALL_TREE_MAX_ROWS = 60;
export const TOP_SELF_PATH_ROWS = 25;
export const BREAKDOWN_ROWS = 25;
export const MATRIX_MAX_ROWS = 15;
export const MATRIX_MAX_COLUMNS = 12;
const SAMPLING_FUNCTION_ROWS = 20;
const SAMPLING_STACK_ROWS = 10;
const STACK_FRAME_SEPARATOR = " > ";

const ESTIMATE_MARKER = "~";

function formatShare(percent: number): string {
  return `${percent.toFixed(percent >= 10 ? 0 : 1)}%`;
}

function formatMillisecondsEstimate(milliseconds: number, estimated: boolean): string {
  return `${estimated ? ESTIMATE_MARKER : ""}${formatMilliseconds(milliseconds)}`;
}

export function renderCallTreeSection(snapshot: ProfileSnapshot, level: number): string[] {
  const trees = snapshot.callTrees.filter((tree) => tree.nodes.length > 0);
  if (trees.length === 0) return [];
  const lines = [markdownHeading(level, "Call trees"), ""];
  lines.push(
    `Inclusive time, indented by nesting. "${ESTIMATE_MARKER}" marks times extrapolated from sampled calls. % of root is the share of the worker task (worker trees) or of the top-level scope (main).`,
    "",
  );
  for (const tree of trees) lines.push(...renderOneCallTree(snapshot, tree, level + 1));
  return lines;
}

function renderOneCallTree(snapshot: ProfileSnapshot, tree: CallTree, level: number): string[] {
  const total = treeTotalMs(tree);
  const lines = [
    markdownHeading(level, `${tree.root} (${tree.thread}, ${formatMilliseconds(total)} in root nodes)`),
    "",
  ];

  const gap = workerUnattributedGap(snapshot, tree);
  if (gap) {
    lines.push(
      `**Unattributed gap:** ${gap.taskCount} tasks ran ${formatMilliseconds(gap.execTotalMs)} (worker.${tree.root}.exec), instrumented root nodes cover ${formatMilliseconds(gap.instrumentedMs)}, so ${formatMilliseconds(gap.gapMs)} (${formatShare(gap.gapShare * 100)}) has no section around it.`,
      "",
    );
  }

  const view = selectCallTreeRows(tree, { maxDepth: CALL_TREE_MAX_DEPTH, maxNodes: CALL_TREE_MAX_ROWS });
  lines.push(
    markdownTable(
      ["node", "calls", "total", "self", "% of root", "mean/call", "max"],
      view.rows.map(({ node, depth, percentOfRoot }) => [
        `\`${"  ".repeat(depth)}${leafName(node.path)}${node.estimated ? ` ${ESTIMATE_MARKER}` : ""}\``,
        formatCount(node.calls),
        formatMillisecondsEstimate(node.totalMs, node.estimated),
        formatMillisecondsEstimate(node.selfMs, node.estimated),
        formatShare(percentOfRoot),
        node.calls > 0 ? formatMillisecondsEstimate(node.totalMs / node.calls, node.estimated) : "-",
        formatMilliseconds(node.maxMs),
      ]),
    ),
    "",
  );
  const notes: string[] = [];
  if (view.omittedNodes > 0) {
    notes.push(`${view.omittedNodes} lighter or deeper nodes not shown`);
  }
  if (tree.droppedNodes > 0) notes.push(`${tree.droppedNodes} nodes hit the node cap and are folded into <other>`);
  if (notes.length > 0) lines.push(`_${notes.join("; ")}._`, "");

  lines.push(markdownHeading(level + 1, `${tree.root}: top self-time paths`), "");
  lines.push(
    markdownTable(
      ["rank", "path", "calls", "self", "% of tree", "% of root", "self/call"],
      topSelfTimePaths(tree, TOP_SELF_PATH_ROWS).map(({ node, percentOfTree, percentOfRoot }, index) => [
        `${index + 1}`,
        node.path.split(PATH_SEPARATOR).join(STACK_FRAME_SEPARATOR),
        formatCount(node.calls),
        formatMillisecondsEstimate(node.selfMs, node.estimated),
        formatShare(percentOfTree),
        formatShare(percentOfRoot),
        node.calls > 0 ? formatMillisecondsEstimate(node.selfMs / node.calls, node.estimated) : "-",
      ]),
    ),
    "",
  );
  return lines;
}

export function renderBreakdownSection(snapshot: ProfileSnapshot, level: number): string[] {
  const summaries = snapshot.breakdowns.filter((summary) => summary.entries.length > 0);
  if (summaries.length === 0) return [];
  const lines = [markdownHeading(level, "Breakdowns"), ""];
  lines.push(
    "Cost grouped by a domain key. Share is of the dimension's total self time (of units for dimensions with no timing).",
    "",
  );
  for (const summary of summaries) {
    lines.push(...renderOneBreakdown(summary, level + 1));
  }
  return lines;
}

function renderOneBreakdown(summary: BreakdownSummary, level: number): string[] {
  const unitsOnly = isUnitsOnly(summary);
  const lines = [
    markdownHeading(
      level,
      `${summary.dimension} (${summary.thread}, ${formatMilliseconds(summary.totalSelfMs)} self, ${formatCount(summary.totalUnits)} units, ${summary.entries.length} keys)`,
    ),
    "",
  ];
  const ranked = rankedBreakdownEntries(summary);
  const shown = ranked.slice(0, BREAKDOWN_ROWS);
  const cross = isCrossDimension(summary);
  const dimensionTotal = unitsOnly ? summary.totalUnits : summary.totalSelfMs;
  const valueOf = (entry: BreakdownEntry) => (unitsOnly ? entry.units : entry.selfMs);

  const rows = shown.map((entry, index) => breakdownRow(`${index + 1}`, displayKey(entry, cross), entry, percentOf(valueOf(entry), dimensionTotal)));
  const hiddenEntries = ranked.slice(BREAKDOWN_ROWS);
  if (hiddenEntries.length > 0) {
    rows.push(breakdownRow("", `${hiddenEntries.length} more keys`, sumEntries(hiddenEntries), percentOf(hiddenEntries.reduce((sum, entry) => sum + valueOf(entry), 0), dimensionTotal)));
  }
  rows.push(breakdownRow("", "**total**", sumEntries(ranked), 100));
  lines.push(
    markdownTable(["rank", "key", "share", "self", "calls", "units", "us/call", "ns/unit"], rows),
    "",
  );
  if (summary.droppedKeys > 0) {
    lines.push(`_${summary.droppedKeys} keys hit the key cap and are folded into <other>._`, "");
  }
  if (cross) lines.push(...renderCrossMatrix(summary, level + 1));
  return lines;
}

function displayKey(entry: BreakdownEntry, cross: boolean): string {
  if (isOverflowKey(entry)) return entry.key;
  return cross ? entry.key.split(CROSS_KEY_SEPARATOR).join(" x ") : entry.key;
}

function sumEntries(entries: BreakdownEntry[]): BreakdownEntry {
  return entries.reduce(
    (sum, entry) => ({
      key: sum.key,
      calls: sum.calls + entry.calls,
      selfMs: sum.selfMs + entry.selfMs,
      totalMs: sum.totalMs + entry.totalMs,
      units: sum.units + entry.units,
    }),
    { key: "", calls: 0, selfMs: 0, totalMs: 0, units: 0 },
  );
}

function breakdownRow(rank: string, key: string, entry: BreakdownEntry, sharePercent: number): string[] {
  return [
    rank,
    key,
    formatShare(sharePercent),
    formatMilliseconds(entry.selfMs),
    formatCount(entry.calls),
    formatCount(entry.units),
    entry.calls > 0 && entry.selfMs > 0 ? ((entry.selfMs / entry.calls) * 1000).toFixed(1) : "-",
    entry.units > 0 && entry.selfMs > 0 ? formatNanosecondsPerUnit((entry.selfMs / entry.units) * 1_000_000) : "-",
  ];
}

function renderCrossMatrix(summary: BreakdownSummary, level: number): string[] {
  const matrix = buildCrossMatrix(summary, { maxRows: MATRIX_MAX_ROWS, maxColumns: MATRIX_MAX_COLUMNS });
  if (matrix.rowLabels.length === 0) return [];
  const unit = matrix.metric === "selfMs" ? "self ms" : "units";
  const lines = [markdownHeading(level, `${summary.dimension} matrix (${unit}, rows x columns by total)`), ""];
  lines.push(
    markdownTable(
      ["", ...matrix.columnLabels],
      matrix.rowLabels.map((rowLabel, rowIndex) => [
        rowLabel,
        ...matrix.values[rowIndex].map((value) =>
          value === null ? "-" : matrix.metric === "selfMs" ? value.toFixed(1) : formatCount(value),
        ),
      ]),
    ),
    "",
  );
  return lines;
}

export function renderSamplingSection(snapshot: ProfileSnapshot, level: number): string[] {
  const sampling = snapshot.sampling;
  if (!sampling) return [];
  const lines = [
    markdownHeading(level, "Sampling profile (main thread)"),
    "",
    `${sampling.totalSamples} samples every ${sampling.sampleIntervalMs}ms over ${formatMilliseconds(sampling.durationMs)}.`,
    "",
  ];
  lines.push(
    markdownTable(
      ["rank", "function", "location", "samples", "self", "share"],
      sampling.topSelf.slice(0, SAMPLING_FUNCTION_ROWS).map((entry, index) => [
        `${index + 1}`,
        entry.functionName || "(anonymous)",
        `${entry.resource}:${entry.line}`,
        `${entry.samples}`,
        formatMilliseconds(entry.selfMs),
        formatShare(percentOf(entry.samples, sampling.totalSamples)),
      ]),
    ),
    "",
  );
  lines.push(markdownHeading(level + 1, "Hottest stacks"), "");
  lines.push(
    markdownTable(
      ["samples", "share", "stack (root first)"],
      sampling.topStacks.slice(0, SAMPLING_STACK_ROWS).map((stack) => [
        `${stack.samples}`,
        formatShare(percentOf(stack.samples, sampling.totalSamples)),
        stack.frames.join(STACK_FRAME_SEPARATOR),
      ]),
    ),
    "",
  );
  return lines;
}
