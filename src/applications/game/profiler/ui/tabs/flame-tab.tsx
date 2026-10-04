import { memo, useCallback, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";

import type { ProfileReport } from "../../types";
import { buildCallTreeModel, resolveSelectedTree } from "../call-tree-model";
import { buildBreadcrumbs, flameBlockColor, layoutFlame, type FlameBlock } from "../flame-layout";
import { formatCount, formatMilliseconds, formatPercent } from "../format";
import { CallTreeRootPicker } from "./call-tree-root-picker";

const ROW_HEIGHT_PIXELS = 16;
const MIN_BLOCK_WIDTH_FRACTION = 0.003;
const TOOLTIP_WIDTH_PIXELS = 370;
const TOOLTIP_HEIGHT_PIXELS = 70;

interface HoveredBlock {
  block: FlameBlock;
  left: number;
  top: number;
}

const FlameBlockView = memo(function FlameBlockView({
  block,
  onHover,
  onZoom,
}: {
  block: FlameBlock;
  onHover: (hoveredBlock: FlameBlock | null, event?: MouseEvent<HTMLDivElement>) => void;
  onZoom: (path: string) => void;
}) {
  return (
    <div
      data-path={block.path}
      onMouseEnter={(event) => onHover(block, event)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onZoom(block.path)}
      className="absolute cursor-pointer overflow-hidden whitespace-nowrap border-r border-b border-zinc-950 px-0.5 text-[10px] leading-[15px] text-white hover:brightness-125"
      style={{
        left: `${block.x * 100}%`,
        width: `${block.width * 100}%`,
        top: block.depth * ROW_HEIGHT_PIXELS,
        height: ROW_HEIGHT_PIXELS,
        backgroundColor: flameBlockColor(block.name, block.estimated),
      }}
    >
      {block.estimated ? "~" : ""}
      {block.name}
    </div>
  );
});

function FlameTooltip({ hovered }: { hovered: HoveredBlock }) {
  const { block } = hovered;
  return (
    <div
      className="pointer-events-none fixed z-10 max-w-[360px] border border-zinc-500 bg-zinc-900 p-1.5 text-zinc-100 shadow-lg"
      style={{ left: hovered.left, top: hovered.top }}
    >
      <div className="break-all text-cyan-300">{block.path || "(root)"}</div>
      <div>
        total {formatMilliseconds(block.inclusiveMs)} ({formatPercent(block.fractionOfRoot)} of root), self{" "}
        {formatMilliseconds(block.selfMs)}
      </div>
      <div>
        {formatCount(block.calls)} calls{block.estimated ? ", time estimated from sampled calls" : ""}
      </div>
    </div>
  );
}

export function FlameTab({ report }: { report: ProfileReport }) {
  const { callTrees } = report.snapshot;
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [zoomPath, setZoomPath] = useState("");
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);

  const selectedTree = resolveSelectedTree(callTrees, selectedRoot);
  const model = useMemo(() => (selectedTree ? buildCallTreeModel(selectedTree) : null), [selectedTree]);
  const layout = useMemo(
    () => (model ? layoutFlame(model, { zoomPath, minBlockWidthFraction: MIN_BLOCK_WIDTH_FRACTION }) : null),
    [model, zoomPath],
  );
  const breadcrumbs = useMemo(() => (model ? buildBreadcrumbs(model, zoomPath) : []), [model, zoomPath]);

  const handleHover = useCallback((hoveredBlock: FlameBlock | null, event?: MouseEvent<HTMLDivElement>) => {
    if (!hoveredBlock || !event) return setHovered(null);
    const bounds = event.currentTarget.getBoundingClientRect();
    const fitsBelow = bounds.bottom + TOOLTIP_HEIGHT_PIXELS < window.innerHeight;
    setHovered({
      block: hoveredBlock,
      left: Math.max(4, Math.min(bounds.left, window.innerWidth - TOOLTIP_WIDTH_PIXELS)),
      top: fitsBelow ? bounds.bottom + 4 : bounds.top - TOOLTIP_HEIGHT_PIXELS,
    });
  }, []);

  if (!selectedTree || !model || !layout) {
    return <div className="p-2 text-zinc-500">no call trees recorded yet</div>;
  }

  const zoomOutOneLevel = () => {
    const parentBreadcrumb = breadcrumbs[breadcrumbs.length - 2];
    if (parentBreadcrumb) setZoomPath(parentBreadcrumb.path);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Backspace") {
      zoomOutOneLevel();
      event.preventDefault();
    }
  };

  return (
    <div onKeyDown={handleKeyDown}>
      <div className="flex flex-wrap items-center gap-1 p-1">
        <CallTreeRootPicker
          callTrees={callTrees}
          selectedRoot={selectedTree.root}
          onChange={(root) => {
            setSelectedRoot(root);
            setZoomPath("");
          }}
        />
        <nav aria-label="Flame zoom path" className="flex flex-wrap items-center gap-0.5">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.path} className="flex items-center gap-0.5">
              {index > 0 ? <span className="text-zinc-600">&gt;</span> : null}
              <button
                className={`px-1 hover:text-cyan-300 ${index === breadcrumbs.length - 1 ? "text-cyan-300" : "text-zinc-400"}`}
                onClick={() => setZoomPath(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
        <span className="ml-auto text-zinc-500">
          {formatMilliseconds(layout.zoomInclusiveMs)} | click to zoom, Esc to zoom out
        </span>
      </div>
      <div
        tabIndex={0}
        className="relative w-full overflow-hidden outline-none"
        style={{ height: (layout.maxDepth + 1) * ROW_HEIGHT_PIXELS }}
        aria-label="Flame graph"
      >
        {layout.blocks.map((block) => (
          <FlameBlockView key={block.path || "(root)"} block={block} onHover={handleHover} onZoom={setZoomPath} />
        ))}
      </div>
      {hovered ? <FlameTooltip hovered={hovered} /> : null}
      <div className="p-1 text-zinc-500">
        Width = inclusive time. Gray = estimated from sampled calls. Blocks under{" "}
        {formatPercent(MIN_BLOCK_WIDTH_FRACTION)} of the width are hidden.
      </div>
    </div>
  );
}
