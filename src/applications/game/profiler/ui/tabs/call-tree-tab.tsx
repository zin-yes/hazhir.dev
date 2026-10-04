import { useMemo, useState, type KeyboardEvent } from "react";

import type { ProfileReport } from "../../types";
import {
  buildCallTreeModel,
  findHottestPathPaths,
  flattenVisibleRows,
  listTopSelfNodes,
  resolveSelectedTree,
  type RankingMode,
  type TopSelfEntry,
  type VisibleCallTreeRow,
} from "../call-tree-model";
import { formatCount, formatMilliseconds, formatPercent } from "../format";
import { DataTable, ProportionBar, SectionTitle, type Column } from "../table";
import { CallTreeRootPicker } from "./call-tree-root-picker";

const TOP_SELF_LIMIT = 15;
const BUTTON_CLASSES = "border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700";
const ACTIVE_BUTTON_CLASSES = "border border-cyan-700 bg-zinc-700 px-1.5 py-0.5 text-cyan-300";

const TOP_SELF_COLUMNS: Column<TopSelfEntry>[] = [
  {
    header: "node",
    render: (entry) => (
      <span className="text-zinc-100" title={entry.path}>
        {entry.estimated ? "~" : ""}
        {entry.path}
      </span>
    ),
    className: "max-w-[250px] truncate",
  },
  { header: "self", align: "right", render: (entry) => formatMilliseconds(entry.selfMs) },
  { header: "% root", align: "right", render: (entry) => formatPercent(entry.fractionOfRoot) },
  { header: "calls", align: "right", render: (entry) => formatCount(entry.calls) },
];

function moveFocus(event: KeyboardEvent<HTMLDivElement>, direction: "next" | "previous") {
  const sibling =
    direction === "next" ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
  if (sibling instanceof HTMLElement) sibling.focus();
}

function CallTreeRow({
  row,
  totalMs,
  onToggle,
  onSetExpanded,
}: {
  row: VisibleCallTreeRow;
  totalMs: number;
  onToggle: (path: string) => void;
  onSetExpanded: (path: string, expanded: boolean) => void;
}) {
  const { node } = row;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") moveFocus(event, "next");
    else if (event.key === "ArrowUp") moveFocus(event, "previous");
    else if (event.key === "ArrowRight" && row.hasChildren) onSetExpanded(node.path, true);
    else if (event.key === "ArrowLeft" && row.isExpanded) onSetExpanded(node.path, false);
    else if ((event.key === "Enter" || event.key === " ") && row.hasChildren) onToggle(node.path);
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="treeitem"
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      aria-level={node.depth + 1}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={() => row.hasChildren && onToggle(node.path)}
      className="grid cursor-default grid-cols-[minmax(0,1fr)_90px_58px_46px_46px_52px] items-center gap-1 border-t border-zinc-800 px-1 py-0.5 outline-none hover:bg-zinc-900 focus:bg-zinc-800"
      title={node.path}
    >
      <span className="truncate text-zinc-100" style={{ paddingLeft: `${node.depth * 10}px` }}>
        <span className="inline-block w-3 text-zinc-500">{row.hasChildren ? (row.isExpanded ? "v" : ">") : ""}</span>
        {node.estimated ? <span className="text-amber-400">~</span> : null}
        {node.name}
      </span>
      <span className="flex flex-col gap-px">
        <ProportionBar fraction={node.fractionOfRoot} colorClass="bg-cyan-600" />
        <ProportionBar fraction={totalMs > 0 ? node.selfMs / totalMs : 0} colorClass="bg-amber-500" />
      </span>
      <span className="text-right tabular-nums">
        {formatMilliseconds(node.inclusiveMs)}
        <span className="block text-zinc-500">{formatMilliseconds(node.selfMs)}</span>
      </span>
      <span className="text-right tabular-nums">{formatPercent(node.fractionOfRoot)}</span>
      <span className="text-right tabular-nums text-zinc-400">{formatPercent(node.fractionOfParent)}</span>
      <span className="text-right tabular-nums text-zinc-400">
        {formatCount(node.calls)}
        <span className="block">{formatMilliseconds(node.meanMsPerCall)}</span>
      </span>
    </div>
  );
}

export function CallTreeTab({ report }: { report: ProfileReport }) {
  const { callTrees } = report.snapshot;
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [ranking, setRanking] = useState<RankingMode>("inclusive");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set());

  const selectedTree = resolveSelectedTree(callTrees, selectedRoot);
  const model = useMemo(
    () => (selectedTree ? buildCallTreeModel(selectedTree, ranking) : null),
    [selectedTree, ranking],
  );
  const visibleRows = useMemo(
    () => (model ? flattenVisibleRows(model, expandedPaths, searchQuery) : []),
    [model, expandedPaths, searchQuery],
  );
  const topSelfEntries = useMemo(() => (model ? listTopSelfNodes(model, TOP_SELF_LIMIT) : []), [model]);

  if (!selectedTree || !model) {
    return <div className="p-2 text-zinc-500">no call trees recorded yet</div>;
  }

  const setExpanded = (path: string, expanded: boolean) =>
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (expanded) next.add(path);
      else next.delete(path);
      return next;
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 p-1">
        <CallTreeRootPicker
          callTrees={callTrees}
          selectedRoot={selectedTree.root}
          onChange={(root) => {
            setSelectedRoot(root);
            setExpandedPaths(new Set());
          }}
        />
        <button className={ranking === "inclusive" ? ACTIVE_BUTTON_CLASSES : BUTTON_CLASSES} onClick={() => setRanking("inclusive")}>
          Inclusive
        </button>
        <button className={ranking === "self" ? ACTIVE_BUTTON_CLASSES : BUTTON_CLASSES} onClick={() => setRanking("self")}>
          Self
        </button>
        <button className={BUTTON_CLASSES} onClick={() => setExpandedPaths(new Set(findHottestPathPaths(model)))}>
          Expand hottest path
        </button>
        <button className={BUTTON_CLASSES} onClick={() => setExpandedPaths(new Set())}>
          Collapse all
        </button>
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="filter path..."
          aria-label="Filter call tree"
          className="min-w-[120px] flex-1 border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 placeholder:text-zinc-600"
        />
      </div>
      <div className="px-1 text-zinc-500">
        {selectedTree.root}: {formatMilliseconds(model.totalMs)} over {model.nodeCount} nodes
        {selectedTree.droppedNodes > 0 ? `, ${selectedTree.droppedNodes} dropped into <other>` : ""}. Bars: cyan inclusive, amber
        self. ~ = estimated from sampled calls.
      </div>
      <div role="tree" aria-label="Call tree" className="mt-1">
        <div className="grid grid-cols-[minmax(0,1fr)_90px_58px_46px_46px_52px] gap-1 px-1 text-zinc-500">
          <span>scope</span>
          <span>bars</span>
          <span className="text-right">incl/self</span>
          <span className="text-right">% root</span>
          <span className="text-right">% parent</span>
          <span className="text-right">calls/mean</span>
        </div>
        {visibleRows.length === 0 ? (
          <div className="px-2 py-1 text-zinc-500">no node matches the filter</div>
        ) : (
          visibleRows.map((row) => (
            <CallTreeRow key={row.node.path} row={row} totalMs={model.totalMs} onToggle={(path) => setExpanded(path, !expandedPaths.has(path))} onSetExpanded={setExpanded} />
          ))
        )}
      </div>
      <SectionTitle>Top self time (every node, any parent)</SectionTitle>
      <DataTable columns={TOP_SELF_COLUMNS} rows={topSelfEntries} getKey={(entry) => entry.path} />
    </div>
  );
}
