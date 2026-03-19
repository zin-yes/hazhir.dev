"use client";

import { useFileSystem, FileSystemNode } from "@/hooks/use-file-system";
import { executeFilePath } from "@/lib/file-execution";
import { getHomePath } from "@/lib/system-user";
import {
  getDisplayName,
  getFileIcon,
  humanFileSize,
} from "@/applications/file-explorer/lib/file-explorer-utils";
import {
  ArrowLeft,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Grid3X3,
  HardDrive,
  Home,
  Image,
  List,
  MoreVertical,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type ViewMode = "grid" | "list";
type SortByField = "name" | "size" | "modified" | "type";

/* ------------------------------------------------------------------ */
/*  Mobile File Explorer                                              */
/* ------------------------------------------------------------------ */

export default function MobileFileExplorerApplication({
  initialPath,
}: {
  initialPath?: string;
}) {
  const fileSystem = useFileSystem();
  const homePath = getHomePath();

  const initialExplorerPath = useMemo(() => {
    if (!initialPath) return homePath;
    const normalized = fileSystem.normalizePath(initialPath);
    if (fileSystem.exists(normalized) && fileSystem.isDirectory(normalized))
      return normalized;
    return homePath;
  }, [fileSystem, homePath, initialPath]);

  const [currentPath, setCurrentPath] = useState(initialExplorerPath);
  const [history, setHistory] = useState<string[]>([initialExplorerPath]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortBy, setSortBy] = useState<SortByField>("name");
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  /* Create dialog state */
  const [createMode, setCreateMode] = useState<"file" | "folder" | null>(null);
  const [createValue, setCreateValue] = useState("");
  const [createError, setCreateError] = useState("");

  const lastTapRef = useRef<{ path: string; at: number } | null>(null);

  const bookmarks = useMemo(
    () => [
      { name: "Home", path: homePath, icon: Home },
      { name: "Desktop", path: `${homePath}/Desktop`, icon: HardDrive },
      { name: "Documents", path: `${homePath}/Documents`, icon: FileText },
      { name: "Images", path: `${homePath}/Images`, icon: Image },
      { name: "Apps", path: "/applications", icon: Grid3X3 },
      { name: "Root", path: "/", icon: HardDrive },
    ],
    [homePath],
  );

  /* Directory contents */
  const contents = useMemo(() => {
    void refreshTrigger;
    let items: FileSystemNode[];
    if (isSearching && searchQuery) {
      items = fileSystem.searchFiles(searchQuery, currentPath);
    } else {
      items = fileSystem.getChildren(currentPath, showHidden);
    }
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "size":
          return a.size - b.size;
        case "modified":
          return a.modifiedAt - b.modifiedAt;
        case "type": {
          const ea = a.name.split(".").pop() || "";
          const eb = b.name.split(".").pop() || "";
          return ea.localeCompare(eb);
        }
      }
    });
    return items;
  }, [currentPath, showHidden, searchQuery, isSearching, sortBy, refreshTrigger, fileSystem]);

  const navigateTo = useCallback(
    (path: string) => {
      const norm = fileSystem.normalizePath(path);
      if (fileSystem.exists(norm) && fileSystem.isDirectory(norm)) {
        setCurrentPath(norm);
        const trimmed = history.slice(0, historyIndex + 1);
        trimmed.push(norm);
        setHistory(trimmed);
        setHistoryIndex(trimmed.length - 1);
        setSearchQuery("");
        setIsSearching(false);
      }
    },
    [fileSystem, history, historyIndex],
  );

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCurrentPath(history[newIndex]);
    }
  }, [historyIndex, history]);

  const handleTap = useCallback(
    (node: FileSystemNode) => {
      const now = Date.now();
      const isDoubleTap =
        lastTapRef.current?.path === node.path &&
        now - lastTapRef.current.at < 350;

      if (node.type === "directory") {
        navigateTo(node.path);
      } else if (isDoubleTap || node.type === "file") {
        executeFilePath(node.path, fileSystem);
      }
      lastTapRef.current = { path: node.path, at: now };
    },
    [navigateTo, fileSystem],
  );

  const handleDelete = useCallback(
    (node: FileSystemNode) => {
      if (node.readOnly) return;
      fileSystem.deleteNode(node.path);
      setRefreshTrigger((n) => n + 1);
    },
    [fileSystem],
  );

  const handleCreate = useCallback(() => {
    if (!createValue.trim()) {
      setCreateError("Name cannot be empty.");
      return;
    }
    const name = createValue.trim();
    if (fileSystem.exists(`${currentPath}/${name}`)) {
      setCreateError("Item already exists.");
      return;
    }
    if (createMode === "folder") {
      fileSystem.createDirectory(currentPath, name);
    } else {
      fileSystem.createFile(currentPath, name, "");
    }
    setCreateMode(null);
    setCreateValue("");
    setCreateError("");
    setRefreshTrigger((n) => n + 1);
  }, [createMode, createValue, currentPath, fileSystem]);

  /* Breadcrumb segments */
  const pathSegments = useMemo(() => {
    if (currentPath === "/") return [{ name: "/", path: "/" }];
    const parts = currentPath.split("/").filter(Boolean);
    return [
      { name: "/", path: "/" },
      ...parts.map((part, i) => ({
        name: part,
        path: "/" + parts.slice(0, i + 1).join("/"),
      })),
    ];
  }, [currentPath]);

  const currentDirName = currentPath === "/" ? "Root" : currentPath.split("/").pop() || "/";

  return (
    <div className="h-full w-full bg-background text-foreground overflow-hidden">
      <div className="h-full flex flex-col rounded-xl border bg-card/60">
        {/* Toolbar */}
        <div className="flex items-center gap-1 p-2 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          {historyIndex > 0 && (
            <Button variant="ghost" size="icon-sm" onClick={goBack}>
              <ArrowLeft size={16} />
            </Button>
          )}
          <div className="flex-1 min-w-0">
            {isSearching ? (
              <div className="flex items-center gap-2 bg-muted/50 rounded-md px-2 py-1">
                <Search size={14} className="text-muted-foreground shrink-0" />
                <Input
                  className="h-6 border-0 bg-transparent p-0 text-sm focus-visible:ring-0 shadow-none"
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  onClick={() => {
                    setIsSearching(false);
                    setSearchQuery("");
                  }}
                >
                  <X size={14} />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1 bg-muted/50 rounded-md px-2 py-1 overflow-x-auto scrollbar-none">
                {pathSegments.map((seg, i) => (
                  <span key={seg.path} className="flex items-center shrink-0">
                    {i > 0 && (
                      <ChevronRight
                        size={12}
                        className="text-muted-foreground mx-0.5"
                      />
                    )}
                    <button
                      type="button"
                      className="hover:bg-accent rounded px-1 py-0.5 text-sm truncate max-w-[80px]"
                      onClick={() => navigateTo(seg.path)}
                    >
                      {seg.name}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <Separator orientation="vertical" className="h-6 mx-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsSearching(true)}
          >
            <Search size={16} />
          </Button>
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
          >
            {viewMode === "grid" ? <List size={16} /> : <Grid3X3 size={16} />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 z-[9600]"
            >
              <DropdownMenuItem onClick={() => setShowHidden(!showHidden)}>
                {showHidden ? "Hide hidden files" : "Show hidden files"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setCreateMode("folder");
                  setCreateValue("");
                  setCreateError("");
                }}
              >
                <FolderPlus size={14} className="mr-2" />
                New folder
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setCreateMode("file");
                  setCreateValue("");
                  setCreateError("");
                }}
              >
                <FilePlus size={14} className="mr-2" />
                New file
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setRefreshTrigger((n) => n + 1)}>
                Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Quick bookmarks bar */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border overflow-x-auto scrollbar-none bg-muted/30">
          {bookmarks.map((bm) => {
            const Icon = bm.icon;
            const isActive = currentPath === bm.path;
            return (
              <button
                key={bm.path}
                type="button"
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
                onClick={() => navigateTo(bm.path)}
              >
                <Icon size={12} />
                {bm.name}
              </button>
            );
          })}
        </div>

        {/* Create dialog */}
        {createMode && (
          <div className="px-3 py-2 border-b border-border bg-muted/30 space-y-2">
            <p className="text-xs text-muted-foreground">
              New {createMode === "folder" ? "folder" : "file"} in{" "}
              <span className="text-foreground">{currentDirName}</span>
            </p>
            <div className="flex gap-2">
              <Input
                className="flex-1 h-8 text-sm"
                placeholder={`Enter ${createMode} name…`}
                value={createValue}
                onChange={(e) => {
                  setCreateValue(e.target.value);
                  if (createError) setCreateError("");
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreateMode(null);
                    setCreateError("");
                  }
                }}
                autoFocus
              />
              <Button size="sm" onClick={handleCreate}>
                Create
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setCreateMode(null);
                  setCreateError("");
                }}
              >
                <X size={16} />
              </Button>
            </div>
            {createError && (
              <p className="text-xs text-destructive">{createError}</p>
            )}
          </div>
        )}

        {/* File list / grid */}
        <ScrollArea className="flex-1 min-h-0">
          {contents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 p-8">
              <Folder size={32} className="opacity-30" />
              <p className="text-sm">
                {isSearching ? "No results found" : "Empty folder"}
              </p>
            </div>
          ) : viewMode === "list" ? (
            <div className="min-h-full w-full">
              {contents.map((node) => (
                <MobileFileListItem
                  key={node.path}
                  node={node}
                  onTap={handleTap}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 p-4 content-start min-h-full w-full">
              {contents.map((node) => (
                <MobileFileGridItem
                  key={node.path}
                  node={node}
                  onTap={handleTap}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Status bar */}
        <div className="border-t border-border px-3 py-1 text-[11px] text-muted-foreground bg-muted/30">
          {contents.length} item{contents.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile file list item                                             */
/* ------------------------------------------------------------------ */

function MobileFileListItem({
  node,
  onTap,
  onDelete,
}: {
  node: FileSystemNode;
  onTap: (node: FileSystemNode) => void;
  onDelete: (node: FileSystemNode) => void;
}) {
  const displayName = getDisplayName(node);
  const icon = getFileIcon(node, 16);

  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-primary/10 cursor-pointer transition-all border-b border-border/50">
      <button
        type="button"
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
        onClick={() => onTap(node)}
      >
        <div className="w-5 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm truncate block">{displayName}</span>
        </div>
        <span className="text-xs text-muted-foreground text-right shrink-0 w-16">
          {node.type === "directory" ? "Folder" : humanFileSize(node.size)}
        </span>
        {node.type === "directory" && (
          <ChevronRight size={14} className="text-muted-foreground shrink-0" />
        )}
      </button>
      {!node.readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7">
              <MoreVertical size={14} className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 z-[9600]">
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(node)}
            >
              <Trash2 size={16} className="mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile file grid item                                             */
/* ------------------------------------------------------------------ */

function MobileFileGridItem({
  node,
  onTap,
  onDelete,
}: {
  node: FileSystemNode;
  onTap: (node: FileSystemNode) => void;
  onDelete: (node: FileSystemNode) => void;
}) {
  const displayName = getDisplayName(node);
  const icon = getFileIcon(node, 22);

  return (
    <button
      type="button"
      className="flex flex-col items-center gap-1 p-3 rounded-lg cursor-pointer transition-all hover:bg-primary/10 w-24"
      onClick={() => onTap(node)}
    >
      <div className="w-12 h-12 flex items-center justify-center">
        {icon}
      </div>
      <span className="text-xs text-center w-full leading-4 overflow-hidden break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
        {displayName}
      </span>
    </button>
  );
}
