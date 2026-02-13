"use client";

import {
  BookText,
  Calculator,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  FolderClosed,
  Gamepad2,
  SquareTerminal,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useFileSystem, type FileSystemNode } from "@/hooks/use-file-system";
import { cn } from "@/lib/utils";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 } from "uuid";
import {
  CalculatorApplicationWindow,
  FileExplorerApplicationWindow,
  GameApplicationWindow,
  SingleDocumentApplicationWindow,
  TerminalApplicationWindow,
  TextEditorApplicationWindow,
  VisualNovelApplicationWindow,
} from "./application-windows";

type DesktopItem = {
  id: string;
  title: string;
  icon: ReactNode;
  kind: "app" | "file" | "folder";
  onOpen?: (() => void) | null;
  fileNode?: FileSystemNode;
};

type DesktopGridPosition = {
  col: number;
  row: number;
};

type DesktopSortMode = "name-asc" | "name-desc" | "size-asc" | "size-desc";

const DESKTOP_LAYOUT_STORAGE_KEY = "desktop-icon-layout-v2";
const DESKTOP_GRID_COL_WIDTH = 124;
const DESKTOP_GRID_ROW_HEIGHT = 144;
const DESKTOP_GRID_PADDING = 12;
const DESKTOP_ICON_WIDTH = 96;
const DESKTOP_ICON_HEIGHT = 96;

