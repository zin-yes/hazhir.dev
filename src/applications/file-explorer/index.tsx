"use client";

import {
  FilePropertiesApplicationWindow,
  ImageViewerApplicationWindow,
  SingleDocumentApplicationWindow,
  TerminalApplicationWindow,
  TextEditorApplicationWindow,
} from "@/app/application-windows";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDragVisualHandoff } from "@/hooks/use-drag-visual-handoff";
import { FileSystemNode, useFileSystem } from "@/hooks/use-file-system";
import {
  getFileClipboard,
  setFileClipboard,
  subscribeToFileClipboard,
} from "@/lib/file-clipboard";
import {
  executeFilePath,
  isExecutableFile,
  isShortcutFile,
} from "@/lib/file-execution";
import {
  FILE_DRAG_MIME,
  readDroppedPathsFromDataTransfer,
  serializeFileDragPayload,
  setFileDragPreview,
  setInternalDraggedPaths,
  setInternalFileDragActive,
} from "@/lib/file-transfer-dnd";
import { getHomePath } from "@/lib/system-user";
import {
  ClipboardPaste,
  Eye,
  EyeOff,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Grid3X3,
  HardDrive,
  Home,
  Image,
  RefreshCw,
  TerminalSquare,
} from "lucide-react";
import {
  ReactPortal,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { v4 } from "uuid";

/* Sub-component imports */
import {
  CreateItemDialog,
  RenameDialog,
} from "@/applications/file-explorer/components/file-explorer-dialogs";
import FileExplorerSidebar, {
  SidebarBookmark,
} from "@/applications/file-explorer/components/file-explorer-sidebar";
import type { BreadcrumbSegment } from "@/applications/file-explorer/components/file-explorer-toolbar";
import FileExplorerToolbar from "@/applications/file-explorer/components/file-explorer-toolbar";
import {
  FileGridItem,
  FileListItem,
} from "@/applications/file-explorer/components/file-item";
import {
  getDisplayName,
  getFileIcon,
} from "@/applications/file-explorer/lib/file-explorer-utils";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Re-exported types & utilities (for backward compatibility)         */
/* ------------------------------------------------------------------ */

export { humanFileSize } from "@/applications/file-explorer/lib/file-explorer-utils";

export type FileExplorerSelectionMode = "file" | "directory";

export type FileExplorerPickerOptions = {
  enabled: boolean;
  selectionMode?: FileExplorerSelectionMode;
  allowedFileExtensions?: string[];
  rootPath?: string;
  onPick?: (node: FileSystemNode) => void;
  onCancel?: () => void;
};

/* ------------------------------------------------------------------ */
/*  Sort / view types                                                 */
/* ------------------------------------------------------------------ */

type ViewMode = "grid" | "list";
type SortByField = "name" | "size" | "modified" | "type";
type SortOrder = "asc" | "desc";

/* ------------------------------------------------------------------ */
/*  Main File Explorer Application                                    */
/* ------------------------------------------------------------------ */

export default function FileExplorerApplication({
  initialPath,
  picker,
}: {
  initialPath?: string;
  picker?: FileExplorerPickerOptions;
}) {
  const fileSystem = useFileSystem();
  const homePath = getHomePath();
  const isPickerMode = Boolean(picker?.enabled);
  const pickerSelectionMode = picker?.selectionMode ?? "file";

  const pickerRootPath = useMemo(() => {
    const requested = picker?.rootPath
      ? fileSystem.normalizePath(picker.rootPath)
      : homePath;
    if (fileSystem.exists(requested) && fileSystem.isDirectory(requested))
      return requested;
    return homePath;
  }, [picker?.rootPath, fileSystem, homePath]);

  const pickerExtensionSet = useMemo(
    () =>
      new Set(
        (picker?.allowedFileExtensions ?? [])
          .map((item) => item.toLowerCase().replace(/^\./, ""))
          .filter(Boolean),
      ),
    [picker?.allowedFileExtensions],
  );

  /* ---- Picker boundary helpers ---- */

  const isWithinPickerRoot = useCallback(
    (path: string) => {
      if (!isPickerMode) return true;
      const normalized = fileSystem.normalizePath(path);
      return (
        normalized === pickerRootPath ||
        normalized.startsWith(`${pickerRootPath}/`)
      );
    },
    [fileSystem, isPickerMode, pickerRootPath],
  );

  const isAllowedPickerFile = useCallback(
    (node: FileSystemNode) => {
      if (node.type !== "file") return false;
      if (pickerSelectionMode === "directory") return false;
      if (pickerExtensionSet.size === 0) return true;
      const extension = node.name.split(".").pop()?.toLowerCase() ?? "";
      return pickerExtensionSet.has(extension);
    },
    [pickerExtensionSet, pickerSelectionMode],
  );

  const isPickerSelectable = useCallback(
    (node: FileSystemNode) => {
      if (!isPickerMode) return true;
      if (!isWithinPickerRoot(node.path)) return false;
      if (pickerSelectionMode === "directory") {
        return node.type === "directory";
      }
      return isAllowedPickerFile(node);
    },
    [
      isAllowedPickerFile,
      isPickerMode,
      isWithinPickerRoot,
      pickerSelectionMode,
    ],
  );

  /* ---- Compute initial path ---- */

  const initialExplorerPath = useMemo(() => {
    if (isPickerMode) {
      if (!initialPath) return pickerRootPath;
      const normalized = fileSystem.normalizePath(initialPath);
      if (
        fileSystem.exists(normalized) &&
        fileSystem.isDirectory(normalized) &&
        isWithinPickerRoot(normalized)
      ) {
        return normalized;
      }
      return pickerRootPath;
    }

    if (!initialPath) return homePath;
    const normalized = fileSystem.normalizePath(initialPath);
    if (fileSystem.exists(normalized) && fileSystem.isDirectory(normalized)) {
      return normalized;
    }
    return homePath;
  }, [
    fileSystem,
    homePath,
    initialPath,
    isPickerMode,
    isWithinPickerRoot,
    pickerRootPath,
  ]);

  /* ---- Sidebar bookmarks ---- */

  const sidebarBookmarks: SidebarBookmark[] = useMemo(
    () =>
      isPickerMode
        ? [{ name: "Browse", path: pickerRootPath, icon: Folder }]
        : [
            { name: "Home", path: homePath, icon: Home },
            { name: "Desktop", path: `${homePath}/Desktop`, icon: HardDrive },
            {
              name: "Documents",
              path: `${homePath}/Documents`,
              icon: FileText,
            },
            { name: "Images", path: `${homePath}/Images`, icon: Image },
            { name: "Applications", path: "/applications", icon: Grid3X3 },
            { name: "Root", path: "/", icon: HardDrive },
          ],
    [homePath, isPickerMode, pickerRootPath],
  );

  /* ---- Core state ---- */

  const [currentDirectoryPath, setCurrentDirectoryPath] =
    useState(initialExplorerPath);
  const [navigationHistory, setNavigationHistory] = useState<string[]>([
    initialExplorerPath,
  ]);
  const [navigationHistoryIndex, setNavigationHistoryIndex] = useState(0);

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortByField, setSortByField] = useState<SortByField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [shouldShowHiddenFiles, setShouldShowHiddenFiles] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchActive, setIsSearchActive] = useState(false);

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const lastSelectedPathReference = useRef<string | null>(null);
  const lastTouchTapReference = useRef<{ path: string; at: number } | null>(
    null,
  );
  const touchDragReference = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    paths: string[];
    active: boolean;
    sourcePixels: Record<string, { left: number; top: number }>;
  } | null>(null);
  const selectedPathsReference = useRef<Set<string>>(new Set());
  const marqueeElementReference = useRef<HTMLDivElement>(null);
  const marqueeRectReference = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const [renameTarget, setRenameTarget] = useState<FileSystemNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameErrorMessage, setRenameErrorMessage] = useState("");
  const [createMode, setCreateMode] = useState<"file" | "folder" | null>(null);
  const [createValue, setCreateValue] = useState("");
  const [createErrorMessage, setCreateErrorMessage] = useState("");

  const rootContainerReference = useRef<HTMLDivElement>(null);
  const contentContainerReference = useRef<HTMLDivElement>(null);
  const viewportReference = useRef<HTMLDivElement>(null);
  const breadcrumbHoverTimerReference = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const itemElementReferences = useRef<Map<string, HTMLDivElement>>(new Map());
  const isMarqueeSelectingReference = useRef(false);
  const selectionOriginReference = useRef<{ x: number; y: number } | null>(
    null,
  );
  const selectionBaseReference = useRef<Set<string>>(new Set());
  const marqueeAnimationFrameReference = useRef<number>(0);

  const touchDragVisual = useDragVisualHandoff({
    durationMs: 160,
    easing: "ease-out",
  });
  const clearTouchDragVisual = touchDragVisual.clear;
  const startTouchDragVisual = touchDragVisual.startDrag;
  const updateTouchDragVisualDelta = touchDragVisual.updateDelta;

  const [clipboard, setClipboard] = useState(getFileClipboard);
  const [childWindows, setChildWindows] = useState<ReactPortal[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [, setIsResizing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  /* ---- Compute displayed contents ---- */

  const directoryContents = useMemo(() => {
    void refreshTrigger;
    let items: FileSystemNode[];

    if (isSearchActive && searchQuery) {
      items = fileSystem.searchFiles(searchQuery, currentDirectoryPath);
    } else {
      items = fileSystem.getChildren(
        currentDirectoryPath,
        shouldShowHiddenFiles,
      );
    }

    if (isPickerMode) {
      items = items.filter((node) => {
        if (!isWithinPickerRoot(node.path)) return false;
        if (node.type === "directory") return true;
        return isAllowedPickerFile(node);
      });
    }

    items.sort((firstItem, secondItem) => {
      /* Directories always come before files */
      if (firstItem.type !== secondItem.type) {
        return firstItem.type === "directory" ? -1 : 1;
      }

      let comparison = 0;
      switch (sortByField) {
        case "name":
          comparison = firstItem.name.localeCompare(secondItem.name);
          break;
        case "size":
          comparison = firstItem.size - secondItem.size;
          break;
        case "modified":
          comparison = firstItem.modifiedAt - secondItem.modifiedAt;
          break;
        case "type": {
          const extensionA = firstItem.name.split(".").pop() || "";
          const extensionB = secondItem.name.split(".").pop() || "";
          comparison = extensionA.localeCompare(extensionB);
          break;
        }
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return items;
  }, [
    currentDirectoryPath,
    isAllowedPickerFile,
    isPickerMode,
    isWithinPickerRoot,
    shouldShowHiddenFiles,
    searchQuery,
    isSearchActive,
    sortByField,
    sortOrder,
    refreshTrigger,
  ]);

  /* ---- Navigation ---- */

  const navigateToDirectory = useCallback(
    (path: string) => {
      const normalizedPath = fileSystem.normalizePath(path);
      if (!isWithinPickerRoot(normalizedPath)) return;
      if (
        fileSystem.exists(normalizedPath) &&
        fileSystem.isDirectory(normalizedPath)
      ) {
        setCurrentDirectoryPath(normalizedPath);
        setSelectedPaths(new Set());

        const trimmedHistory = navigationHistory.slice(
          0,
          navigationHistoryIndex + 1,
        );
        trimmedHistory.push(normalizedPath);
        setNavigationHistory(trimmedHistory);
        setNavigationHistoryIndex(trimmedHistory.length - 1);
      }
    },
    [fileSystem, navigationHistory, navigationHistoryIndex, isWithinPickerRoot],
  );

  const navigateBack = useCallback(() => {
    if (navigationHistoryIndex > 0) {
      setNavigationHistoryIndex(navigationHistoryIndex - 1);
      setCurrentDirectoryPath(navigationHistory[navigationHistoryIndex - 1]);
      setSelectedPaths(new Set());
    }
  }, [navigationHistory, navigationHistoryIndex]);

  const navigateForward = useCallback(() => {
    if (navigationHistoryIndex < navigationHistory.length - 1) {
      setNavigationHistoryIndex(navigationHistoryIndex + 1);
      setCurrentDirectoryPath(navigationHistory[navigationHistoryIndex + 1]);
      setSelectedPaths(new Set());
    }
  }, [navigationHistory, navigationHistoryIndex]);

  const navigateUp = useCallback(() => {
    if (isPickerMode && currentDirectoryPath === pickerRootPath) return;
    const parentPath = fileSystem.getParentPath(currentDirectoryPath);
    if (parentPath !== currentDirectoryPath && isWithinPickerRoot(parentPath)) {
      navigateToDirectory(parentPath);
    }
  }, [
    currentDirectoryPath,
    fileSystem,
    isPickerMode,
    isWithinPickerRoot,
    navigateToDirectory,
    pickerRootPath,
  ]);

  const refreshContents = useCallback(() => {
    setRefreshTrigger((previous) => previous + 1);
  }, []);

  /* ---- Selection ---- */

  const updateSelection = useCallback((nextSelection: Set<string>) => {
    setSelectedPaths(new Set(nextSelection));
  }, []);

  useEffect(() => {
    selectedPathsReference.current = new Set(selectedPaths);
  }, [selectedPaths]);

  useEffect(() => {
    return subscribeToFileClipboard((nextClipboard) => {
      setClipboard(nextClipboard);
    });
  }, []);

  const selectRange = useCallback(
    (fromPath: string, toPath: string) => {
      const fromIndex = directoryContents.findIndex(
        (item) => item.path === fromPath,
      );
      const toIndex = directoryContents.findIndex(
        (item) => item.path === toPath,
      );
      if (fromIndex === -1 || toIndex === -1) return;
      const [startIndex, endIndex] =
        fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const nextSelection = new Set<string>();
      for (let index = startIndex; index <= endIndex; index += 1) {
        nextSelection.add(directoryContents[index].path);
      }
      updateSelection(nextSelection);
    },
    [directoryContents, updateSelection],
  );

  const handleSelect = useCallback(
    (
      path: string,
      event:
        | React.MouseEvent<HTMLDivElement>
        | React.PointerEvent<HTMLDivElement>,
    ) => {
      if (event.button !== 0) return;
      rootContainerReference.current?.focus();

      const currentSelection = selectedPathsReference.current;

      /* When clicking a selected item in a multi-selection without modifier keys,
         just update the anchor — deselection happens on pointer-up (browser default). */
      if (
        currentSelection.has(path) &&
        currentSelection.size > 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        setLastSelectedPath(path);
        lastSelectedPathReference.current = path;
        return;
      }

      const lastAnchorPath = lastSelectedPathReference.current;

      /* Shift-click extends the selection range */
      if (event.shiftKey && lastAnchorPath) {
        selectRange(lastAnchorPath, path);
        setLastSelectedPath(path);
        lastSelectedPathReference.current = path;
        return;
      }

      /* Ctrl/Meta-click toggles individual paths */
      if (event.ctrlKey || event.metaKey) {
        const nextSelection = new Set(currentSelection);
        if (nextSelection.has(path)) {
          nextSelection.delete(path);
        } else {
          nextSelection.add(path);
        }
        updateSelection(nextSelection);
        setLastSelectedPath(path);
        lastSelectedPathReference.current = path;
        return;
      }

      /* Normal click – select only this path */
      updateSelection(new Set([path]));
      setLastSelectedPath(path);
      lastSelectedPathReference.current = path;
    },
    [selectRange, updateSelection],
  );

  const handleContextSelect = useCallback(
    (path: string, event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (!selectedPathsReference.current.has(path)) {
        updateSelection(new Set([path]));
        setLastSelectedPath(path);
        lastSelectedPathReference.current = path;
      }
    },
    [updateSelection],
  );

  const handleItemRef = useCallback(
    (path: string, element: HTMLDivElement | null) => {
      if (element) {
        itemElementReferences.current.set(path, element);
      } else {
        itemElementReferences.current.delete(path);
      }
    },
    [],
  );

  /* ---- Marquee (rubber-band) selection ---- */

  const startMarqueeSelection = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-file-item='true']")) return;

      const container =
        viewportReference.current ?? contentContainerReference.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const origin = {
        x: event.clientX - containerRect.left,
        y: event.clientY - containerRect.top,
      };
      selectionOriginReference.current = origin;
      isMarqueeSelectingReference.current = true;
      selectionBaseReference.current =
        event.ctrlKey || event.metaKey ? new Set(selectedPaths) : new Set();
      marqueeRectReference.current = {
        x: origin.x,
        y: origin.y,
        width: 0,
        height: 0,
      };
      const marqueeElement = marqueeElementReference.current;
      if (marqueeElement) {
        marqueeElement.style.display = "block";
        marqueeElement.style.left = `${origin.x}px`;
        marqueeElement.style.top = `${origin.y}px`;
        marqueeElement.style.width = "0px";
        marqueeElement.style.height = "0px";
      }
      if (!event.ctrlKey && !event.metaKey) {
        updateSelection(new Set());
      }
    },
    [selectedPaths, updateSelection],
  );

  const endMarqueeSelection = useCallback(() => {
    if (!isMarqueeSelectingReference.current) return;
    isMarqueeSelectingReference.current = false;
    selectionOriginReference.current = null;
    selectionBaseReference.current = new Set();
    marqueeRectReference.current = null;
    const marqueeElement = marqueeElementReference.current;
    if (marqueeElement) marqueeElement.style.display = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (
        !isMarqueeSelectingReference.current ||
        !selectionOriginReference.current
      )
        return;
      if (event.buttons === 0) {
        endMarqueeSelection();
        return;
      }

      const container =
        viewportReference.current ?? contentContainerReference.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const currentPosition = {
        x: event.clientX - containerRect.left,
        y: event.clientY - containerRect.top,
      };
      const origin = selectionOriginReference.current;
      const marqueeX = Math.min(origin.x, currentPosition.x);
      const marqueeY = Math.min(origin.y, currentPosition.y);
      const marqueeWidth = Math.abs(origin.x - currentPosition.x);
      const marqueeHeight = Math.abs(origin.y - currentPosition.y);
      marqueeRectReference.current = {
        x: marqueeX,
        y: marqueeY,
        width: marqueeWidth,
        height: marqueeHeight,
      };
      const marqueeElement = marqueeElementReference.current;
      if (marqueeElement) {
        marqueeElement.style.left = `${marqueeX}px`;
        marqueeElement.style.top = `${marqueeY}px`;
        marqueeElement.style.width = `${marqueeWidth}px`;
        marqueeElement.style.height = `${marqueeHeight}px`;
      }

      if (marqueeAnimationFrameReference.current) return;
      marqueeAnimationFrameReference.current = requestAnimationFrame(() => {
        marqueeAnimationFrameReference.current = 0;
        if (!isMarqueeSelectingReference.current) return;
        const marqueeRect = marqueeRectReference.current;
        if (!marqueeRect) return;

        const scrollContainer =
          viewportReference.current ?? contentContainerReference.current;
        if (!scrollContainer) return;
        const scrollContainerRect = scrollContainer.getBoundingClientRect();

        const selectionRect = {
          left: marqueeRect.x,
          top: marqueeRect.y,
          right: marqueeRect.x + marqueeRect.width,
          bottom: marqueeRect.y + marqueeRect.height,
        };
        const nextSelection = new Set(selectionBaseReference.current);
        directoryContents.forEach((item) => {
          const element = itemElementReferences.current.get(item.path);
          if (!element) return;
          const hitTarget = element.querySelector(
            "[data-file-hit='true']",
          ) as HTMLElement | null;
          const itemRect = (hitTarget ?? element).getBoundingClientRect();
          const relativeItemRect = {
            left: itemRect.left - scrollContainerRect.left,
            top: itemRect.top - scrollContainerRect.top,
            right: itemRect.right - scrollContainerRect.left,
            bottom: itemRect.bottom - scrollContainerRect.top,
          };
          const doesIntersect =
            selectionRect.left <= relativeItemRect.right &&
            selectionRect.right >= relativeItemRect.left &&
            selectionRect.top <= relativeItemRect.bottom &&
            selectionRect.bottom >= relativeItemRect.top;
          if (doesIntersect) {
            nextSelection.add(item.path);
          }
        });

        const previousSelection = selectedPathsReference.current;
        if (
          nextSelection.size !== previousSelection.size ||
          [...nextSelection].some((path) => !previousSelection.has(path))
        ) {
          updateSelection(nextSelection);
        }
      });
    };

    const handleMouseUp = () => {
      endMarqueeSelection();
    };

    const handleBlur = () => {
      endMarqueeSelection();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleBlur);
      if (marqueeAnimationFrameReference.current) {
        cancelAnimationFrame(marqueeAnimationFrameReference.current);
        marqueeAnimationFrameReference.current = 0;
      }
    };
  }, [directoryContents, endMarqueeSelection, updateSelection]);

  /* ---- File operations ---- */

  const handleOpen = useCallback(
    (node: FileSystemNode) => {
      if (node.type === "directory") {
        navigateToDirectory(node.path);
        if (isPickerMode && pickerSelectionMode === "directory") {
          setSelectedPaths(new Set([node.path]));
          setLastSelectedPath(node.path);
        }
      } else {
        if (isPickerMode) {
          if (isPickerSelectable(node)) {
            picker?.onPick?.(node);
          }
          return;
        }

        if (isShortcutFile(node) || isExecutableFile(node)) {
          executeFilePath(node.path, fileSystem);
          return;
        }

        const extension = node.name.split(".").pop()?.toLowerCase();
        const imageExtensions = new Set([
          "png",
          "jpg",
          "jpeg",
          "gif",
          "svg",
          "webp",
          "ico",
        ]);

        if (imageExtensions.has(extension || "")) {
          const imageViewerPortal = createPortal(
            <ImageViewerApplicationWindow filePath={node.path} />,
            document.getElementById(
              "operating-system-container",
            ) as HTMLDivElement,
            "image_viewer_" + v4(),
          );
          setChildWindows((previous) => [...previous, imageViewerPortal]);
          return;
        }

        if (extension === "pdf" || extension === "document") {
          const documentViewerPortal = createPortal(
            <SingleDocumentApplicationWindow
              filePath={node.path}
              title={node.name}
            />,
            document.getElementById(
              "operating-system-container",
            ) as HTMLDivElement,
            "document_viewer_" + v4(),
          );
          setChildWindows((previous) => [...previous, documentViewerPortal]);
        } else {
          const textEditorPortal = createPortal(
            <TextEditorApplicationWindow filePath={node.path} />,
            document.getElementById(
              "operating-system-container",
            ) as HTMLDivElement,
            "text_editor_" + v4(),
          );
          setChildWindows((previous) => [...previous, textEditorPortal]);
        }
      }
    },
    [
      fileSystem,
      isPickerMode,
      isPickerSelectable,
      navigateToDirectory,
      picker,
      pickerSelectionMode,
    ],
  );

  const handleOpenInEditor = useCallback(
    (node: FileSystemNode) => {
      if (isPickerMode) return;
      if (node.type !== "file") return;
      const textEditorPortal = createPortal(
        <TextEditorApplicationWindow filePath={node.path} />,
        document.getElementById("operating-system-container") as HTMLDivElement,
        "text_editor_" + v4(),
      );
      setChildWindows((previous) => [...previous, textEditorPortal]);
    },
    [isPickerMode],
  );

  const handleRename = useCallback(
    (node: FileSystemNode) => {
      if (isPickerMode) return;
      setRenameTarget(node);
      setRenameValue(node.name);
      setRenameErrorMessage("");
    },
    [isPickerMode],
  );

  const handleViewProperties = useCallback(
    (node: FileSystemNode) => {
      if (isPickerMode) return;
      const propertiesPortal = createPortal(
        <FilePropertiesApplicationWindow filePath={node.path} />,
        document.getElementById("operating-system-container") as HTMLDivElement,
        "file_properties_" + v4(),
      );
      setChildWindows((previous) => [...previous, propertiesPortal]);
    },
    [isPickerMode],
  );

  const handleOpenTerminalHere = useCallback(
    (path: string) => {
      if (isPickerMode) return;
      const targetDirectory = fileSystem.isDirectory(path)
        ? path
        : fileSystem.getParentPath(path);
      const terminalPortal = createPortal(
        <TerminalApplicationWindow
          identifier={v4()}
          initialPath={targetDirectory}
        />,
        document.getElementById("operating-system-container") as HTMLDivElement,
        "terminal_" + v4(),
      );
      setChildWindows((previous) => [...previous, terminalPortal]);
    },
    [fileSystem, isPickerMode],
  );

  const handleDelete = useCallback(
    (node: FileSystemNode) => {
      if (isPickerMode) return;
      fileSystem.deleteNode(node.path);
      setSelectedPaths((previousSelection) => {
        const nextSelection = new Set(previousSelection);
        nextSelection.delete(node.path);
        return nextSelection;
      });
    },
    [fileSystem, isPickerMode],
  );

  const handleCopy = useCallback(
    (node: FileSystemNode) => {
      if (isPickerMode) return;
      if (node.type === "file" && node.readOnly) return;
      setFileClipboard({
        mode: "copy",
        paths: [node.path],
        updatedAt: Date.now(),
      });
    },
    [isPickerMode],
  );

  const handleCut = useCallback(
    (node: FileSystemNode) => {
      if (isPickerMode) return;
      if (node.type === "file" && node.readOnly) return;
      setFileClipboard({
        mode: "cut",
        paths: [node.path],
        updatedAt: Date.now(),
      });
    },
    [isPickerMode],
  );

  const handlePaste = useCallback(() => {
    if (isPickerMode) return;
    if (!clipboard) return;

    let movedAny = false;
    clipboard.paths.forEach((path) => {
      const node = fileSystem.getNode(path);
      if (!node || node.readOnly) return;

      if (clipboard.mode === "copy") {
        fileSystem.copy(node.path, currentDirectoryPath);
      } else {
        movedAny = fileSystem.move(node.path, currentDirectoryPath) || movedAny;
      }
    });

    if (clipboard.mode === "cut" && movedAny) {
      setFileClipboard(null);
    }
  }, [clipboard, currentDirectoryPath, fileSystem, isPickerMode]);

  const movePathsToDirectory = useCallback(
    (paths: string[], destinationDirectoryPath: string) => {
      if (isPickerMode) return;
      const uniquePaths = Array.from(
        new Set(paths.map((item) => fileSystem.normalizePath(item))),
      );

      uniquePaths.forEach((sourcePath) => {
        const sourceNode = fileSystem.getNode(sourcePath);
        if (!sourceNode || sourceNode.readOnly) return;
        if (
          fileSystem.normalizePath(sourceNode.parentPath) ===
          fileSystem.normalizePath(destinationDirectoryPath)
        ) {
          return;
        }
        fileSystem.move(sourcePath, destinationDirectoryPath);
      });
    },
    [fileSystem, isPickerMode],
  );

  /* ---- Drag and drop ---- */

  const handleDragStartItem = useCallback(
    (node: FileSystemNode, event: React.DragEvent<HTMLDivElement>) => {
      const currentSelection = selectedPathsReference.current;
      const draggedPaths =
        currentSelection.has(node.path) && currentSelection.size > 0
          ? Array.from(currentSelection)
          : [node.path];

      setInternalFileDragActive(true);
      setInternalDraggedPaths(draggedPaths);
      event.dataTransfer.setData(
        FILE_DRAG_MIME,
        serializeFileDragPayload(draggedPaths),
      );
      event.dataTransfer.setData("text/plain", draggedPaths.join("\n"));
      event.dataTransfer.setData("text/uri-list", draggedPaths.join("\n"));
      event.dataTransfer.effectAllowed = "move";
      setFileDragPreview(
        event.dataTransfer,
        node.name,
        draggedPaths.length,
        node.type,
        event.currentTarget,
      );
    },
    [],
  );

  const handleTouchPointerDownItem = useCallback(
    (node: FileSystemNode, event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") {
        return;
      }

      const now = Date.now();
      const previousTap = lastTouchTapReference.current;
      if (
        previousTap &&
        previousTap.path === node.path &&
        now - previousTap.at < 500
      ) {
        lastTouchTapReference.current = null;
        touchDragReference.current = null;
        handleOpen(node);
        return;
      }

      lastTouchTapReference.current = { path: node.path, at: now };

      const currentSelection = selectedPathsReference.current;
      const draggedPaths =
        currentSelection.has(node.path) && currentSelection.size > 0
          ? Array.from(currentSelection)
          : [node.path];
      const containerRect =
        rootContainerReference.current?.getBoundingClientRect();
      if (!containerRect) return;

      const sourcePixels = draggedPaths.reduce<
        Record<string, { left: number; top: number }>
      >((accumulator, path) => {
        const element = itemElementReferences.current.get(path);
        if (!element) return accumulator;
        const elementRect = element.getBoundingClientRect();
        accumulator[path] = {
          left: elementRect.left - containerRect.left,
          top: elementRect.top - containerRect.top,
        };
        return accumulator;
      }, {});

      clearTouchDragVisual();

      touchDragReference.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        paths: draggedPaths,
        active: false,
        sourcePixels,
      };
    },
    [clearTouchDragVisual, handleOpen],
  );

  const handleTouchPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = touchDragReference.current;
      if (!dragState) return;
      if (dragState.pointerId !== event.pointerId) return;

      const movedDistance =
        Math.abs(event.clientX - dragState.startX) +
        Math.abs(event.clientY - dragState.startY);

      if (!dragState.active && movedDistance >= 10) {
        dragState.active = true;
        lastTouchTapReference.current = null;
        startTouchDragVisual(dragState.paths, dragState.sourcePixels);
      }

      if (dragState.active) {
        updateTouchDragVisualDelta({
          x: event.clientX - dragState.startX,
          y: event.clientY - dragState.startY,
        });
        event.preventDefault();
      }
    },
    [startTouchDragVisual, updateTouchDragVisualDelta],
  );

  const handleTouchPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = touchDragReference.current;
      if (!dragState) return;
      if (dragState.pointerId !== event.pointerId) return;

      if (dragState.active) {
        const dropTarget = document.elementFromPoint(
          event.clientX,
          event.clientY,
        ) as HTMLElement | null;
        const dropZone = dropTarget?.closest(
          "[data-file-drop-zone='true']",
        ) as HTMLElement | null;
        const destinationPath = dropZone?.dataset.fileDropPath;

        if (destinationPath) {
          movePathsToDirectory(dragState.paths, destinationPath);
        }
      }

      clearTouchDragVisual();
      touchDragReference.current = null;
    },
    [clearTouchDragVisual, movePathsToDirectory],
  );

  const handleDragEndItem = useCallback(() => {
    setInternalFileDragActive(false);
  }, []);

  useEffect(() => {
    return () => {
      setInternalFileDragActive(false);
    };
  }, []);

  const handleDropOnDirectory = useCallback(
    (directoryPath: string, event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const droppedPaths = readDroppedPathsFromDataTransfer(event.dataTransfer);
      if (!droppedPaths.length) return;
      movePathsToDirectory(droppedPaths, directoryPath);
    },
    [movePathsToDirectory],
  );

  const handleDropInExplorerArea = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const droppedPaths = readDroppedPathsFromDataTransfer(event.dataTransfer);
      if (!droppedPaths.length) return;

      const target = event.target as HTMLElement | null;
      const directoryDropZone = target?.closest(
        "[data-file-drop-zone='true'][data-file-drop-kind='directory']",
      ) as HTMLElement | null;
      const destinationPath =
        directoryDropZone?.dataset.fileDropPath ?? currentDirectoryPath;

      movePathsToDirectory(droppedPaths, destinationPath);
    },
    [currentDirectoryPath, movePathsToDirectory],
  );

  /* ---- Breadcrumb drag-to-navigate ---- */

  const clearBreadcrumbHoverTimer = useCallback(() => {
    if (breadcrumbHoverTimerReference.current) {
      clearTimeout(breadcrumbHoverTimerReference.current);
      breadcrumbHoverTimerReference.current = null;
    }
  }, []);

  const scheduleBreadcrumbAutoNavigate = useCallback(
    (path: string) => {
      clearBreadcrumbHoverTimer();
      breadcrumbHoverTimerReference.current = setTimeout(() => {
        navigateToDirectory(path);
        breadcrumbHoverTimerReference.current = null;
      }, 1000);
    },
    [clearBreadcrumbHoverTimer, navigateToDirectory],
  );

  useEffect(() => {
    return () => {
      clearBreadcrumbHoverTimer();
    };
  }, [clearBreadcrumbHoverTimer]);

  /* ---- Create / rename handlers ---- */

  const handleCreateFolder = useCallback(() => {
    if (isPickerMode) return;
    setCreateMode("folder");
    setCreateValue("New Folder");
    setCreateErrorMessage("");
  }, [isPickerMode]);

  const handleCreateFile = useCallback(() => {
    if (isPickerMode) return;
    setCreateMode("file");
    setCreateValue("New File.txt");
    setCreateErrorMessage("");
  }, [isPickerMode]);

  const handleRenameSubmit = useCallback(() => {
    if (isPickerMode) return;
    if (!renameTarget) return;
    const trimmedName = renameValue.trim();
    if (!trimmedName) {
      setRenameErrorMessage("Name is required.");
      return;
    }
    if (trimmedName === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    const targetPath = fileSystem.normalizePath(
      `${renameTarget.parentPath}/${trimmedName}`,
    );
    if (fileSystem.exists(targetPath)) {
      setRenameErrorMessage("An item with this name already exists.");
      return;
    }
    fileSystem.rename(renameTarget.path, trimmedName);
    setRenameTarget(null);
  }, [fileSystem, isPickerMode, renameTarget, renameValue]);

  const handleCreateSubmit = useCallback(() => {
    if (isPickerMode) return;
    if (!createMode) return;
    const trimmedName = createValue.trim();
    if (!trimmedName) {
      setCreateErrorMessage("Name is required.");
      return;
    }
    const targetPath = fileSystem.normalizePath(
      `${currentDirectoryPath}/${trimmedName}`,
    );
    if (fileSystem.exists(targetPath)) {
      setCreateErrorMessage("An item with this name already exists.");
      return;
    }
    if (createMode === "folder") {
      fileSystem.createDirectory(currentDirectoryPath, trimmedName);
    } else {
      fileSystem.createFile(currentDirectoryPath, trimmedName, "");
    }
    setCreateMode(null);
  }, [createMode, createValue, currentDirectoryPath, fileSystem, isPickerMode]);

  /* ---- Keyboard shortcuts ---- */

  const handleExplorerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        const isEditableElement =
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          target.isContentEditable ||
          Boolean(target.closest(".monaco-editor"));
        if (isEditableElement) return;
      }

      const orderedPaths = directoryContents.map((item) => item.path);
      const activePath =
        (lastSelectedPath && selectedPaths.has(lastSelectedPath)
          ? lastSelectedPath
          : Array.from(selectedPaths)[0]) ?? null;

      const moveSelectionByOffset = (
        offset: number,
        shouldExtendRange: boolean,
      ) => {
        if (orderedPaths.length === 0) return;

        let currentIndex = activePath ? orderedPaths.indexOf(activePath) : -1;
        if (currentIndex === -1) {
          currentIndex = offset > 0 ? -1 : orderedPaths.length;
        }

        const nextIndex = Math.max(
          0,
          Math.min(orderedPaths.length - 1, currentIndex + offset),
        );
        const nextPath = orderedPaths[nextIndex];
        if (!nextPath) return;

        if (shouldExtendRange && lastSelectedPath) {
          selectRange(lastSelectedPath, nextPath);
        } else {
          setSelectedPaths(new Set([nextPath]));
        }
        setLastSelectedPath(nextPath);
        itemElementReferences.current.get(nextPath)?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      };

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
        const pathToOpen = activePath ?? orderedPaths[0];
        if (!pathToOpen) return;
        const fileNode = fileSystem.getNode(pathToOpen);
        if (!fileNode) return;
        handleOpen(fileNode);
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedPaths.size > 0
      ) {
        event.preventDefault();
        selectedPaths.forEach((path) => {
          fileSystem.deleteNode(path);
        });
        setSelectedPaths(new Set());
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "c" &&
        selectedPaths.size > 0
      ) {
        event.preventDefault();
        const selectedNodes = Array.from(selectedPaths)
          .map((path) => fileSystem.getNode(path))
          .filter(Boolean) as FileSystemNode[];
        setFileClipboard({
          mode: "copy",
          paths: selectedNodes.map((node) => node.path),
          updatedAt: Date.now(),
        });
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "x" &&
        selectedPaths.size > 0
      ) {
        event.preventDefault();
        const selectedNodes = Array.from(selectedPaths)
          .map((path) => fileSystem.getNode(path))
          .filter(Boolean) as FileSystemNode[];
        setFileClipboard({
          mode: "cut",
          paths: selectedNodes.map((node) => node.path),
          updatedAt: Date.now(),
        });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "v" && clipboard) {
        event.preventDefault();
        handlePaste();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "a") {
        event.preventDefault();
        setSelectedPaths(new Set(orderedPaths));
      }
    },
    [
      clipboard,
      directoryContents,
      fileSystem,
      handleOpen,
      handlePaste,
      lastSelectedPath,
      selectRange,
      selectedPaths,
    ],
  );

  /* ---- Listen for external storage changes ---- */

  useEffect(() => {
    const handleStorageEvent = () => {
      refreshContents();
    };
    window.addEventListener("storage", handleStorageEvent);
    return () => window.removeEventListener("storage", handleStorageEvent);
  }, [refreshContents]);

  /* ---- Derived values ---- */

  const breadcrumbSegments: BreadcrumbSegment[] = useMemo(() => {
    const pathParts = currentDirectoryPath.split("/").filter(Boolean);
    return pathParts.map((part, index) => ({
      name: part,
      path: "/" + pathParts.slice(0, index + 1).join("/"),
    }));
  }, [currentDirectoryPath]);

  const rootDirectories = useMemo(() => {
    void refreshTrigger;
    const rootPath = isPickerMode ? pickerRootPath : "/";
    return fileSystem
      .getChildren(rootPath, shouldShowHiddenFiles)
      .filter((node) => node.type === "directory");
  }, [
    fileSystem,
    isPickerMode,
    pickerRootPath,
    shouldShowHiddenFiles,
    refreshTrigger,
  ]);

  const pickerSelectedNode = useMemo(() => {
    if (!isPickerMode) return undefined;
    const selectedPath = Array.from(selectedPaths)[0];
    if (!selectedPath) return undefined;
    const node = fileSystem.getNode(selectedPath);
    if (!node) return undefined;
    if (!isPickerSelectable(node)) return undefined;
    return node;
  }, [fileSystem, isPickerMode, isPickerSelectable, selectedPaths]);

  const fileStatistics = useMemo(
    () => ({
      totalItems: directoryContents.length,
      selectedCount: selectedPaths.size,
      folderCount: directoryContents.filter((node) => node.type === "directory")
        .length,
      fileCount: directoryContents.filter((node) => node.type === "file")
        .length,
    }),
    [directoryContents, selectedPaths],
  );

  const handleSearchQueryChanged = useCallback((query: string) => {
    setSearchQuery(query);
    setIsSearchActive(Boolean(query));
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Render                                                            */
  /* ------------------------------------------------------------------ */

  return (
    <TooltipProvider>
      <div
        ref={rootContainerReference}
        tabIndex={0}
        data-file-drop-zone="true"
        data-file-drop-kind="explorer-window"
        data-file-drop-path={currentDirectoryPath}
        className="flex flex-col h-full bg-background text-foreground outline-none"
        onMouseDownCapture={() => {
          rootContainerReference.current?.focus();
        }}
        onPointerMoveCapture={handleTouchPointerMove}
        onPointerUpCapture={handleTouchPointerUp}
        onKeyDown={handleExplorerKeyDown}
      >
        {childWindows}

        {/* Rename dialog */}
        <RenameDialog
          isOpen={Boolean(renameTarget)}
          targetName={renameTarget?.name || ""}
          renameValue={renameValue}
          errorMessage={renameErrorMessage}
          onRenameValueChanged={(value) => {
            setRenameValue(value);
            if (renameErrorMessage) setRenameErrorMessage("");
          }}
          onSubmit={handleRenameSubmit}
          onClose={() => {
            setRenameTarget(null);
            setRenameErrorMessage("");
          }}
        />

        {/* Create file / folder dialog */}
        <CreateItemDialog
          createMode={createMode}
          currentDirectoryPath={currentDirectoryPath}
          createValue={createValue}
          errorMessage={createErrorMessage}
          onCreateValueChanged={(value) => {
            setCreateValue(value);
            if (createErrorMessage) setCreateErrorMessage("");
          }}
          onSubmit={handleCreateSubmit}
          onClose={() => {
            setCreateMode(null);
            setCreateErrorMessage("");
          }}
        />

        {/* Toolbar with navigation, breadcrumbs, search, and view controls */}
        <FileExplorerToolbar
          canGoBack={navigationHistoryIndex > 0}
          canGoForward={navigationHistoryIndex < navigationHistory.length - 1}
          canGoUp={currentDirectoryPath !== "/"}
          currentDirectoryPath={currentDirectoryPath}
          breadcrumbSegments={breadcrumbSegments}
          searchQuery={searchQuery}
          viewMode={viewMode}
          shouldShowHiddenFiles={shouldShowHiddenFiles}
          isPickerMode={isPickerMode}
          clipboard={clipboard}
          onGoBack={navigateBack}
          onGoForward={navigateForward}
          onGoUp={navigateUp}
          onRefresh={refreshContents}
          onNavigateToDirectory={navigateToDirectory}
          onSearchQueryChanged={handleSearchQueryChanged}
          onViewModeChanged={setViewMode}
          onToggleHiddenFiles={() =>
            setShouldShowHiddenFiles((previous) => !previous)
          }
          onCreateFolder={handleCreateFolder}
          onCreateFile={handleCreateFile}
          onPaste={handlePaste}
          onMovePathsToDirectory={movePathsToDirectory}
          onScheduleBreadcrumbAutoNavigate={scheduleBreadcrumbAutoNavigate}
          onClearBreadcrumbHoverTimer={clearBreadcrumbHoverTimer}
        />

        <div className="flex flex-1 min-h-0">
          {/* Sidebar with bookmarks and directory tree */}
          <div
            className="flex flex-col border-r border-border bg-muted/30 shrink-0"
            style={{ width: sidebarWidth }}
          >
            <FileExplorerSidebar
              bookmarks={sidebarBookmarks}
              currentDirectoryPath={currentDirectoryPath}
              rootDirectories={rootDirectories}
              shouldShowHiddenFiles={shouldShowHiddenFiles}
              isPickerMode={isPickerMode}
              pickerRootPath={pickerRootPath}
              onNavigateToDirectory={navigateToDirectory}
              onOpenFile={handleOpen}
              onDropPathsToDirectory={movePathsToDirectory}
            />
          </div>

          {/* Sidebar resize handle */}
          <div
            className="w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors"
            onMouseDown={(mouseDownEvent) => {
              setIsResizing(true);
              const startX = mouseDownEvent.clientX;
              const startWidth = sidebarWidth;

              const handleMouseMove = (moveEvent: MouseEvent) => {
                const difference = moveEvent.clientX - startX;
                setSidebarWidth(
                  Math.max(150, Math.min(400, startWidth + difference)),
                );
              };

              const handleMouseUp = () => {
                setIsResizing(false);
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
              };

              document.addEventListener("mousemove", handleMouseMove);
              document.addEventListener("mouseup", handleMouseUp);
            }}
          />

          {/* Main content area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* List view column headers */}
            {viewMode === "list" && (
              <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
                <div className="w-5" />
                <div
                  className="flex-1 cursor-pointer hover:text-foreground"
                  onClick={() => {
                    if (sortByField === "name") {
                      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    } else {
                      setSortByField("name");
                      setSortOrder("asc");
                    }
                  }}
                >
                  Name{" "}
                  {sortByField === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                </div>
                <div
                  className="w-20 text-right cursor-pointer hover:text-foreground"
                  onClick={() => {
                    if (sortByField === "size") {
                      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    } else {
                      setSortByField("size");
                      setSortOrder("asc");
                    }
                  }}
                >
                  Size{" "}
                  {sortByField === "size" && (sortOrder === "asc" ? "↑" : "↓")}
                </div>
                <div
                  className="w-24 text-right cursor-pointer hover:text-foreground"
                  onClick={() => {
                    if (sortByField === "modified") {
                      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    } else {
                      setSortByField("modified");
                      setSortOrder("asc");
                    }
                  }}
                >
                  Modified{" "}
                  {sortByField === "modified" &&
                    (sortOrder === "asc" ? "↑" : "↓")}
                </div>
                <div className="w-24">Permissions</div>
              </div>
            )}

            {/* File content area with context menu for background right-click */}
            <ContextMenu>
              <ContextMenuTrigger className="flex-1 min-h-0 overflow-hidden">
                <ScrollArea
                  className="h-full"
                  viewportRef={viewportReference}
                  viewportClassName="relative min-h-full"
                  viewportProps={{
                    onDragOverCapture: (event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    },
                    onDropCapture: handleDropInExplorerArea,
                  }}
                  onMouseDownCapture={startMarqueeSelection}
                >
                  <div
                    ref={contentContainerReference}
                    data-file-drop-zone="true"
                    data-file-drop-kind="explorer-root"
                    data-file-drop-path={currentDirectoryPath}
                    className="relative h-full min-h-full w-full select-none"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                    }}
                    onContextMenu={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest("[data-file-item='true']")) return;
                    }}
                  >
                    {viewMode === "grid" ? (
                      <div className="flex flex-wrap gap-2 p-4 content-start min-h-full w-full">
                        {directoryContents.length > 0 ? (
                          directoryContents.map((node) => (
                            <FileGridItem
                              key={node.path}
                              node={node}
                              isSelected={selectedPaths.has(node.path)}
                              isDragHidden={touchDragVisual.isBaseHidden(
                                node.path,
                              )}
                              onSelect={handleSelect}
                              onContextSelect={handleContextSelect}
                              onItemRef={handleItemRef}
                              onOpen={handleOpen}
                              onTouchPointerDown={handleTouchPointerDownItem}
                              onOpenInEditor={handleOpenInEditor}
                              onViewProperties={handleViewProperties}
                              onOpenTerminalHere={(node) =>
                                handleOpenTerminalHere(node.path)
                              }
                              onDragStartItem={handleDragStartItem}
                              onDragEndItem={handleDragEndItem}
                              onDropOnDirectory={handleDropOnDirectory}
                              onRename={handleRename}
                              onDelete={handleDelete}
                              onCopy={handleCopy}
                              onCut={handleCut}
                            />
                          ))
                        ) : (
                          <div className="w-full h-32 flex items-center justify-center text-muted-foreground">
                            {isSearchActive
                              ? "No results found"
                              : "Empty folder"}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="min-h-full w-full">
                        {directoryContents.length > 0 ? (
                          directoryContents.map((node) => (
                            <FileListItem
                              key={node.path}
                              node={node}
                              isSelected={selectedPaths.has(node.path)}
                              isDragHidden={touchDragVisual.isBaseHidden(
                                node.path,
                              )}
                              onSelect={handleSelect}
                              onContextSelect={handleContextSelect}
                              onItemRef={handleItemRef}
                              onOpen={handleOpen}
                              onTouchPointerDown={handleTouchPointerDownItem}
                              onOpenInEditor={handleOpenInEditor}
                              onViewProperties={handleViewProperties}
                              onOpenTerminalHere={(node) =>
                                handleOpenTerminalHere(node.path)
                              }
                              onDragStartItem={handleDragStartItem}
                              onDragEndItem={handleDragEndItem}
                              onDropOnDirectory={handleDropOnDirectory}
                              onRename={handleRename}
                              onDelete={handleDelete}
                              onCopy={handleCopy}
                              onCut={handleCut}
                            />
                          ))
                        ) : (
                          <div className="w-full h-32 flex items-center justify-center text-muted-foreground">
                            {isSearchActive
                              ? "No results found"
                              : "Empty folder"}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Marquee selection rectangle */}
                    <div
                      ref={marqueeElementReference}
                      className="absolute border border-primary/60 bg-primary/10 pointer-events-none rounded-sm"
                      style={{ display: "none" }}
                    />

                    {/* Touch drag overlay */}
                    {typeof window !== "undefined" &&
                    touchDragVisual.isOverlayVisible &&
                    rootContainerReference.current
                      ? createPortal(
                          <div className="pointer-events-none fixed inset-0 z-[8000]">
                            {touchDragVisual.overlayIds.map((draggedPath) => {
                              const node =
                                directoryContents.find(
                                  (item) => item.path === draggedPath,
                                ) ?? fileSystem.getNode(draggedPath);
                              if (!node) return null;

                              const overlayStyle =
                                touchDragVisual.getOverlayItemStyle(
                                  draggedPath,
                                );
                              if (!overlayStyle) return null;

                              const containerRect =
                                rootContainerReference.current?.getBoundingClientRect();

                              return (
                                <div
                                  key={`explorer-touch-overlay-${draggedPath}`}
                                  className="absolute"
                                  style={{
                                    left:
                                      (containerRect?.left ?? 0) +
                                      overlayStyle.left,
                                    top:
                                      (containerRect?.top ?? 0) +
                                      overlayStyle.top,
                                    transition: overlayStyle.transition,
                                    transform: overlayStyle.transform,
                                  }}
                                >
                                  <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-primary/10 ring-2 ring-primary/40 w-24">
                                    <div className="w-12 h-12 flex items-center justify-center">
                                      {getFileIcon(node, 40)}
                                    </div>
                                    <span
                                      className="text-xs text-center w-full leading-4 overflow-hidden break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
                                      title={getDisplayName(node)}
                                    >
                                      {getDisplayName(node)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>,
                          document.body,
                        )
                      : null}
                  </div>
                </ScrollArea>
              </ContextMenuTrigger>

              {/* Background context menu (right-click on empty space) */}
              <ContextMenuContent className="w-48">
                {!isPickerMode ? (
                  <ContextMenuItem onClick={handleCreateFolder}>
                    <FolderPlus size={16} className="mr-2" />
                    New Folder
                  </ContextMenuItem>
                ) : null}
                {!isPickerMode ? (
                  <ContextMenuItem onClick={handleCreateFile}>
                    <FilePlus size={16} className="mr-2" />
                    New File
                  </ContextMenuItem>
                ) : null}
                {clipboard ? (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={handlePaste}>
                      <ClipboardPaste size={16} className="mr-2" />
                      Paste
                      <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
                    </ContextMenuItem>
                  </>
                ) : null}
                {!isPickerMode ? <ContextMenuSeparator /> : null}
                {!isPickerMode ? (
                  <ContextMenuItem
                    onClick={() => handleOpenTerminalHere(currentDirectoryPath)}
                  >
                    <TerminalSquare size={16} className="mr-2" />
                    Open Terminal Here
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem
                  onClick={() =>
                    setShouldShowHiddenFiles((previous) => !previous)
                  }
                >
                  {shouldShowHiddenFiles ? (
                    <EyeOff size={16} className="mr-2" />
                  ) : (
                    <Eye size={16} className="mr-2" />
                  )}
                  {shouldShowHiddenFiles
                    ? "Hide hidden files"
                    : "Show hidden files"}
                </ContextMenuItem>
                <ContextMenuItem onClick={refreshContents}>
                  <RefreshCw size={16} className="mr-2" />
                  Refresh
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </div>

        {/* Status bar / picker action bar */}
        {isPickerMode ? (
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground">
            <div className="truncate">
              {pickerSelectedNode
                ? `Selected: ${pickerSelectedNode.name}`
                : pickerSelectionMode === "directory"
                  ? "Select a folder"
                  : "Select a file"}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => picker?.onCancel?.()}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!pickerSelectedNode) return;
                  picker?.onPick?.(pickerSelectedNode);
                }}
                disabled={!pickerSelectedNode}
              >
                Open
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>{fileStatistics.totalItems} items</span>
              {fileStatistics.selectedCount > 0 && (
                <span>{fileStatistics.selectedCount} selected</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span>
                {fileStatistics.folderCount} folders, {fileStatistics.fileCount}{" "}
                files
              </span>
              {clipboard && (
                <span className="text-primary">
                  {clipboard.paths.length} item(s) in clipboard (
                  {clipboard.mode})
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
