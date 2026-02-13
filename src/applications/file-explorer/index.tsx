"use client";

import {
    DocumentViewerApplicationWindow,
    TextEditorApplicationWindow,
} from "@/app/application-windows";
import { Button } from "@/components/ui/button";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    FileSystemNode,
    useFileSystem,
} from "@/hooks/use-file-system";
import { cn } from "@/lib/utils";
import {
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ChevronDown,
    ChevronRight,
    Copy,
    Download,
    Edit3,
    Eye,
    EyeOff,
    File,
    FileAudio,
    FileCode,
    FileImage,
    FileJson,
    FilePlus,
    FileText,
    FileVideo,
    Folder,
    FolderOpen,
    FolderPlus,
    Grid3X3,
    HardDrive,
    Home,
    Image,
    LayoutList,
    MoreVertical,
    Music,
    RefreshCw,
    Scissors,
    Search,
    Trash2,
    Video,
} from "lucide-react";
import { ReactPortal, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { v4 } from "uuid";

type ViewMode = "grid" | "list";
type SortBy = "name" | "size" | "modified" | "type";
type SortOrder = "asc" | "desc";

export function humanFileSize(bytes: number, si = false, dp = 1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " B";
  }

  const units = si
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return bytes.toFixed(dp) + " " + units[u];
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (days === 1) {
    return "Yesterday";
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  }
}

function getFileIcon(node: FileSystemNode, size: number = 18) {
  if (node.type === "directory") {
    const iconMap: Record<string, typeof Folder> = {
      Documents: FileText,
      Downloads: Download,
      Pictures: Image,
      Music: Music,
      Videos: Video,
      Desktop: HardDrive,
    };
    const IconComponent = iconMap[node.name] || Folder;
    return <IconComponent size={size} className="text-blue-400" />;
  }

  const ext = node.name.split(".").pop()?.toLowerCase();
  const iconConfig: { icon: typeof File; color: string } = (() => {
    switch (ext) {
      case "txt":
      case "md":
      case "doc":
      case "docx":
      case "pdf":
        return { icon: FileText, color: "text-gray-400" };
      case "js":
      case "ts":
      case "jsx":
      case "tsx":
      case "py":
      case "java":
      case "cpp":
      case "c":
      case "h":
      case "css":
      case "html":
      case "sh":
      case "bash":
        return { icon: FileCode, color: "text-green-400" };
      case "json":
      case "yaml":
      case "yml":
      case "xml":
      case "toml":
        return { icon: FileJson, color: "text-yellow-400" };
      case "png":
      case "jpg":
      case "jpeg":
      case "gif":
      case "svg":
      case "webp":
      case "ico":
        return { icon: FileImage, color: "text-pink-400" };
      case "mp3":
      case "wav":
      case "flac":
      case "ogg":
      case "m4a":
        return { icon: FileAudio, color: "text-purple-400" };
      case "mp4":
      case "mkv":
      case "avi":
      case "mov":
      case "webm":
        return { icon: FileVideo, color: "text-red-400" };
      default:
        return { icon: File, color: "text-gray-400" };
    }
  })();

  const IconComponent = iconConfig.icon;
  return <IconComponent size={size} className={iconConfig.color} />;
}

interface SidebarBookmark {
  name: string;
  path: string;
  icon: typeof Home;
}

const BOOKMARKS: SidebarBookmark[] = [
  { name: "Home", path: "/home/user", icon: Home },
  { name: "Documents", path: "/home/user/Documents", icon: FileText },
  { name: "Downloads", path: "/home/user/Downloads", icon: Download },
  { name: "Pictures", path: "/home/user/Pictures", icon: Image },
  { name: "Music", path: "/home/user/Music", icon: Music },
  { name: "Videos", path: "/home/user/Videos", icon: Video },
];

interface DirectoryTreeItemProps {
  node: FileSystemNode;
  level: number;
  currentPath: string;
  onNavigate: (path: string) => void;
  showHidden: boolean;
}

