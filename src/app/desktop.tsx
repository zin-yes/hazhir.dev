"use client";

import {
  BookOpen,
  BookText,
  Calculator,
  ClipboardPaste,
  Copy,
  Edit3,
  Eye,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileSymlink,
  FileText,
  FileVideo,
  FilePlus,
  FolderClosed,
  FolderPlus,
  Gamepad2,
  RefreshCw,
  Scissors,
  Trash2,
  ArrowUpDown,
  TerminalSquare,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { useFileSystem, type FileSystemNode } from "@/hooks/use-file-system";
import {
  executeFilePath,
  isExecutableFile,
  isShortcutFile,
} from "@/lib/file-execution";
import {
  FILE_PATH_DROP_EVENT,
  readFileDragPayload,
} from "@/lib/file-transfer-dnd";
import {
  getFileClipboard,
  setFileClipboard,
  subscribeToFileClipboard,
} from "@/lib/file-clipboard";
import { parseShortcut } from "@/lib/shortcut";
import { getHomePath } from "@/lib/system-user";
import { cn } from "@/lib/utils";

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  FileExplorerApplicationWindow,
  SingleDocumentApplicationWindow,
  TextEditorApplicationWindow,
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
  const desktopRootPath = `${getHomePath()}/Desktop`;
  const containerRef = useRef<HTMLDivElement>(null);
  const gridLayerRef = useRef<HTMLDivElement>(null);
  const desktopContextPointRef = useRef<{ x: number; y: number } | null>(null);
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
  const [createMode, setCreateMode] = useState<"file" | "folder" | null>(
    null,
  );
  const [createValue, setCreateValue] = useState("");
  const [createError, setCreateError] = useState("");
  const [clipboard, setClipboard] = useState(getFileClipboard);
  const [sortMode, setSortMode] = useState<DesktopSortMode>("name-asc");
  const [gridRows, setGridRows] = useState(6);
  const [gridCols, setGridCols] = useState(8);
  const [itemPositions, setItemPositions] = useState<
    Record<string, DesktopGridPosition>
  >({});
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [dragDelta, setDragDelta] = useState<{ x: number; y: number } | null>(
    null,
  );
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
    return subscribeToFileClipboard((nextClipboard) => {
      setClipboard(nextClipboard);
    });
  }, []);

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
      JSON.stringify(itemPositions),
    );
  }, [itemPositions, layoutHydrated]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const recalculateGrid = () => {
      const usableHeight = Math.max(
        container.clientHeight - DESKTOP_GRID_PADDING * 2,
        DESKTOP_ICON_HEIGHT,
      );
      const usableWidth = Math.max(
        container.clientWidth - DESKTOP_GRID_PADDING * 2,
        DESKTOP_ICON_WIDTH,
      );

      const nextRows = Math.max(
        1,
        Math.floor(usableHeight / DESKTOP_GRID_ROW_HEIGHT),
      );
      const nextCols = Math.max(
        1,
        Math.floor(usableWidth / DESKTOP_GRID_COL_WIDTH),
      );
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

    if (isShortcutFile(node)) {
      const shortcut = parseShortcut(node.contents ?? "");
      const iconName = shortcut?.icon;

      const iconByName: Record<string, ReactNode> = {
        TerminalSquare: <TerminalSquare size={30} className="text-white" />,
        FolderClosed: <FolderClosed size={30} className="text-white" />,
        Gamepad2: <Gamepad2 size={30} className="text-white" />,
        Calculator: <Calculator size={30} className="text-white" />,
        BookText: <BookText size={30} className="text-white" />,
        BookOpen: <BookOpen size={30} className="text-white" />,
      };

      return iconName && iconByName[iconName] ? (
        iconByName[iconName]
      ) : (
        <FileSymlink size={30} className="text-white" />
      );
    }

    if (isExecutableFile(node)) {
      return <FileCode size={30} className="text-orange-200" />;
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

      if (isShortcutFile(node) || isExecutableFile(node)) {
        return () => {
          executeFilePath(node.path, fs);
        };
      }

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
        "shortcut",
      ]);
      if (textExtensions.has(ext || "")) {
        return () =>
          addWindow(<TextEditorApplicationWindow filePath={node.path} />);
      }
      if (ext === "pdf") {
        return () =>
          addWindow(
            <SingleDocumentApplicationWindow
              articleId={node.name}
              title={node.name}
            />,
          );
      }
      return null;
    },
    [addWindow, fs],
  );

  const desktopItems = useMemo<DesktopItem[]>(() => {
    const nodes = desktopNodes.map((node) => {
      const shortcutMeta =
        node.type === "file" && node.name.endsWith(".shortcut")
          ? parseShortcut(node.contents ?? "")
          : null;
      const openAction =
        node.type === "directory"
          ? () =>
              addWindow(
                <FileExplorerApplicationWindow
                  addWindow={addWindow}
                  initialPath={node.path}
                />,
              )
          : getFileOpenAction(node);

      return {
        id: node.path,
        title: shortcutMeta?.iconDisplayText ?? shortcutMeta?.name ?? node.name,
        icon: getFileIcon(node),
        kind:
          node.type === "directory" ? ("folder" as const) : ("file" as const),
        fileNode: node,
        onOpen: openAction,
      };
    });

    return nodes;
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
    [getDesktopItemSize],
  );

  const desktopItemById = useMemo(
    () =>
      desktopItems.reduce<Record<string, DesktopItem>>((accumulator, item) => {
        accumulator[item.id] = item;
        return accumulator;
      }, {}),
    [desktopItems],
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
    [gridCols],
  );

  const getGridPositionFromClientPoint = useCallback(
    (clientX: number, clientY: number): DesktopGridPosition => {
      const layerRect =
        gridLayerRef.current?.getBoundingClientRect() ??
        containerRef.current?.getBoundingClientRect();

      if (!layerRect) {
        return { col: 0, row: 0 };
      }

      const rawCol = Math.round(
        (clientX - layerRect.left - DESKTOP_GRID_PADDING - DESKTOP_ICON_WIDTH / 2) /
          DESKTOP_GRID_COL_WIDTH,
      );
      const rawRow = Math.round(
        (clientY - layerRect.top - DESKTOP_GRID_PADDING - DESKTOP_ICON_HEIGHT / 2) /
          DESKTOP_GRID_ROW_HEIGHT,
      );

      return {
        col: Math.max(0, Math.min(Math.max(1, gridCols) - 1, rawCol)),
        row: Math.max(0, Math.min(Math.max(1, gridRows) - 1, rawRow)),
      };
    },
    [gridCols, gridRows],
  );

  const findNearestAvailablePosition = useCallback(
    (
      occupied: Set<string>,
      desired: DesktopGridPosition,
      fallbackStartIndex: number,
    ): DesktopGridPosition => {
      const safeCols = Math.max(1, gridCols);
      const safeRows = Math.max(1, gridRows);

      let best: { position: DesktopGridPosition; score: number } | null = null;

      for (let row = 0; row < safeRows; row += 1) {
        for (let col = 0; col < safeCols; col += 1) {
          const key = `${col}:${row}`;
          if (occupied.has(key)) continue;

          const dx = col - desired.col;
          const dy = row - desired.row;
          const score = dx * dx + dy * dy;
          if (!best || score < best.score) {
            best = {
              position: { col, row },
              score,
            };
          }
        }
      }

      return best?.position ?? getAutoPosition(occupied, fallbackStartIndex);
    },
    [getAutoPosition, gridCols, gridRows],
  );

  const placePathsNearClientPoint = useCallback(
    (paths: string[], clientX: number, clientY: number) => {
      if (!paths.length) return;

      const normalizedPaths = Array.from(
        new Set(paths.map((path) => fs.normalizePath(path))),
      );
      const currentDesktopIds = new Set(desktopItems.map((item) => item.id));
      const desired = getGridPositionFromClientPoint(clientX, clientY);

      setItemPositions((previous) => {
        const next = { ...previous };
        const movingSet = new Set(normalizedPaths);
        const occupied = new Set<string>();

        Object.entries(next).forEach(([id, position]) => {
          if (!currentDesktopIds.has(id)) return;
          if (movingSet.has(id)) return;
          occupied.add(`${position.col}:${position.row}`);
        });

        normalizedPaths.forEach((path, index) => {
          const fallbackStartIndex = desired.row * Math.max(1, gridCols) + desired.col + index;
          const placement = findNearestAvailablePosition(
            occupied,
            desired,
            fallbackStartIndex,
          );
          next[path] = placement;
          occupied.add(`${placement.col}:${placement.row}`);
        });

        return next;
      });
    },
    [
      desktopItems,
      findNearestAvailablePosition,
      fs,
      getGridPositionFromClientPoint,
      gridCols,
    ],
  );

  const areLayoutsEqual = useCallback(
    (
      left: Record<string, DesktopGridPosition>,
      right: Record<string, DesktopGridPosition>,
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
    [],
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
    [desktopItems, getAutoPosition, getSlotKey, sortDesktopItems],
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

      desktopItems.forEach((item) => {
        if (!pendingIds.has(item.id)) return;

        const auto = getAutoPosition(occupied, 0);
        next[item.id] = auto;
        occupied.add(getSlotKey(auto));
        pendingIds.delete(item.id);
      });

      return areLayoutsEqual(previous, next) ? previous : next;
    });
  }, [
    areLayoutsEqual,
    desktopItems,
    getAutoPosition,
    getSlotKey,
    layoutHydrated,
  ]);

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
      const [start, end] =
        fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const next = new Set<string>();
      for (let i = start; i <= end; i += 1) {
        next.add(visualOrderedItemIds[i]);
      }
      updateSelection(next);
    },
    [updateSelection, visualOrderedItemIds],
  );

  const handleIconMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, id: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();

      containerRef.current?.focus();

      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const iconRect = iconRefs.current.get(id)?.getBoundingClientRect();
        const dragIds =
          selectedSet.has(id) && selectedSet.size > 0 ? selectedIds : [id];
        const sourcePositions = dragIds.reduce<
          Record<string, DesktopGridPosition>
        >((accumulator, dragId) => {
          const source = itemPositions[dragId];
          if (source) {
            accumulator[dragId] = source;
          }
          return accumulator;
        }, {});
        const sourcePixels = dragIds.reduce<
          Record<string, { left: number; top: number }>
        >((accumulator, dragId) => {
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
        }, {});

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
    [
      itemPositions,
      lastSelectedId,
      selectRange,
      selectedIds,
      selectedSet,
      updateSelection,
    ],
  );

  const handleIconContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, id: string) => {
      event.stopPropagation();
      if (!selectedSet.has(id)) {
        updateSelection(new Set([id]));
        setLastSelectedId(id);
      }
    },
    [selectedSet, updateSelection],
  );

  const startMarquee = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-desktop-icon='true']")) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const origin = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      selectionOriginRef.current = origin;
      isSelectingRef.current = true;
      selectionBaseRef.current =
        event.ctrlKey || event.metaKey ? new Set(selectedSet) : new Set();
      setMarquee({ x: origin.x, y: origin.y, width: 0, height: 0 });
      if (!event.ctrlKey && !event.metaKey) {
        updateSelection(new Set());
      }
    },
    [selectedSet, updateSelection],
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

        const primarySource =
          dragCandidate.sourcePositions[dragCandidate.primaryId];
        const primarySourcePixel =
          dragCandidate.sourcePixels[dragCandidate.primaryId];
        if (!primarySource || !primarySourcePixel) return;

        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;

        const rawDeltaX =
          pointerX - dragCandidate.offsetX - primarySourcePixel.left;
        const rawDeltaY =
          pointerY - dragCandidate.offsetY - primarySourcePixel.top;

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

        if (!Number.isFinite(minBaseLeft) || !Number.isFinite(minBaseTop))
          return;

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
      const current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const origin = selectionOriginRef.current;
      const x = Math.min(origin.x, current.x);
      const y = Math.min(origin.y, current.y);
      const width = Math.abs(origin.x - current.x);
      const height = Math.abs(origin.y - current.y);
      setMarquee({ x, y, width, height });

      const selectionRect = {
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
      };
      const nextSelection = new Set(selectionBaseRef.current);
      desktopItems.forEach((item) => {
        const element = iconRefs.current.get(item.id);
        if (!element) return;
        const hitTarget = element.querySelector(
          "[data-desktop-hit='true']",
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

    const handleMouseUp = (event: MouseEvent) => {
      const dragCandidate = dragCandidateRef.current;
      const activeDraggingIds = draggingIdsRef.current;
      const activeDragDelta = dragDeltaRef.current;
      if (dragCandidate && activeDraggingIds.length > 0) {
        const container = containerRef.current;

        let didExternalTransfer = false;
        let didFolderDropTransfer = false;
        if (container) {
          const dropTarget = document.elementFromPoint(
            event.clientX,
            event.clientY,
          ) as HTMLElement | null;
          const dropZone = dropTarget?.closest(
            "[data-file-drop-zone='true']",
          ) as HTMLElement | null;
          const dropKind = dropZone?.dataset.fileDropKind;
          const destinationPath = dropZone?.dataset.fileDropPath;
          const isInsideDesktop = Boolean(
            dropTarget && container.contains(dropTarget),
          );

          if (isInsideDesktop && dropKind === "directory" && destinationPath) {
            const sourcePaths = dragCandidate.dragIds
              .map(
                (dragId) =>
                  desktopItems.find((item) => item.id === dragId)?.fileNode
                    ?.path,
              )
              .filter((path): path is string => Boolean(path));

            if (sourcePaths.length > 0) {
              const uniquePaths = Array.from(
                new Set(sourcePaths.map((item) => fs.normalizePath(item))),
              );

              uniquePaths.forEach((sourcePath) => {
                const sourceNode = fs.getNode(sourcePath);
                if (!sourceNode || sourceNode.readOnly) return;
                if (
                  fs.normalizePath(sourceNode.parentPath) ===
                  fs.normalizePath(destinationPath)
                ) {
                  return;
                }
                fs.move(sourcePath, destinationPath);
              });

              didFolderDropTransfer = true;
            }
          }

          if (!isInsideDesktop) {
            const sourcePaths = dragCandidate.dragIds
              .map(
                (dragId) =>
                  desktopItems.find((item) => item.id === dragId)?.fileNode
                    ?.path,
              )
              .filter((path): path is string => Boolean(path));

            if (sourcePaths.length > 0 && dropKind === "terminal") {
              dropZone?.dispatchEvent(
                new CustomEvent(FILE_PATH_DROP_EVENT, {
                  bubbles: true,
                  detail: { paths: sourcePaths },
                }),
              );
              didExternalTransfer = true;
            } else if (destinationPath) {
              if (sourcePaths.length > 0) {
                const uniquePaths = Array.from(
                  new Set(sourcePaths.map((item) => fs.normalizePath(item))),
                );

                uniquePaths.forEach((sourcePath) => {
                  const sourceNode = fs.getNode(sourcePath);
                  if (!sourceNode || sourceNode.readOnly) return;
                  if (
                    fs.normalizePath(sourceNode.parentPath) ===
                    fs.normalizePath(destinationPath)
                  ) {
                    return;
                  }
                  fs.move(sourcePath, destinationPath);
                });
                didExternalTransfer = true;
              }
            }
          }
        }

        if (
          !didExternalTransfer &&
          !didFolderDropTransfer &&
          container &&
          activeDragDelta
        ) {
          const primarySource =
            dragCandidate.sourcePositions[dragCandidate.primaryId];
          if (primarySource) {
            const deltaCol = Math.round(
              activeDragDelta.x / DESKTOP_GRID_COL_WIDTH,
            );
            const deltaRow = Math.round(
              activeDragDelta.y / DESKTOP_GRID_ROW_HEIGHT,
            );

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
                .map((id) => ({
                  id,
                  source: dragCandidate.sourcePositions[id],
                }))
                .filter((entry) => Boolean(entry.source))
                .sort((a, b) => {
                  if (a.source!.row !== b.source!.row)
                    return a.source!.row - b.source!.row;
                  if (a.source!.col !== b.source!.col)
                    return a.source!.col - b.source!.col;
                  return a.id.localeCompare(b.id);
                });

              const findNextFree = (startCol: number, startRow: number) => {
                const safeCols = Math.max(1, gridCols);
                const safeRows = Math.max(1, gridRows);
                let startIndex =
                  Math.max(0, Math.min(safeCols - 1, startCol)) +
                  Math.max(0, Math.min(safeRows - 1, startRow)) * safeCols;
                for (
                  let probe = startIndex;
                  probe < safeCols * safeRows;
                  probe += 1
                ) {
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
                  Math.min(gridCols - 1, source.col + deltaCol),
                );
                const desiredRow = Math.max(
                  0,
                  Math.min(gridRows - 1, source.row + deltaRow),
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

        if (didExternalTransfer || didFolderDropTransfer) {
          updateSelection(new Set());
          setLastSelectedId(null);
        } else {
          updateSelection(new Set(activeDraggingIds));
          setLastSelectedId(dragCandidate.primaryId);
        }
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
  }, [desktopItems, endSelection, fs, gridCols, gridRows, updateSelection]);

  const handleDesktopContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.clientX > 0 || event.clientY > 0) {
        desktopContextPointRef.current = {
          x: event.clientX,
          y: event.clientY,
        };
      }
    },
    [],
  );

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
    [desktopRootPath, fs],
  );

  const handleCreateFolder = useCallback(() => {
    setCreateMode("folder");
    setCreateValue("New Folder");
    setCreateError("");
  }, []);

  const handleCreateTextFile = useCallback(() => {
    setCreateMode("file");
    setCreateValue("New Text Document.txt");
    setCreateError("");
  }, []);

  const handleCreateSubmit = useCallback(() => {
    if (!createMode) return;
    const trimmed = createValue.trim();
    if (!trimmed) {
      setCreateError("Name is required.");
      return;
    }

    const unique = createUniqueName(trimmed);
    const ok =
      createMode === "folder"
        ? fs.createDirectory(desktopRootPath, unique)
        : fs.createFile(desktopRootPath, unique, "");

    if (!ok) {
      setCreateError("Unable to create this item.");
      return;
    }

    const createdPath = fs.normalizePath(`${desktopRootPath}/${unique}`);
    const fallbackRect =
      gridLayerRef.current?.getBoundingClientRect() ??
      containerRef.current?.getBoundingClientRect();
    const fallbackPoint = {
      x: (fallbackRect?.left ?? 0) + (fallbackRect?.width ?? 0) / 2,
      y: (fallbackRect?.top ?? 0) + (fallbackRect?.height ?? 0) / 2,
    };
    const targetPoint = desktopContextPointRef.current ?? fallbackPoint;
    placePathsNearClientPoint([createdPath], targetPoint.x, targetPoint.y);

    setCreateMode(null);
    setCreateValue("");
    setCreateError("");
  }, [
    createMode,
    createUniqueName,
    createValue,
    desktopRootPath,
    fs,
    placePathsNearClientPoint,
  ]);

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
        (item) => selectedSet.has(item.id) && Boolean(item.fileNode),
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
    [desktopItems, fs, selectedSet, updateSelection],
  );

  const getClipboardTargetsForItem = useCallback(
    (itemId: string) => {
      const selectedFileTargets = desktopItems.filter(
        (item) => selectedSet.has(item.id) && Boolean(item.fileNode),
      );

      if (selectedSet.has(itemId) && selectedFileTargets.length > 0) {
        return selectedFileTargets;
      }

      const clickedItem = desktopItems.find(
        (item) => item.id === itemId && Boolean(item.fileNode),
      );
      return clickedItem ? [clickedItem] : [];
    },
    [desktopItems, selectedSet],
  );

  const handleCopyByContext = useCallback(
    (itemId: string) => {
      const targets = getClipboardTargetsForItem(itemId)
        .map((item) => item.fileNode?.path)
        .filter((path): path is string => Boolean(path));
      if (targets.length === 0) return;
      setFileClipboard({ mode: "copy", paths: targets, updatedAt: Date.now() });
    },
    [getClipboardTargetsForItem],
  );

  const handleCutByContext = useCallback(
    (itemId: string) => {
      const targets = getClipboardTargetsForItem(itemId)
        .map((item) => item.fileNode?.path)
        .filter((path): path is string => Boolean(path));
      if (targets.length === 0) return;
      setFileClipboard({ mode: "cut", paths: targets, updatedAt: Date.now() });
    },
    [getClipboardTargetsForItem],
  );

  const copySelectionToClipboard = useCallback(() => {
    const targets = desktopItems
      .filter((item) => selectedSet.has(item.id))
      .map((item) => item.fileNode?.path)
      .filter((path): path is string => Boolean(path));

    if (targets.length === 0) return;
    setFileClipboard({ mode: "copy", paths: targets, updatedAt: Date.now() });
  }, [desktopItems, selectedSet]);

  const cutSelectionToClipboard = useCallback(() => {
    const targets = desktopItems
      .filter((item) => selectedSet.has(item.id))
      .map((item) => item.fileNode?.path)
      .filter((path): path is string => Boolean(path));

    if (targets.length === 0) return;
    setFileClipboard({ mode: "cut", paths: targets, updatedAt: Date.now() });
  }, [desktopItems, selectedSet]);

  const pasteClipboardToDirectory = useCallback(
    (
      destinationDirectoryPath: string,
      clientPoint?: { x: number; y: number } | null,
    ) => {
      if (!clipboard?.paths?.length) return;

      const pastedPaths: string[] = [];
      let movedAny = false;

      clipboard.paths.forEach((path) => {
        const sourceNode = fs.getNode(path);
        if (!sourceNode || sourceNode.readOnly) return;

        const expectedPath = fs.normalizePath(
          `${destinationDirectoryPath}/${sourceNode.name}`,
        );

        if (clipboard.mode === "copy") {
          if (fs.copy(sourceNode.path, destinationDirectoryPath)) {
            const childNodes = fs
              .getChildren(destinationDirectoryPath, true)
              .filter((node) => node.name.startsWith(sourceNode.name));
            const exact = childNodes.find((node) => node.path === expectedPath);
            const newest = childNodes.sort(
              (a, b) => b.modifiedAt - a.modifiedAt,
            )[0];
            pastedPaths.push((exact ?? newest)?.path ?? expectedPath);
          }
          return;
        }

        if (fs.move(sourceNode.path, destinationDirectoryPath)) {
          movedAny = true;
          pastedPaths.push(expectedPath);
        }
      });

      if (destinationDirectoryPath === desktopRootPath && pastedPaths.length > 0) {
        const fallbackRect =
          gridLayerRef.current?.getBoundingClientRect() ??
          containerRef.current?.getBoundingClientRect();
        const fallbackPoint = {
          x: (fallbackRect?.left ?? 0) + (fallbackRect?.width ?? 0) / 2,
          y: (fallbackRect?.top ?? 0) + (fallbackRect?.height ?? 0) / 2,
        };
        const target = clientPoint ?? desktopContextPointRef.current ?? fallbackPoint;
        placePathsNearClientPoint(pastedPaths, target.x, target.y);
      }

      if (clipboard.mode === "cut" && movedAny) {
        setFileClipboard(null);
      }
    },
    [clipboard, desktopRootPath, fs, placePathsNearClientPoint],
  );

  const handleRename = useCallback(
    (itemId: string) => {
      const item = desktopItems.find((entry) => entry.id === itemId);
      if (!item?.fileNode) return;
      setRenameTargetId(itemId);
      setRenameValue(item.fileNode.name);
      setRenameError("");
    },
    [desktopItems],
  );

  const handleRenameSubmit = useCallback(() => {
    if (!renameTargetId) return;
    const item = desktopItems.find((entry) => entry.id === renameTargetId);
    if (!item?.fileNode) return;
    if (item.fileNode.readOnly) {
      setRenameError("This item is read-only.");
      return;
    }

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
      .some(
        (node) => node.name === trimmed && node.path !== item.fileNode!.path,
      );

    if (siblingConflict) {
      setRenameError("An item with this name already exists.");
      return;
    }

    if (!fs.rename(item.fileNode.path, trimmed)) {
      setRenameError("Unable to rename this item.");
      return;
    }
    setRenameTargetId(null);
    setRenameValue("");
    setRenameError("");
  }, [desktopItems, fs, renameTargetId, renameValue]);

  const movePathsToDirectory = useCallback(
    (paths: string[], destinationDirectoryPath: string): string[] => {
      const uniquePaths = Array.from(
        new Set(paths.map((item) => fs.normalizePath(item))),
      );

      const movedPaths: string[] = [];

      uniquePaths.forEach((sourcePath) => {
        const sourceNode = fs.getNode(sourcePath);
        if (!sourceNode || sourceNode.readOnly) return;
        if (
          fs.normalizePath(sourceNode.parentPath) ===
          fs.normalizePath(destinationDirectoryPath)
        ) {
          return;
        }
        if (fs.move(sourcePath, destinationDirectoryPath)) {
          movedPaths.push(
            fs.normalizePath(`${destinationDirectoryPath}/${sourceNode.name}`),
          );
        }
      });

      return movedPaths;
    },
    [fs],
  );

  const handleDesktopDropToRoot = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const payload = readFileDragPayload(event.dataTransfer);
      if (!payload?.paths?.length) return;
      const movedPaths = movePathsToDirectory(payload.paths, desktopRootPath);
      if (movedPaths.length > 0) {
        placePathsNearClientPoint(movedPaths, event.clientX, event.clientY);
      }
    },
    [desktopRootPath, movePathsToDirectory, placePathsNearClientPoint],
  );

  const handleDesktopDropToFolder = useCallback(
    (event: React.DragEvent<HTMLDivElement>, folderPath: string) => {
      event.preventDefault();
      event.stopPropagation();
      const payload = readFileDragPayload(event.dataTransfer);
      if (!payload?.paths?.length) return;
      movePathsToDirectory(payload.paths, folderPath);
    },
    [movePathsToDirectory],
  );

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
        Math.min(visualOrderedItemIds.length - 1, currentIndex + offset),
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
        ?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
    },
    [
      lastSelectedId,
      selectRange,
      selectedIds,
      selectedSet,
      updateSelection,
      visualOrderedItemIds,
    ],
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

      const isModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (isModifier && key === "c" && selectedIds.length > 0) {
        event.preventDefault();
        copySelectionToClipboard();
        return;
      }

      if (isModifier && key === "x" && selectedIds.length > 0) {
        event.preventDefault();
        cutSelectionToClipboard();
        return;
      }

      if (isModifier && key === "v" && clipboard) {
        event.preventDefault();
        pasteClipboardToDirectory(desktopRootPath, desktopContextPointRef.current);
        return;
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

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedIds.length > 0
      ) {
        event.preventDefault();
        handleDeleteSelected();
      }
    },
    [
      handleDeleteSelected,
      handleOpenSelected,
      copySelectionToClipboard,
      cutSelectionToClipboard,
      clipboard,
      desktopRootPath,
      moveSelectionByOffset,
      pasteClipboardToDirectory,
      selectedIds.length,
    ],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          tabIndex={0}
          data-file-drop-zone="true"
          data-file-drop-kind="desktop-root"
          className="w-screen h-screen absolute top-0 bottom-0 left-0 right-0 overflow-hidden z-0 select-none outline-none focus:outline-none"
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={handleDesktopDropToRoot}
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

          <Dialog
            open={Boolean(createMode)}
            onOpenChange={(open) => {
              if (!open) {
                setCreateMode(null);
                setCreateValue("");
                setCreateError("");
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {createMode === "folder" ? "New Folder" : "New File"}
                </DialogTitle>
                <DialogDescription>
                  Create a {createMode === "folder" ? "folder" : "file"} on
                  your Desktop.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="desktop-create-input">Name</Label>
                <Input
                  id="desktop-create-input"
                  value={createValue}
                  onChange={(event) => {
                    setCreateValue(event.target.value);
                    if (createError) setCreateError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleCreateSubmit();
                    }
                  }}
                  autoFocus
                />
                {createError ? (
                  <div className="text-xs text-destructive">{createError}</div>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCreateMode(null);
                    setCreateValue("");
                    setCreateError("");
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreateSubmit}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="h-[calc(100vh-52px)] w-full bottom-0 left-0 right-0 absolute p-4">
            <div ref={gridLayerRef} className="relative w-full h-full">
              {desktopItems.map((item) => (
                <ContextMenu key={item.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      data-desktop-icon="true"
                      data-file-drop-zone={
                        item.fileNode?.type === "directory" ? "true" : undefined
                      }
                      data-file-drop-kind={
                        item.fileNode?.type === "directory"
                          ? "directory"
                          : undefined
                      }
                      data-file-drop-path={
                        item.fileNode?.type === "directory"
                          ? item.fileNode.path
                          : undefined
                      }
                      ref={(node) => {
                        if (node) {
                          iconRefs.current.set(item.id, node);
                        } else {
                          iconRefs.current.delete(item.id);
                        }
                      }}
                      onMouseDown={(event) =>
                        handleIconMouseDown(event, item.id)
                      }
                      onDoubleClick={() => item.onOpen?.()}
                      onContextMenu={(event) =>
                        handleIconContextMenu(event, item.id)
                      }
                      onDragOver={(event) => {
                        if (item.fileNode?.type === "directory") {
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => {
                        if (item.fileNode?.type === "directory") {
                          handleDesktopDropToFolder(event, item.fileNode.path);
                        }
                      }}
                      className="absolute"
                      style={(() => {
                        const activeDelta = dragDelta ?? { x: 0, y: 0 };
                        const position = itemPositions[item.id] ?? {
                          col: 0,
                          row: 0,
                        };
                        const isDragging =
                          draggingIds.includes(item.id) && Boolean(dragCandidateRef.current);
                        const source =
                          dragCandidateRef.current?.sourcePositions[item.id] ??
                          position;
                        const sourcePixel =
                          dragCandidateRef.current?.sourcePixels[item.id];
                        const left = isDragging
                          ? (sourcePixel?.left ??
                              DESKTOP_GRID_PADDING +
                                source.col * DESKTOP_GRID_COL_WIDTH) +
                            activeDelta.x
                          : DESKTOP_GRID_PADDING +
                            position.col * DESKTOP_GRID_COL_WIDTH;
                        const top = isDragging
                          ? (sourcePixel?.top ??
                              DESKTOP_GRID_PADDING +
                                source.row * DESKTOP_GRID_ROW_HEIGHT) +
                            activeDelta.y
                          : DESKTOP_GRID_PADDING +
                            position.row * DESKTOP_GRID_ROW_HEIGHT;
                        return {
                          left,
                          top,
                          zIndex: isDragging ? 40 : 30,
                          transition: isDragging
                            ? "none"
                            : "left 180ms ease-out, top 180ms ease-out",
                          visibility: isDragging ? "hidden" : "visible",
                        };
                      })()}
                    >
                      {draggingIds.includes(item.id) && dragCandidateRef.current ? null : (
                        <DesktopIcon
                          icon={item.icon}
                          title={item.title}
                          selected={selectedSet.has(item.id)}
                        />
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52">
                    <ContextMenuItem
                      onClick={() => item.onOpen?.()}
                      disabled={!item.onOpen}
                    >
                      <Eye size={16} className="mr-2" />
                      Open
                    </ContextMenuItem>
                    {item.kind === "file" && item.fileNode && (
                      <>
                        {(() => {
                          const ext = item
                            .fileNode!.name.split(".")
                            .pop()
                            ?.toLowerCase();
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
                            "shortcut",
                            "app",
                          ]);
                          return textExtensions.has(ext || "");
                        })() ? (
                          <ContextMenuItem
                            onClick={() =>
                              addWindow(
                                <TextEditorApplicationWindow
                                  filePath={item.fileNode!.path}
                                />,
                              )
                            }
                          >
                            <Edit3 size={16} className="mr-2" />
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
                                />,
                              )
                            }
                          >
                            <Eye size={16} className="mr-2" />
                            Open in Document Viewer
                          </ContextMenuItem>
                        ) : null}
                      </>
                    )}
                    {item.kind === "folder" && (
                      <ContextMenuItem onClick={() => item.onOpen?.()}>
                        <Eye size={16} className="mr-2" />
                        Open in File Explorer
                      </ContextMenuItem>
                    )}
                    {item.fileNode ? (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => handleCutByContext(item.id)}>
                          <Scissors size={16} className="mr-2" />
                          Cut
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleCopyByContext(item.id)}>
                          <Copy size={16} className="mr-2" />
                          Copy
                        </ContextMenuItem>
                        {clipboard && item.fileNode.type === "directory" ? (
                          <ContextMenuItem
                            onClick={() =>
                              pasteClipboardToDirectory(item.fileNode!.path)
                            }
                            disabled={Boolean(item.fileNode.readOnly)}
                          >
                            <ClipboardPaste size={16} className="mr-2" />
                            Paste
                          </ContextMenuItem>
                        ) : null}
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => handleRename(item.id)}
                          disabled={Boolean(item.fileNode.readOnly)}
                        >
                          <Edit3 size={16} className="mr-2" />
                          Rename
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => handleDeleteByContext(item.id)}
                          disabled={Boolean(item.fileNode.readOnly)}
                        >
                          <Trash2 size={16} className="mr-2" />
                          Delete
                        </ContextMenuItem>
                      </>
                    ) : null}
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          </div>

          {typeof window !== "undefined" &&
            draggingIds.length > 0 &&
            dragCandidateRef.current &&
            containerRef.current &&
            createPortal(
              <div className="pointer-events-none fixed inset-0 z-[8000]">
                {draggingIds.map((dragId) => {
                  const activeDelta = dragDelta ?? { x: 0, y: 0 };
                  const item = desktopItemById[dragId];
                  if (!item) return null;

                  const source =
                    dragCandidateRef.current?.sourcePositions[dragId];
                  if (!source) return null;

                  const sourcePixel =
                    dragCandidateRef.current?.sourcePixels[dragId];
                  const containerRect =
                    containerRef.current?.getBoundingClientRect();
                  const leftRelative =
                    (sourcePixel?.left ??
                      DESKTOP_GRID_PADDING +
                        source.col * DESKTOP_GRID_COL_WIDTH) + activeDelta.x;
                  const topRelative =
                    (sourcePixel?.top ??
                      DESKTOP_GRID_PADDING +
                        source.row * DESKTOP_GRID_ROW_HEIGHT) + activeDelta.y;

                  return (
                    <div
                      key={`desktop-drag-overlay-${dragId}`}
                      className="absolute"
                      style={{
                        left: (containerRect?.left ?? 0) + leftRelative,
                        top: (containerRect?.top ?? 0) + topRelative,
                      }}
                    >
                      <DesktopIcon
                        icon={item.icon}
                        title={item.title}
                        selected={selectedSet.has(item.id)}
                      />
                    </div>
                  );
                })}
              </div>,
              document.body,
            )}

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
        <ContextMenuItem onClick={handleCreateFolder}>
          <FolderPlus size={16} className="mr-2" />
          New Folder
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCreateTextFile}>
          <FilePlus size={16} className="mr-2" />
          New Text Document
        </ContextMenuItem>
        {clipboard ? (
          <ContextMenuItem
            onClick={() =>
              pasteClipboardToDirectory(desktopRootPath, desktopContextPointRef.current)
            }
          >
            <ClipboardPaste size={16} className="mr-2" />
            Paste
          </ContextMenuItem>
        ) : null}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ArrowUpDown size={16} className="mr-2" />
            Sort by
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuRadioGroup
              value={sortMode}
              onValueChange={(value) =>
                applySortedLayout(value as DesktopSortMode)
              }
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
        <ContextMenuItem onClick={loadDesktopNodes}>
          <RefreshCw size={16} className="mr-2" />
          Refresh
        </ContextMenuItem>
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
        selected && "bg-white/30 ring-2 ring-white/70",
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