export default function Desktop({
  addWindow,
}: {
  addWindow: (node: ReactNode) => void;
}) {
  const fs = useFileSystem();
  const fsRef = useRef(fs);
  const desktopRootPath = "/home/user/Desktop";
  const containerRef = useRef<HTMLDivElement>(null);
  const iconRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragCandidateRef = useRef<{
    primaryId: string;
    dragIds: string[];
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    sourcePositions: Record<string, DesktopGridPosition>;
    sourcePixels: Record<string, { left: number; top: number }>;
  } | null>(null);
  const [desktopNodes, setDesktopNodes] = useState<FileSystemNode[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [layoutHydrated, setLayoutHydrated] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [sortMode, setSortMode] = useState<DesktopSortMode>("name-asc");
  const [gridRows, setGridRows] = useState(6);
  const [gridCols, setGridCols] = useState(8);
  const [itemPositions, setItemPositions] = useState<Record<string, DesktopGridPosition>>({});
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [dragDelta, setDragDelta] = useState<{ x: number; y: number } | null>(null);
  const draggingIdsRef = useRef<string[]>([]);
  const dragDeltaRef = useRef<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const isSelectingRef = useRef(false);
  const selectionOriginRef = useRef<{ x: number; y: number } | null>(null);
  const selectionBaseRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fsRef.current = fs;
  }, [fs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, DesktopGridPosition>;
        setItemPositions(parsed);
      }
    } catch {
      setItemPositions({});
    } finally {
      setLayoutHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!layoutHydrated || typeof window === "undefined") return;
    window.localStorage.setItem(
      DESKTOP_LAYOUT_STORAGE_KEY,
      JSON.stringify(itemPositions)
    );
  }, [itemPositions, layoutHydrated]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const recalculateGrid = () => {
      const usableHeight = Math.max(
        container.clientHeight - DESKTOP_GRID_PADDING * 2,
        DESKTOP_ICON_HEIGHT
      );
      const usableWidth = Math.max(
        container.clientWidth - DESKTOP_GRID_PADDING * 2,
        DESKTOP_ICON_WIDTH
      );

      const nextRows = Math.max(1, Math.floor(usableHeight / DESKTOP_GRID_ROW_HEIGHT));
      const nextCols = Math.max(1, Math.floor(usableWidth / DESKTOP_GRID_COL_WIDTH));
      setGridRows(nextRows);
      setGridCols(nextCols);
    };

    recalculateGrid();
    const observer = new ResizeObserver(recalculateGrid);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const loadDesktopNodes = useCallback(() => {
    setDesktopNodes(fsRef.current.getChildren(desktopRootPath));
  }, [desktopRootPath]);

  useEffect(() => {
    loadDesktopNodes();
    window.addEventListener("storage", loadDesktopNodes);
    return () => window.removeEventListener("storage", loadDesktopNodes);
  }, [loadDesktopNodes]);

  const getFileIcon = useCallback((node: FileSystemNode) => {
    if (node.type === "directory") {
      return <FolderClosed size={30} className="text-blue-200" />;
    }

    const ext = node.name.split(".").pop()?.toLowerCase();
    const iconConfig: { icon: typeof File; color: string } = (() => {
      switch (ext) {
        case "txt":
        case "md":
        case "pdf":
          return { icon: FileText, color: "text-slate-200" };
        case "js":
        case "ts":
        case "jsx":
        case "tsx":
        case "json":
        case "css":
        case "html":
        case "yml":
        case "yaml":
        case "xml":
        case "toml":
          return { icon: FileCode, color: "text-emerald-200" };
        case "png":
        case "jpg":
        case "jpeg":
        case "gif":
        case "svg":
        case "webp":
          return { icon: FileImage, color: "text-pink-200" };
        case "mp3":
        case "wav":
        case "flac":
        case "ogg":
        case "m4a":
          return { icon: FileAudio, color: "text-violet-200" };
        case "mp4":
        case "mkv":
        case "avi":
        case "mov":
        case "webm":
          return { icon: FileVideo, color: "text-rose-200" };
        default:
          return { icon: File, color: "text-slate-200" };
      }
    })();

    const IconComponent = iconConfig.icon;
    return <IconComponent size={30} className={iconConfig.color} />;
  }, []);

  const getFileOpenAction = useCallback(
    (node: FileSystemNode) => {
      if (node.type !== "file") return null;
      const ext = node.name.split(".").pop()?.toLowerCase();
      const textExtensions = new Set([
        "txt",
        "md",
        "js",
        "ts",
        "jsx",
        "tsx",
        "json",
        "css",
        "html",
        "yml",
        "yaml",
        "xml",
        "toml",
      ]);
      if (textExtensions.has(ext || "")) {
        return () => addWindow(<TextEditorApplicationWindow filePath={node.path} />);
      }
      if (ext === "pdf") {
        return () =>
          addWindow(
            <SingleDocumentApplicationWindow articleId={node.name} title={node.name} />
          );
      }
      return null;
    },
    [addWindow]
  );

  const desktopItems = useMemo<DesktopItem[]>(() => {
    const shortcuts = [
      {
        id: "app-terminal",
        title: "Terminal",
        icon: <SquareTerminal size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<TerminalApplicationWindow identifier={v4()} />),
      },
      {
        id: "app-voxel-game",
        title: "Voxel Game",
        icon: <Gamepad2 size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<GameApplicationWindow />),
      },
      {
        id: "app-visual-novel",
        title: "Visual Novel",
        icon: <BookText size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<VisualNovelApplicationWindow />),
      },
      {
        id: "app-file-explorer",
        title: "File Explorer",
        icon: <FolderClosed size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<FileExplorerApplicationWindow addWindow={addWindow} />),
      },
      {
        id: "app-calculator",
        title: "Calculator",
        icon: <Calculator size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<CalculatorApplicationWindow />),
      },
      {
        id: "file-cv",
        title: "CV.pdf",
        icon: <FileText size={30} />,
        kind: "file" as const,
        onOpen: () =>
          addWindow(
            <SingleDocumentApplicationWindow articleId="CV.pdf" title="CV.pdf" />
          ),
      },
    ];

    const nodes = desktopNodes.map((node) => {
      const openAction =
        node.type === "directory"
          ? () => addWindow(<FileExplorerApplicationWindow addWindow={addWindow} />)
          : getFileOpenAction(node);

      return {
        id: node.path,
        title: node.name,
        icon: getFileIcon(node),
        kind: node.type === "directory" ? ("folder" as const) : ("file" as const),
        fileNode: node,
        onOpen: openAction,
      };
    });

    return [...shortcuts, ...nodes];
  }, [addWindow, desktopNodes, getFileIcon, getFileOpenAction]);

  const getDesktopItemSize = useCallback((item: DesktopItem) => {
    if (item.fileNode?.type === "file") {
      return item.fileNode.size;
    }
    if (item.fileNode?.type === "directory") {
      return 0;
    }
    return 0;
  }, []);

  const sortDesktopItems = useCallback(
    (items: DesktopItem[], mode: DesktopSortMode) => {
      const sorted = [...items];
      sorted.sort((a, b) => {
        if (mode === "name-asc" || mode === "name-desc") {
          const comparison = a.title.localeCompare(b.title, undefined, {
            sensitivity: "base",
            numeric: true,
          });
          return mode === "name-asc" ? comparison : -comparison;
        }

        const comparison = getDesktopItemSize(a) - getDesktopItemSize(b);
        if (comparison !== 0) {
          return mode === "size-asc" ? comparison : -comparison;
        }

        return a.title.localeCompare(b.title, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      });
      return sorted;
    },
    [getDesktopItemSize]
  );

  const getSlotKey = useCallback((position: DesktopGridPosition) => {
    return `${position.col}:${position.row}`;
  }, []);

  const getAutoPosition = useCallback(
    (occupied: Set<string>, startIndex: number): DesktopGridPosition => {
      const safeCols = Math.max(1, gridCols);
      let probe = Math.max(0, startIndex);
      while (probe < 10000) {
        const candidate = {
          col: probe % safeCols,
          row: Math.floor(probe / safeCols),
        };
        const key = `${candidate.col}:${candidate.row}`;
        if (!occupied.has(key)) return candidate;
        probe += 1;
      }
      return { col: 0, row: 0 };
    },
    [gridCols]
  );

  const areLayoutsEqual = useCallback(
    (
      left: Record<string, DesktopGridPosition>,
      right: Record<string, DesktopGridPosition>
    ) => {
      const leftKeys = Object.keys(left);
      const rightKeys = Object.keys(right);
      if (leftKeys.length !== rightKeys.length) return false;
      return leftKeys.every((key) => {
        const l = left[key];
        const r = right[key];
        return Boolean(r) && l.col === r.col && l.row === r.row;
      });
    },
    []
  );

  const applySortedLayout = useCallback(
    (mode: DesktopSortMode) => {
      setSortMode(mode);
      const sorted = sortDesktopItems(desktopItems, mode);
      setItemPositions((previous) => {
        const next = { ...previous };
        const occupied = new Set<string>();
        sorted.forEach((item, index) => {
          const auto = getAutoPosition(occupied, index);
          next[item.id] = auto;
          occupied.add(getSlotKey(auto));
        });
        return next;
      });
    },
    [desktopItems, getAutoPosition, getSlotKey, sortDesktopItems]
  );

  useEffect(() => {
    if (!layoutHydrated) return;

    setItemPositions((previous) => {
      const next: Record<string, DesktopGridPosition> = {};
      const occupied = new Set<string>();
      const knownIds = new Set(desktopItems.map((item) => item.id));
      const pendingIds = new Set(desktopItems.map((item) => item.id));

      const persistOrderIds = Object.keys(previous);

      persistOrderIds.forEach((id) => {
        if (!knownIds.has(id)) return;
        const previousPosition = previous[id];
        if (!previousPosition) return;

        const clamped = {
          col: Math.max(0, previousPosition.col),
          row: Math.max(0, previousPosition.row),
        };
        const key = getSlotKey(clamped);
        if (occupied.has(key)) return;

        next[id] = clamped;
        occupied.add(key);
        pendingIds.delete(id);
      });

      desktopItems.forEach((item, index) => {
        if (!pendingIds.has(item.id)) return;

        const auto = getAutoPosition(occupied, index);
        next[item.id] = auto;
        occupied.add(getSlotKey(auto));
        pendingIds.delete(item.id);
      });

      return areLayoutsEqual(previous, next) ? previous : next;
    });
  }, [areLayoutsEqual, desktopItems, getAutoPosition, getSlotKey, layoutHydrated]);

  const visualOrderedItemIds = useMemo(() => {
    return [...desktopItems]
      .sort((a, b) => {
        const positionA = itemPositions[a.id] ?? { col: 0, row: 0 };
        const positionB = itemPositions[b.id] ?? { col: 0, row: 0 };

        if (positionA.row !== positionB.row) {
          return positionA.row - positionB.row;
        }
        if (positionA.col !== positionB.col) {
          return positionA.col - positionB.col;
        }
        return a.title.localeCompare(b.title, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      })
      .map((item) => item.id);
  }, [desktopItems, itemPositions]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const updateSelection = useCallback((nextSelection: Set<string>) => {
    setSelectedIds(Array.from(nextSelection));
  }, []);

  const selectRange = useCallback(
    (fromId: string, toId: string) => {
      const fromIndex = visualOrderedItemIds.findIndex((id) => id === fromId);
      const toIndex = visualOrderedItemIds.findIndex((id) => id === toId);
      if (fromIndex === -1 || toIndex === -1) return;
      const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const next = new Set<string>();
      for (let i = start; i <= end; i += 1) {
        next.add(visualOrderedItemIds[i]);
      }
      updateSelection(next);
    },
    [updateSelection, visualOrderedItemIds]
  );

  const handleIconMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, id: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();

      containerRef.current?.focus();

      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const iconRect = iconRefs.current.get(id)?.getBoundingClientRect();
        const dragIds = selectedSet.has(id) && selectedSet.size > 0 ? selectedIds : [id];
        const sourcePositions = dragIds.reduce<Record<string, DesktopGridPosition>>(
          (accumulator, dragId) => {
            const source = itemPositions[dragId];
            if (source) {
              accumulator[dragId] = source;
            }
            return accumulator;
          },
          {}
        );
        const sourcePixels = dragIds.reduce<Record<string, { left: number; top: number }>>(
          (accumulator, dragId) => {
            const node = iconRefs.current.get(dragId);
            const container = containerRef.current;
            if (!node || !container) return accumulator;
            const nodeRect = node.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            accumulator[dragId] = {
              left: nodeRect.left - containerRect.left,
              top: nodeRect.top - containerRect.top,
            };
            return accumulator;
          },
          {}
        );

        if (iconRect && sourcePositions[id] && sourcePixels[id]) {
          dragCandidateRef.current = {
            primaryId: id,
            dragIds,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - iconRect.left,
            offsetY: event.clientY - iconRect.top,
            sourcePositions,
            sourcePixels,
          };
        }
      }

      if (event.shiftKey && lastSelectedId) {
        selectRange(lastSelectedId, id);
        setLastSelectedId(id);
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const next = new Set(selectedSet);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        updateSelection(next);
        setLastSelectedId(id);
        return;
      }

      if (selectedSet.has(id) && selectedSet.size > 1) {
        setLastSelectedId(id);
        return;
      }

      updateSelection(new Set([id]));
      setLastSelectedId(id);
    },
    [itemPositions, lastSelectedId, selectRange, selectedIds, selectedSet, updateSelection]
  );

  const handleIconContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, id: string) => {
      event.stopPropagation();
      if (!selectedSet.has(id)) {
        updateSelection(new Set([id]));
        setLastSelectedId(id);
      }
    },
    [selectedSet, updateSelection]
  );

  const startMarquee = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-desktop-icon='true']")) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const origin = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      selectionOriginRef.current = origin;
      isSelectingRef.current = true;
      selectionBaseRef.current = event.ctrlKey || event.metaKey ? new Set(selectedSet) : new Set();
      setMarquee({ x: origin.x, y: origin.y, width: 0, height: 0 });
      if (!event.ctrlKey && !event.metaKey) {
        updateSelection(new Set());
      }
    },
    [selectedSet, updateSelection]
  );

  const endSelection = useCallback(() => {
    if (!isSelectingRef.current) return;
    isSelectingRef.current = false;
    selectionOriginRef.current = null;
    selectionBaseRef.current = new Set();
    setMarquee(null);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const dragCandidate = dragCandidateRef.current;
      if (dragCandidate) {
        const deltaX = Math.abs(event.clientX - dragCandidate.startX);
        const deltaY = Math.abs(event.clientY - dragCandidate.startY);
        if (draggingIdsRef.current.length === 0 && deltaX + deltaY < 5) {
          return;
        }

        if (draggingIdsRef.current.length === 0) {
          draggingIdsRef.current = dragCandidate.dragIds;
          setDraggingIds(dragCandidate.dragIds);
        }

        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();

        const primarySource = dragCandidate.sourcePositions[dragCandidate.primaryId];
        const primarySourcePixel = dragCandidate.sourcePixels[dragCandidate.primaryId];
        if (!primarySource || !primarySourcePixel) return;

        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;

        const rawDeltaX = pointerX - dragCandidate.offsetX - primarySourcePixel.left;
        const rawDeltaY = pointerY - dragCandidate.offsetY - primarySourcePixel.top;

        let minBaseLeft = Number.POSITIVE_INFINITY;
        let minBaseTop = Number.POSITIVE_INFINITY;
        let maxBaseLeft = Number.NEGATIVE_INFINITY;
        let maxBaseTop = Number.NEGATIVE_INFINITY;

        dragCandidate.dragIds.forEach((dragId) => {
          const sourcePixel = dragCandidate.sourcePixels[dragId];
          if (!sourcePixel) return;
          const left = sourcePixel.left;
          const top = sourcePixel.top;
          minBaseLeft = Math.min(minBaseLeft, left);
          minBaseTop = Math.min(minBaseTop, top);
          maxBaseLeft = Math.max(maxBaseLeft, left);
          maxBaseTop = Math.max(maxBaseTop, top);
        });

        if (!Number.isFinite(minBaseLeft) || !Number.isFinite(minBaseTop)) return;

        const minDeltaXAllowed = DESKTOP_GRID_PADDING - minBaseLeft;
        const maxDeltaXAllowed =
          rect.width - DESKTOP_GRID_PADDING - DESKTOP_ICON_WIDTH - maxBaseLeft;
        const minDeltaYAllowed = DESKTOP_GRID_PADDING - minBaseTop;
        const maxDeltaYAllowed =
          rect.height - DESKTOP_GRID_PADDING - DESKTOP_ICON_HEIGHT - maxBaseTop;

        const nextDelta = {
          x: Math.min(Math.max(rawDeltaX, minDeltaXAllowed), maxDeltaXAllowed),
          y: Math.min(Math.max(rawDeltaY, minDeltaYAllowed), maxDeltaYAllowed),
        };
        dragDeltaRef.current = nextDelta;
        setDragDelta(nextDelta);
        return;
      }

      if (!isSelectingRef.current || !selectionOriginRef.current) return;
      if (event.buttons === 0) {
        endSelection();
        return;
      }

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const origin = selectionOriginRef.current;
      const x = Math.min(origin.x, current.x);
      const y = Math.min(origin.y, current.y);
      const width = Math.abs(origin.x - current.x);
      const height = Math.abs(origin.y - current.y);
      setMarquee({ x, y, width, height });

      const selectionRect = { left: x, top: y, right: x + width, bottom: y + height };
      const nextSelection = new Set(selectionBaseRef.current);
      desktopItems.forEach((item) => {
        const element = iconRefs.current.get(item.id);
        if (!element) return;
        const hitTarget = element.querySelector(
          "[data-desktop-hit='true']"
        ) as HTMLElement | null;
        const iconRect = (hitTarget ?? element).getBoundingClientRect();
        const relative = {
          left: iconRect.left - rect.left,
          top: iconRect.top - rect.top,
          right: iconRect.right - rect.left,
          bottom: iconRect.bottom - rect.top,
        };
        const intersects =
          selectionRect.left <= relative.right &&
          selectionRect.right >= relative.left &&
          selectionRect.top <= relative.bottom &&
          selectionRect.bottom >= relative.top;
        if (intersects) {
          nextSelection.add(item.id);
        }
      });

      updateSelection(nextSelection);
    };

    const handleMouseUp = () => {
      const dragCandidate = dragCandidateRef.current;
      const activeDraggingIds = draggingIdsRef.current;
      const activeDragDelta = dragDeltaRef.current;
      if (dragCandidate && activeDraggingIds.length > 0) {
        const container = containerRef.current;
        if (container && activeDragDelta) {
          const primarySource = dragCandidate.sourcePositions[dragCandidate.primaryId];
          if (primarySource) {
            const deltaCol = Math.round(activeDragDelta.x / DESKTOP_GRID_COL_WIDTH);
            const deltaRow = Math.round(activeDragDelta.y / DESKTOP_GRID_ROW_HEIGHT);

            setItemPositions((previous) => {
              const next = { ...previous };
              const movedSet = new Set(dragCandidate.dragIds);
              const occupied = new Set<string>();

              Object.entries(next).forEach(([itemId, position]) => {
                if (!movedSet.has(itemId)) {
                  occupied.add(`${position.col}:${position.row}`);
                }
              });

              const movedOrder = dragCandidate.dragIds
                .map((id) => ({ id, source: dragCandidate.sourcePositions[id] }))
                .filter((entry) => Boolean(entry.source))
                .sort((a, b) => {
                  if (a.source!.row !== b.source!.row) return a.source!.row - b.source!.row;
                  if (a.source!.col !== b.source!.col) return a.source!.col - b.source!.col;
                  return a.id.localeCompare(b.id);
                });

              const findNextFree = (startCol: number, startRow: number) => {
                const safeCols = Math.max(1, gridCols);
                const safeRows = Math.max(1, gridRows);
                let startIndex =
                  Math.max(0, Math.min(safeCols - 1, startCol)) +
                  Math.max(0, Math.min(safeRows - 1, startRow)) * safeCols;
                for (let probe = startIndex; probe < safeCols * safeRows; probe += 1) {
                  const col = probe % safeCols;
                  const row = Math.floor(probe / safeCols);
                  const key = `${col}:${row}`;
                  if (!occupied.has(key)) return { col, row };
                }
                for (let probe = 0; probe < startIndex; probe += 1) {
                  const col = probe % safeCols;
                  const row = Math.floor(probe / safeCols);
                  const key = `${col}:${row}`;
                  if (!occupied.has(key)) return { col, row };
                }
                return {
                  col: Math.max(0, Math.min(safeCols - 1, startCol)),
                  row: Math.max(0, Math.min(safeRows - 1, startRow)),
                };
              };

              movedOrder.forEach(({ id, source }) => {
                if (!source) return;
                const desiredCol = Math.max(
                  0,
                  Math.min(gridCols - 1, source.col + deltaCol)
                );
                const desiredRow = Math.max(
                  0,
                  Math.min(gridRows - 1, source.row + deltaRow)
                );
                const desiredKey = `${desiredCol}:${desiredRow}`;

                const placement = occupied.has(desiredKey)
                  ? findNextFree(desiredCol, desiredRow)
                  : { col: desiredCol, row: desiredRow };

                next[id] = placement;
                occupied.add(`${placement.col}:${placement.row}`);
              });

              return next;
            });
          }
        }

        updateSelection(new Set(activeDraggingIds));
        setLastSelectedId(dragCandidate.primaryId);
      }

      dragCandidateRef.current = null;
      draggingIdsRef.current = [];
      dragDeltaRef.current = null;
      setDraggingIds([]);
      setDragDelta(null);
      endSelection();
    };

    const handleBlur = () => {
      dragCandidateRef.current = null;
      draggingIdsRef.current = [];
      dragDeltaRef.current = null;
      setDraggingIds([]);
      setDragDelta(null);
      endSelection();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [desktopItems, endSelection, gridCols, gridRows, updateSelection]);

  const handleDesktopContextMenu = useCallback(() => {
    return;
  }, []);

  const createUniqueName = useCallback(
    (baseName: string) => {
      if (!fs.exists(`${desktopRootPath}/${baseName}`)) return baseName;
      let counter = 1;
      let candidate = baseName;
      const nameParts = baseName.split(".");
      const hasExtension = nameParts.length > 1;
      const extension = hasExtension ? `.${nameParts.pop()}` : "";
      const prefix = nameParts.join(".");
      while (fs.exists(`${desktopRootPath}/${candidate}`)) {
        candidate = `${prefix} (${counter})${extension}`;
        counter += 1;
      }
      return candidate;
    },
    [desktopRootPath, fs]
  );

  const handleCreateFolder = useCallback(() => {
    const name = window.prompt("Folder name", "New Folder");
    if (!name) return;
    const unique = createUniqueName(name);
    fs.createDirectory(desktopRootPath, unique);
  }, [createUniqueName, desktopRootPath, fs]);

  const handleCreateTextFile = useCallback(() => {
    const name = window.prompt("File name", "New Text Document.txt");
    if (!name) return;
    const unique = createUniqueName(name);
    fs.createFile(desktopRootPath, unique, "");
  }, [createUniqueName, desktopRootPath, fs]);

  const handleDeleteSelected = useCallback(() => {
    const targets = desktopItems.filter((item) => selectedSet.has(item.id));
    targets.forEach((item) => {
      if (item.fileNode?.path) {
        fs.deleteNode(item.fileNode.path);
      }
    });
    updateSelection(new Set());
  }, [desktopItems, fs, selectedSet, updateSelection]);

  const handleDeleteByContext = useCallback(
    (itemId: string) => {
      const clickedItem = desktopItems.find((item) => item.id === itemId);
      if (!clickedItem?.fileNode) return;

      const selectedFileTargets = desktopItems.filter(
        (item) => selectedSet.has(item.id) && Boolean(item.fileNode)
      );

      const shouldDeleteSelection =
        selectedSet.has(itemId) && selectedFileTargets.length > 1;

      const targets = shouldDeleteSelection
        ? selectedFileTargets
        : [clickedItem];

      targets.forEach((item) => {
        if (item.fileNode?.path) {
          fs.deleteNode(item.fileNode.path);
        }
      });

      updateSelection(new Set());
      setLastSelectedId(null);
    },
    [desktopItems, fs, selectedSet, updateSelection]
  );

  const handleRename = useCallback(
    (itemId: string) => {
      const item = desktopItems.find((entry) => entry.id === itemId);
      if (!item?.fileNode) return;
      setRenameTargetId(itemId);
      setRenameValue(item.fileNode.name);
      setRenameError("");
    },
    [desktopItems]
  );

  const handleRenameSubmit = useCallback(() => {
    if (!renameTargetId) return;
    const item = desktopItems.find((entry) => entry.id === renameTargetId);
    if (!item?.fileNode) return;

    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Name is required.");
      return;
    }

    if (trimmed === item.fileNode.name) {
      setRenameTargetId(null);
      setRenameError("");
      return;
    }

    const siblingConflict = fs
      .getChildren(item.fileNode.parentPath)
      .some((node) => node.name === trimmed && node.path !== item.fileNode.path);

    if (siblingConflict) {
      setRenameError("An item with this name already exists.");
      return;
    }

    fs.rename(item.fileNode.path, trimmed);
    setRenameTargetId(null);
    setRenameValue("");
    setRenameError("");
  }, [desktopItems, fs, renameTargetId, renameValue]);

  const moveSelectionByOffset = useCallback(
    (offset: number, extendRange: boolean) => {
      if (visualOrderedItemIds.length === 0) return;

      const currentId =
        (lastSelectedId && selectedSet.has(lastSelectedId)
          ? lastSelectedId
          : selectedIds[0]) ?? null;

      let currentIndex = currentId
        ? visualOrderedItemIds.findIndex((id) => id === currentId)
        : -1;

      if (currentIndex === -1) {
        currentIndex = offset > 0 ? -1 : visualOrderedItemIds.length;
      }

      const nextIndex = Math.max(
        0,
        Math.min(visualOrderedItemIds.length - 1, currentIndex + offset)
      );
      const nextId = visualOrderedItemIds[nextIndex];
      if (!nextId) return;

      if (extendRange && lastSelectedId) {
        selectRange(lastSelectedId, nextId);
      } else {
        updateSelection(new Set([nextId]));
      }

      setLastSelectedId(nextId);
      iconRefs.current
        .get(nextId)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    },
    [lastSelectedId, selectRange, selectedIds, selectedSet, updateSelection, visualOrderedItemIds]
  );

  const handleOpenSelected = useCallback(() => {
    const activeId =
      (lastSelectedId && selectedSet.has(lastSelectedId)
        ? lastSelectedId
        : selectedIds[0]) ?? null;
    if (!activeId) return;
    desktopItems.find((item) => item.id === activeId)?.onOpen?.();
  }, [desktopItems, lastSelectedId, selectedIds, selectedSet]);

  const handleDesktopKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        const isEditable =
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          target.isContentEditable ||
          Boolean(target.closest(".monaco-editor"));
        if (isEditable) return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelectionByOffset(-1, event.shiftKey);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelectionByOffset(1, event.shiftKey);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        handleOpenSelected();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0) {
        event.preventDefault();
        handleDeleteSelected();
      }
    },
    [handleDeleteSelected, handleOpenSelected, moveSelectionByOffset, selectedIds.length]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          tabIndex={0}
          className="w-screen h-screen absolute top-0 bottom-0 left-0 right-0 overflow-hidden z-0 select-none"
          onMouseDownCapture={() => {
            containerRef.current?.focus();
          }}
          onMouseDown={startMarquee}
          onKeyDown={handleDesktopKeyDown}
          onContextMenu={handleDesktopContextMenu}
        >
          <Dialog
            open={Boolean(renameTargetId)}
            onOpenChange={(open) => {
              if (!open) {
                setRenameTargetId(null);
                setRenameValue("");
                setRenameError("");
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Rename</DialogTitle>
                <DialogDescription>
                  Choose a new name for this item.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="desktop-rename-input">Name</Label>
                <Input
                  id="desktop-rename-input"
                  value={renameValue}
                  onChange={(event) => {
                    setRenameValue(event.target.value);
                    if (renameError) setRenameError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleRenameSubmit();
                    }
                  }}
                  autoFocus
                />
                {renameError ? (
                  <div className="text-xs text-destructive">{renameError}</div>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRenameTargetId(null);
                    setRenameValue("");
                    setRenameError("");
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleRenameSubmit}>Rename</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="h-[calc(100vh-52px)] w-full bottom-0 left-0 right-0 absolute p-4">
            <div className="relative w-full h-full">
              {desktopItems.map((item) => (
                <ContextMenu key={item.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      data-desktop-icon="true"
                      ref={(node) => {
                        if (node) {
                          iconRefs.current.set(item.id, node);
                        } else {
                          iconRefs.current.delete(item.id);
                        }
                      }}
                      onMouseDown={(event) => handleIconMouseDown(event, item.id)}
                      onDoubleClick={() => item.onOpen?.()}
                      onContextMenu={(event) => handleIconContextMenu(event, item.id)}
                      className="absolute"
                      style={(() => {
                        const position = itemPositions[item.id] ?? { col: 0, row: 0 };
                        const isDragging =
                          draggingIds.includes(item.id) && dragDelta && dragCandidateRef.current;
                        const source = dragCandidateRef.current?.sourcePositions[item.id] ?? position;
                        const sourcePixel = dragCandidateRef.current?.sourcePixels[item.id];
                        const left = isDragging
                          ? (sourcePixel?.left ?? DESKTOP_GRID_PADDING + source.col * DESKTOP_GRID_COL_WIDTH) + dragDelta.x
                          : DESKTOP_GRID_PADDING + position.col * DESKTOP_GRID_COL_WIDTH;
                        const top = isDragging
                          ? (sourcePixel?.top ?? DESKTOP_GRID_PADDING + source.row * DESKTOP_GRID_ROW_HEIGHT) + dragDelta.y
                          : DESKTOP_GRID_PADDING + position.row * DESKTOP_GRID_ROW_HEIGHT;
                        return {
                          left,
                          top,
                          zIndex: isDragging ? 40 : 1,
                          transition: isDragging
                            ? "none"
                            : "left 180ms ease-out, top 180ms ease-out",
                        };
                      })()}
                    >
                      <DesktopIcon
                        icon={item.icon}
                        title={item.title}
                        selected={selectedSet.has(item.id)}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52">
                    <ContextMenuItem
                      onClick={() => item.onOpen?.()}
                      disabled={!item.onOpen}
                    >
                      Open
                    </ContextMenuItem>
                    {item.kind === "file" && item.fileNode && (
                      <>
                        {(() => {
                          const ext = item.fileNode!.name.split(".").pop()?.toLowerCase();
                          const textExtensions = new Set([
                            "txt",
                            "md",
                            "js",
                            "ts",
                            "jsx",
                            "tsx",
                            "json",
                            "css",
                            "html",
                            "yml",
                            "yaml",
                            "xml",
                            "toml",
                          ]);
                          return textExtensions.has(ext || "");
                        })() ? (
                          <ContextMenuItem
                            onClick={() =>
                              addWindow(
                                <TextEditorApplicationWindow
                                  filePath={item.fileNode!.path}
                                />
                              )
                            }
                          >
                            Open in Text Editor
                          </ContextMenuItem>
                        ) : null}
                        {item.fileNode.name.toLowerCase().endsWith(".pdf") ? (
                          <ContextMenuItem
                            onClick={() =>
                              addWindow(
                                <SingleDocumentApplicationWindow
                                  articleId={item.fileNode!.name}
                                  title={item.fileNode!.name}
                                />
                              )
                            }
                          >
                            Open in Document Viewer
                          </ContextMenuItem>
                        ) : null}
                      </>
                    )}
                    {item.kind === "folder" && (
                      <ContextMenuItem onClick={() => item.onOpen?.()}>
                        Open in File Explorer
                      </ContextMenuItem>
                    )}
                    {item.fileNode ? (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => handleRename(item.id)}>
                          Rename
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleDeleteByContext(item.id)}>
                          Delete
                        </ContextMenuItem>
                      </>
                    ) : null}
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          </div>
          {marquee ? (
            <div
              className="absolute border border-white/60 bg-white/15 pointer-events-none rounded-sm"
              style={{
                left: `${marquee.x}px`,
                top: `${marquee.y}px`,
                width: `${marquee.width}px`,
                height: `${marquee.height}px`,
              }}
            />
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={handleCreateFolder}>New Folder</ContextMenuItem>
        <ContextMenuItem onClick={handleCreateTextFile}>
          New Text Document
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Sort by</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuRadioGroup
              value={sortMode}
              onValueChange={(value) => applySortedLayout(value as DesktopSortMode)}
            >
              <ContextMenuRadioItem value="name-asc">
                Alphabetical (A → Z)
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="name-desc">
                Alphabetical (Z → A)
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="size-asc">
                Size (Small → Large)
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="size-desc">
                Size (Large → Small)
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={loadDesktopNodes}>Refresh</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DesktopIcon({
  icon,
  title,
  selected = false,
}: {
  icon: ReactNode;
  title: string;
  selected?: boolean;
}) {
  return (
    <div
      data-desktop-hit="true"
      className={cn(
        "w-24 rounded-2xl px-2 py-3 text-white cursor-pointer transition-all duration-200",
        "bg-white/15 backdrop-blur-xl hover:bg-white/25",
        selected && "bg-white/30 ring-2 ring-white/70"
      )}
    >
      <div className="h-[32px] w-full flex justify-center items-center">
        {icon}
      </div>
      <div
        className="mt-2 text-xs font-medium text-center leading-4 overflow-hidden break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
        title={title}
      >
        {title}
      </div>
    </div>
  );
}