function DirectoryTreeItem({ node, level, currentPath, onNavigate, showHidden }: DirectoryTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const fs = useFileSystem();
  
  const children = useMemo(() => {
    if (!isExpanded) return [];
    return fs.getChildren(node.path, showHidden).filter(n => n.type === "directory");
  }, [isExpanded, node.path, showHidden]);

  const isActive = currentPath === node.path;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-accent/50 rounded-md text-sm",
          isActive && "bg-accent text-accent-foreground"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onNavigate(node.path)}
      >
        <button
          className="p-0.5 hover:bg-accent rounded"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          {isExpanded ? (
            <ChevronDown size={14} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground" />
          )}
        </button>
        {isExpanded ? (
          <FolderOpen size={16} className="text-blue-400 shrink-0" />
        ) : (
          <Folder size={16} className="text-blue-400 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {isExpanded && children.map((child) => (
        <DirectoryTreeItem
          key={child.path}
          node={child}
          level={level + 1}
          currentPath={currentPath}
          onNavigate={onNavigate}
          showHidden={showHidden}
        />
      ))}
    </div>
  );
}

interface FileGridItemProps {
  node: FileSystemNode;
  isSelected: boolean;
  onSelect: (path: string, event: React.MouseEvent<HTMLDivElement>) => void;
  onOpen: (node: FileSystemNode) => void;
  onRename: (node: FileSystemNode) => void;
  onDelete: (node: FileSystemNode) => void;
  onCopy: (node: FileSystemNode) => void;
  onCut: (node: FileSystemNode) => void;
  onContextSelect: (path: string, event: React.MouseEvent<HTMLDivElement>) => void;
  onItemRef: (path: string, node: HTMLDivElement | null) => void;
}

function FileGridItem({ node, isSelected, onSelect, onOpen, onRename, onDelete, onCopy, onCut, onContextSelect, onItemRef }: FileGridItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={(nodeRef) => onItemRef(node.path, nodeRef)}
          data-file-item="true"
          data-file-hit="true"
          className={cn(
            "flex flex-col items-center gap-1 p-3 rounded-lg cursor-pointer transition-all",
            "hover:bg-primary/10 w-24",
            isSelected && "bg-primary/10 ring-2 ring-primary/40"
          )}
          onMouseDown={(e) => {
            e.stopPropagation();
            onSelect(node.path, e);
          }}
          onContextMenu={(e) => {
            onContextSelect(node.path, e);
          }}
          onDoubleClick={() => onOpen(node)}
        >
          <div className="w-12 h-12 flex items-center justify-center">
            {getFileIcon(node, 40)}
          </div>
          <span className="text-xs text-center w-full truncate" title={node.name}>
            {node.name}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => onOpen(node)}>
          <Eye size={16} className="mr-2" />
          Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCut(node)}>
          <Scissors size={16} className="mr-2" />
          Cut
          <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCopy(node)}>
          <Copy size={16} className="mr-2" />
          Copy
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onRename(node)}>
          <Edit3 size={16} className="mr-2" />
          Rename
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDelete(node)} className="text-destructive">
          <Trash2 size={16} className="mr-2" />
          Delete
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface FileListItemProps extends FileGridItemProps {}

function FileListItem({ node, isSelected, onSelect, onOpen, onRename, onDelete, onCopy, onCut, onContextSelect, onItemRef }: FileListItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={(nodeRef) => onItemRef(node.path, nodeRef)}
          data-file-item="true"
          data-file-hit="true"
          className={cn(
            "flex items-center gap-3 px-3 py-2 hover:bg-primary/10 cursor-pointer transition-all border-b border-border/50",
            isSelected && "bg-primary/10"
          )}
          onMouseDown={(e) => {
            e.stopPropagation();
            onSelect(node.path, e);
          }}
          onContextMenu={(e) => {
            onContextSelect(node.path, e);
          }}
          onDoubleClick={() => onOpen(node)}
        >
          <div className="w-5 flex items-center justify-center shrink-0">
            {getFileIcon(node, 18)}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm truncate block" title={node.name}>
              {node.name}
            </span>
          </div>
          <div className="w-20 text-xs text-muted-foreground text-right shrink-0">
            {node.type === "file" ? humanFileSize(node.size) : "--"}
          </div>
          <div className="w-24 text-xs text-muted-foreground text-right shrink-0">
            {formatDate(node.modifiedAt)}
          </div>
          <div className="w-24 text-xs text-muted-foreground font-mono shrink-0">
            {node.permissions}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => onOpen(node)}>
          <Eye size={16} className="mr-2" />
          Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCut(node)}>
          <Scissors size={16} className="mr-2" />
          Cut
          <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCopy(node)}>
          <Copy size={16} className="mr-2" />
          Copy
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onRename(node)}>
          <Edit3 size={16} className="mr-2" />
          Rename
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDelete(node)} className="text-destructive">
          <Trash2 size={16} className="mr-2" />
          Delete
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function FileExplorerApplication() {
  const fs = useFileSystem();
  
  const [currentPath, setCurrentPath] = useState("/home/user");
  const [history, setHistory] = useState<string[]>(["/home/user"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<FileSystemNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [createMode, setCreateMode] = useState<"file" | "folder" | null>(null);
  const [createValue, setCreateValue] = useState("");
  const [createError, setCreateError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isSelectingRef = useRef(false);
  const selectionOriginRef = useRef<{ x: number; y: number } | null>(null);
  const selectionBaseRef = useRef<Set<string>>(new Set());
  
  const [clipboard, setClipboard] = useState<{ nodes: FileSystemNode[]; mode: "copy" | "cut" } | null>(null);
  
  const [childWindows, setChildWindows] = useState<ReactPortal[]>([]);
  
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [, setIsResizing] = useState(false);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const contents = useMemo(() => {
    void refreshTrigger;
    let items: FileSystemNode[];
    
    if (isSearching && searchQuery) {
      items = fs.searchFiles(searchQuery, currentPath);
    } else {
      items = fs.getChildren(currentPath, showHidden);
    }

    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }

      let comparison = 0;
      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "size":
          comparison = a.size - b.size;
          break;
        case "modified":
          comparison = a.modifiedAt - b.modifiedAt;
          break;
        case "type":
          const extA = a.name.split(".").pop() || "";
          const extB = b.name.split(".").pop() || "";
          comparison = extA.localeCompare(extB);
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return items;
  }, [currentPath, showHidden, searchQuery, isSearching, sortBy, sortOrder, refreshTrigger]);

  const navigate = useCallback((path: string) => {
    const normalized = fs.normalizePath(path);
    if (fs.exists(normalized) && fs.isDirectory(normalized)) {
      setCurrentPath(normalized);
      setSelectedPaths(new Set());
      
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(normalized);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  }, [history, historyIndex]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setCurrentPath(history[historyIndex - 1]);
      setSelectedPaths(new Set());
    }
  }, [history, historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setCurrentPath(history[historyIndex + 1]);
      setSelectedPaths(new Set());
    }
  }, [history, historyIndex]);

  const goUp = useCallback(() => {
    const parent = fs.getParentPath(currentPath);
    if (parent !== currentPath) {
      navigate(parent);
    }
  }, [currentPath, navigate]);

  const refresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const updateSelection = useCallback((next: Set<string>) => {
    setSelectedPaths(new Set(next));
  }, []);

  const selectRange = useCallback(
    (fromPath: string, toPath: string) => {
      const fromIndex = contents.findIndex((item) => item.path === fromPath);
      const toIndex = contents.findIndex((item) => item.path === toPath);
      if (fromIndex === -1 || toIndex === -1) return;
      const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const next = new Set<string>();
      for (let i = start; i <= end; i += 1) {
        next.add(contents[i].path);
      }
      updateSelection(next);
    },
    [contents, updateSelection]
  );

  const handleSelect = useCallback(
    (path: string, event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      rootRef.current?.focus();
      if (event.shiftKey && lastSelectedPath) {
        selectRange(lastSelectedPath, path);
        setLastSelectedPath(path);
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const next = new Set(selectedPaths);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        updateSelection(next);
        setLastSelectedPath(path);
        return;
      }

      updateSelection(new Set([path]));
      setLastSelectedPath(path);
    },
    [lastSelectedPath, selectRange, selectedPaths, updateSelection]
  );

  const handleContextSelect = useCallback(
    (path: string, event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (!selectedPaths.has(path)) {
        updateSelection(new Set([path]));
        setLastSelectedPath(path);
      }
    },
    [selectedPaths, updateSelection]
  );

  const handleItemRef = useCallback((path: string, node: HTMLDivElement | null) => {
    if (node) {
      itemRefs.current.set(path, node);
    } else {
      itemRefs.current.delete(path);
    }
  }, []);

  const startMarquee = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-file-item='true']")) return;

      const container = viewportRef.current ?? contentRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const origin = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      selectionOriginRef.current = origin;
      isSelectingRef.current = true;
      selectionBaseRef.current = event.ctrlKey || event.metaKey ? new Set(selectedPaths) : new Set();
      setMarquee({ x: origin.x, y: origin.y, width: 0, height: 0 });
      if (!event.ctrlKey && !event.metaKey) {
        updateSelection(new Set());
      }
    },
    [selectedPaths, updateSelection]
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
      if (!isSelectingRef.current || !selectionOriginRef.current) return;
      if (event.buttons === 0) {
        endSelection();
        return;
      }

      const container = viewportRef.current ?? contentRef.current;
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
      contents.forEach((item) => {
        const element = itemRefs.current.get(item.path);
        if (!element) return;
        const hitTarget = element.querySelector(
          "[data-file-hit='true']"
        ) as HTMLElement | null;
        const itemRect = (hitTarget ?? element).getBoundingClientRect();
        const relative = {
          left: itemRect.left - rect.left,
          top: itemRect.top - rect.top,
          right: itemRect.right - rect.left,
          bottom: itemRect.bottom - rect.top,
        };
        const intersects =
          selectionRect.left <= relative.right &&
          selectionRect.right >= relative.left &&
          selectionRect.top <= relative.bottom &&
          selectionRect.bottom >= relative.top;
        if (intersects) {
          nextSelection.add(item.path);
        }
      });

      updateSelection(nextSelection);
    };

    const handleMouseUp = () => {
      endSelection();
    };

    const handleBlur = () => {
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
  }, [contents, endSelection, updateSelection]);

  const handleOpen = useCallback((node: FileSystemNode) => {
    if (node.type === "directory") {
      navigate(node.path);
    } else {
      const ext = node.name.split(".").pop()?.toLowerCase();
      
      if (ext === "pdf") {
        const portal = createPortal(
          <DocumentViewerApplicationWindow articleId={node.path} />,
          document.getElementById("operating-system-container") as HTMLDivElement,
          "document_viewer_" + v4()
        );
        setChildWindows((prev) => [...prev, portal]);
      } else {
        const portal = createPortal(
          <TextEditorApplicationWindow filePath={node.path} />,
          document.getElementById("operating-system-container") as HTMLDivElement,
          "text_editor_" + v4()
        );
        setChildWindows((prev) => [...prev, portal]);
      }
    }
  }, [navigate]);

  const handleRename = useCallback((node: FileSystemNode) => {
    setRenameTarget(node);
    setRenameValue(node.name);
    setRenameError("");
  }, []);

  const handleDelete = useCallback((node: FileSystemNode) => {
    fs.deleteNode(node.path);
    setSelectedPaths((prev) => {
      const newSet = new Set(prev);
      newSet.delete(node.path);
      return newSet;
    });
  }, []);

  const handleCopy = useCallback((node: FileSystemNode) => {
    setClipboard({ nodes: [node], mode: "copy" });
  }, []);

  const handleCut = useCallback((node: FileSystemNode) => {
    setClipboard({ nodes: [node], mode: "cut" });
  }, []);

  const handlePaste = useCallback(() => {
    if (!clipboard) return;

    clipboard.nodes.forEach((node) => {
      if (clipboard.mode === "copy") {
        fs.copy(node.path, currentPath);
      } else {
        fs.move(node.path, currentPath);
      }
    });

    if (clipboard.mode === "cut") {
      setClipboard(null);
    }
  }, [clipboard, currentPath]);

  const handleCreateFolder = useCallback(() => {
    setCreateMode("folder");
    setCreateValue("New Folder");
    setCreateError("");
  }, []);

  const handleCreateFile = useCallback(() => {
    setCreateMode("file");
    setCreateValue("New File.txt");
    setCreateError("");
  }, []);

  const handleRenameSubmit = useCallback(() => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Name is required.");
      return;
    }
    if (trimmed === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    const targetPath = fs.normalizePath(`${renameTarget.parentPath}/${trimmed}`);
    if (fs.exists(targetPath)) {
      setRenameError("An item with this name already exists.");
      return;
    }
    fs.rename(renameTarget.path, trimmed);
    setRenameTarget(null);
  }, [fs, renameTarget, renameValue]);

  const handleCreateSubmit = useCallback(() => {
    if (!createMode) return;
    const trimmed = createValue.trim();
    if (!trimmed) {
      setCreateError("Name is required.");
      return;
    }
    const targetPath = fs.normalizePath(`${currentPath}/${trimmed}`);
    if (fs.exists(targetPath)) {
      setCreateError("An item with this name already exists.");
      return;
    }
    if (createMode === "folder") {
      fs.createDirectory(currentPath, trimmed);
    } else {
      fs.createFile(currentPath, trimmed, "");
    }
    setCreateMode(null);
  }, [createMode, createValue, currentPath, fs]);

  const handleExplorerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        const isEditable =
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          target.isContentEditable ||
          Boolean(target.closest(".monaco-editor"));
        if (isEditable) {
          return;
        }
      }

      const orderedPaths = contents.map((item) => item.path);
      const activePath =
        (lastSelectedPath && selectedPaths.has(lastSelectedPath)
          ? lastSelectedPath
          : Array.from(selectedPaths)[0]) ?? null;

      const moveSelectionByOffset = (offset: number, extendRange: boolean) => {
        if (orderedPaths.length === 0) return;

        let currentIndex = activePath ? orderedPaths.indexOf(activePath) : -1;
        if (currentIndex === -1) {
          currentIndex = offset > 0 ? -1 : orderedPaths.length;
        }

        const nextIndex = Math.max(
          0,
          Math.min(orderedPaths.length - 1, currentIndex + offset)
        );
        const nextPath = orderedPaths[nextIndex];
        if (!nextPath) return;

        if (extendRange && lastSelectedPath) {
          selectRange(lastSelectedPath, nextPath);
        } else {
          setSelectedPaths(new Set([nextPath]));
        }
        setLastSelectedPath(nextPath);
        itemRefs.current
          .get(nextPath)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      };

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        moveSelectionByOffset(-1, e.shiftKey);
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        moveSelectionByOffset(1, e.shiftKey);
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const pathToOpen = activePath ?? orderedPaths[0];
        if (!pathToOpen) return;
        const node = fs.getNode(pathToOpen);
        if (!node) return;
        handleOpen(node);
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedPaths.size > 0) {
        e.preventDefault();
        selectedPaths.forEach((path) => {
          fs.deleteNode(path);
        });
        setSelectedPaths(new Set());
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedPaths.size > 0) {
        e.preventDefault();
        const nodes = Array.from(selectedPaths)
          .map((p) => fs.getNode(p))
          .filter(Boolean) as FileSystemNode[];
        setClipboard({ nodes, mode: "copy" });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "x" && selectedPaths.size > 0) {
        e.preventDefault();
        const nodes = Array.from(selectedPaths)
          .map((p) => fs.getNode(p))
          .filter(Boolean) as FileSystemNode[];
        setClipboard({ nodes, mode: "cut" });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard) {
        e.preventDefault();
        handlePaste();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelectedPaths(new Set(orderedPaths));
      }
    },
    [clipboard, contents, fs, handleOpen, handlePaste, lastSelectedPath, selectRange, selectedPaths]
  );

  useEffect(() => {
    const handleStorage = () => {
      refresh();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [refresh]);

  const pathParts = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean);
    return parts.map((part, index) => ({
      name: part,
      path: "/" + parts.slice(0, index + 1).join("/"),
    }));
  }, [currentPath]);

  const rootDirs = useMemo(() => {
    void refreshTrigger;
    return fs.getChildren("/", showHidden).filter(n => n.type === "directory");
  }, [showHidden, refreshTrigger]);

  const stats = useMemo(() => {
    return {
      total: contents.length,
      selected: selectedPaths.size,
      folders: contents.filter((n) => n.type === "directory").length,
      files: contents.filter((n) => n.type === "file").length,
    };
  }, [contents, selectedPaths]);

  return (
    <TooltipProvider>
      <div
        ref={rootRef}
        tabIndex={0}
        className="flex flex-col h-full bg-background text-foreground outline-none"
        onMouseDownCapture={() => {
          rootRef.current?.focus();
        }}
        onKeyDown={handleExplorerKeyDown}
      >
        {childWindows}

        <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameError("");
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rename</DialogTitle>
              <DialogDescription>
                Choose a new name for {renameTarget?.name || "this item"}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="rename-input">Name</Label>
              <Input
                id="rename-input"
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
              <Button variant="outline" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleRenameSubmit}>Rename</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(createMode)} onOpenChange={(open) => {
          if (!open) {
            setCreateMode(null);
            setCreateError("");
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {createMode === "folder" ? "New Folder" : "New File"}
              </DialogTitle>
              <DialogDescription>
                Create a {createMode === "folder" ? "folder" : "file"} in {currentPath}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="create-input">Name</Label>
              <Input
                id="create-input"
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
              <Button variant="outline" onClick={() => setCreateMode(null)}>
                Cancel
              </Button>
              <Button onClick={handleCreateSubmit}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        
        <div className="flex items-center gap-1 p-2 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={goBack}
                  disabled={historyIndex === 0}
                >
                  <ArrowLeft size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={goForward}
                  disabled={historyIndex === history.length - 1}
                >
                  <ArrowRight size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Forward</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={goUp}
                  disabled={currentPath === "/"}
                >
                  <ArrowUp size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Go up</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={refresh}>
                  <RefreshCw size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </div>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <div className="flex-1 flex items-center gap-1 bg-muted/50 rounded-md px-2 py-1 min-w-0">
            <button
              onClick={() => navigate("/")}
              className="hover:bg-accent rounded p-0.5 shrink-0"
            >
              <HardDrive size={14} />
            </button>
            {pathParts.map((part) => (
              <div key={part.path} className="flex items-center shrink-0">
                <ChevronRight size={12} className="text-muted-foreground mx-0.5" />
                <button
                  onClick={() => navigate(part.path)}
                  className="hover:bg-accent rounded px-1 py-0.5 text-sm truncate max-w-32"
                >
                  {part.name}
                </button>
              </div>
            ))}
          </div>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <div className="relative w-48">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearching(!!e.target.value);
              }}
              placeholder="Search..."
              className="h-7 pl-7 text-sm"
            />
          </div>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setViewMode("grid")}
                >
                  <Grid3X3 size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Grid view</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setViewMode("list")}
                >
                  <LayoutList size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>List view</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showHidden ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setShowHidden(!showHidden)}
                >
                  {showHidden ? <Eye size={16} /> : <EyeOff size={16} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showHidden ? "Hide hidden files" : "Show hidden files"}</TooltipContent>
            </Tooltip>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCreateFolder}>
                <FolderPlus size={16} className="mr-2" />
                New Folder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCreateFile}>
                <FilePlus size={16} className="mr-2" />
                New File
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handlePaste} disabled={!clipboard}>
                Paste
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-1 min-h-0">
          <div
            className="flex flex-col border-r border-border bg-muted/30 shrink-0"
            style={{ width: sidebarWidth }}
          >
            <ScrollArea className="flex-1">
              <div className="p-2">
                <div className="mb-4">
                  <div className="text-xs font-semibold text-muted-foreground uppercase px-2 mb-2">
                    Places
                  </div>
                  {BOOKMARKS.map((bookmark) => {
                    const Icon = bookmark.icon;
                    return (
                      <button
                        key={bookmark.path}
                        onClick={() => navigate(bookmark.path)}
                        className={cn(
                          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent/50 transition-colors",
                          currentPath === bookmark.path && "bg-accent text-accent-foreground"
                        )}
                      >
                        <Icon size={16} className="shrink-0" />
                        <span className="truncate">{bookmark.name}</span>
                      </button>
                    );
                  })}
                </div>

                <Separator className="my-2" />

                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase px-2 mb-2">
                    File System
                  </div>
                  <button
                    onClick={() => navigate("/")}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1 rounded-md text-sm hover:bg-accent/50",
                      currentPath === "/" && "bg-accent text-accent-foreground"
                    )}
                  >
                    <HardDrive size={16} className="text-muted-foreground" />
                    <span>/</span>
                  </button>
                  {rootDirs.map((dir) => (
                    <DirectoryTreeItem
                      key={dir.path}
                      node={dir}
                      level={1}
                      currentPath={currentPath}
                      onNavigate={navigate}
                      showHidden={showHidden}
                    />
                  ))}
                </div>
              </div>
            </ScrollArea>
          </div>

          <div
            className="w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors"
            onMouseDown={(e) => {
              setIsResizing(true);
              const startX = e.clientX;
              const startWidth = sidebarWidth;

              const handleMouseMove = (e: MouseEvent) => {
                const diff = e.clientX - startX;
                setSidebarWidth(Math.max(150, Math.min(400, startWidth + diff)));
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

          <div className="flex-1 flex flex-col min-w-0">
            {viewMode === "list" && (
              <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
                <div className="w-5" />
                <div 
                  className="flex-1 cursor-pointer hover:text-foreground"
                  onClick={() => {
                    if (sortBy === "name") {
                      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    } else {
                      setSortBy("name");
                      setSortOrder("asc");
                    }
                  }}
                >
                  Name {sortBy === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                </div>
                <div 
                  className="w-20 text-right cursor-pointer hover:text-foreground"
                  onClick={() => {
                    if (sortBy === "size") {
                      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    } else {
                      setSortBy("size");
                      setSortOrder("asc");
                    }
                  }}
                >
                  Size {sortBy === "size" && (sortOrder === "asc" ? "↑" : "↓")}
                </div>
                <div 
                  className="w-24 text-right cursor-pointer hover:text-foreground"
                  onClick={() => {
                    if (sortBy === "modified") {
                      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    } else {
                      setSortBy("modified");
                      setSortOrder("asc");
                    }
                  }}
                >
                  Modified {sortBy === "modified" && (sortOrder === "asc" ? "↑" : "↓")}
                </div>
                <div className="w-24">Permissions</div>
              </div>
            )}

            <ContextMenu>
              <ContextMenuTrigger className="flex-1">
                <ScrollArea
                  className="h-full"
                  viewportRef={viewportRef}
                  viewportClassName="relative"
                  onMouseDownCapture={startMarquee}
                >
                  <div
                    ref={contentRef}
                    className="relative min-h-full w-full select-none"
                    onContextMenu={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest("[data-file-item='true']")) return;
                    }}
                  >
                    {viewMode === "grid" ? (
                      <div className="flex flex-wrap gap-2 p-4 content-start min-h-full w-full">
                        {contents.length > 0 ? (
                          contents.map((node) => (
                            <FileGridItem
                              key={node.path}
                              node={node}
                              isSelected={selectedPaths.has(node.path)}
                              onSelect={handleSelect}
                              onContextSelect={handleContextSelect}
                              onItemRef={handleItemRef}
                              onOpen={handleOpen}
                              onRename={handleRename}
                              onDelete={handleDelete}
                              onCopy={handleCopy}
                              onCut={handleCut}
                            />
                          ))
                        ) : (
                          <div className="w-full h-32 flex items-center justify-center text-muted-foreground">
                            {isSearching ? "No results found" : "Empty folder"}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="min-h-full w-full">
                        {contents.length > 0 ? (
                          contents.map((node) => (
                            <FileListItem
                              key={node.path}
                              node={node}
                              isSelected={selectedPaths.has(node.path)}
                              onSelect={handleSelect}
                              onContextSelect={handleContextSelect}
                              onItemRef={handleItemRef}
                              onOpen={handleOpen}
                              onRename={handleRename}
                              onDelete={handleDelete}
                              onCopy={handleCopy}
                              onCut={handleCut}
                            />
                          ))
                        ) : (
                          <div className="w-full h-32 flex items-center justify-center text-muted-foreground">
                            {isSearching ? "No results found" : "Empty folder"}
                          </div>
                        )}
                      </div>
                    )}
                    {marquee ? (
                      <div
                        className="absolute border border-primary/60 bg-primary/10 pointer-events-none rounded-sm"
                        style={{
                          left: `${marquee.x}px`,
                          top: `${marquee.y}px`,
                          width: `${marquee.width}px`,
                          height: `${marquee.height}px`,
                        }}
                      />
                    ) : null}
                  </div>
                </ScrollArea>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem onClick={handleCreateFolder}>
                  <FolderPlus size={16} className="mr-2" />
                  New Folder
                </ContextMenuItem>
                <ContextMenuItem onClick={handleCreateFile}>
                  <FilePlus size={16} className="mr-2" />
                  New File
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handlePaste} disabled={!clipboard}>
                  Paste
                  <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => setShowHidden(!showHidden)}>
                  {showHidden ? <EyeOff size={16} className="mr-2" /> : <Eye size={16} className="mr-2" />}
                  {showHidden ? "Hide hidden files" : "Show hidden files"}
                </ContextMenuItem>
                <ContextMenuItem onClick={refresh}>
                  <RefreshCw size={16} className="mr-2" />
                  Refresh
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </div>

        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>{stats.total} items</span>
            {stats.selected > 0 && <span>{stats.selected} selected</span>}
          </div>
          <div className="flex items-center gap-4">
            <span>{stats.folders} folders, {stats.files} files</span>
            {clipboard && (
              <span className="text-primary">
                {clipboard.nodes.length} item(s) in clipboard ({clipboard.mode})
              </span>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
