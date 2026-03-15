"use client";

import {
  getDisplayName,
  getFileIcon,
} from "@/applications/file-explorer/lib/file-explorer-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { FileSystemNode, useFileSystem } from "@/hooks/use-file-system";
import { readDroppedPathsFromDataTransfer } from "@/lib/file-transfer-dnd";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, FolderOpen, HardDrive } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Sidebar bookmark type                                             */
/* ------------------------------------------------------------------ */

export interface SidebarBookmark {
  name: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

/* ------------------------------------------------------------------ */
/*  Directory tree item (recursive)                                   */
/* ------------------------------------------------------------------ */

interface DirectoryTreeItemProps {
  node: FileSystemNode;
  indentationLevel: number;
  currentDirectoryPath: string;
  onNavigateToDirectory: (path: string) => void;
  onOpenFile: (node: FileSystemNode) => void;
  shouldShowHiddenFiles: boolean;
  onDropPathsToDirectory: (
    paths: string[],
    destinationDirectoryPath: string,
  ) => void;
}

function DirectoryTreeItem({
  node,
  indentationLevel,
  currentDirectoryPath,
  onNavigateToDirectory,
  onOpenFile,
  shouldShowHiddenFiles,
  onDropPathsToDirectory,
}: DirectoryTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const fileSystem = useFileSystem();
  const autoExpandTimerReference = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const childNodes = useMemo(() => {
    if (!isExpanded) return [];
    return fileSystem.getChildren(node.path, shouldShowHiddenFiles);
  }, [isExpanded, node.path, shouldShowHiddenFiles]);

  const isActiveDirectory = currentDirectoryPath === node.path;

  useEffect(() => {
    return () => {
      if (autoExpandTimerReference.current) {
        clearTimeout(autoExpandTimerReference.current);
        autoExpandTimerReference.current = null;
      }
    };
  }, []);

  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimerReference.current) {
      clearTimeout(autoExpandTimerReference.current);
      autoExpandTimerReference.current = null;
    }
  }, []);

  const scheduleAutoExpandOnDragHover = useCallback(() => {
    if (isExpanded || autoExpandTimerReference.current) return;
    autoExpandTimerReference.current = setTimeout(() => {
      setIsExpanded(true);
      autoExpandTimerReference.current = null;
    }, 1000);
  }, [isExpanded]);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-accent/50 rounded-md text-sm",
          isActiveDirectory && "bg-accent text-accent-foreground",
        )}
        data-file-drop-zone="true"
        data-file-drop-kind="directory"
        data-file-drop-path={node.path}
        style={{ paddingLeft: `${indentationLevel * 12 + 8}px` }}
        onClick={() => onNavigateToDirectory(node.path)}
        onDragEnter={(event) => {
          event.preventDefault();
          scheduleAutoExpandOnDragHover();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          scheduleAutoExpandOnDragHover();
        }}
        onDragLeave={() => {
          clearAutoExpandTimer();
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          clearAutoExpandTimer();
          const droppedPaths = readDroppedPathsFromDataTransfer(
            event.dataTransfer,
          );
          if (!droppedPaths.length) return;
          onDropPathsToDirectory(droppedPaths, node.path);
        }}
      >
        <button
          className="p-0.5 hover:bg-accent rounded"
          onClick={(event) => {
            event.stopPropagation();
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
          getFileIcon(node, 16)
        )}
        <span className="truncate">{getDisplayName(node)}</span>
      </div>
      {isExpanded &&
        childNodes.map((childNode) => {
          if (childNode.type === "directory") {
            return (
              <DirectoryTreeItem
                key={childNode.path}
                node={childNode}
                indentationLevel={indentationLevel + 1}
                currentDirectoryPath={currentDirectoryPath}
                onNavigateToDirectory={onNavigateToDirectory}
                onOpenFile={onOpenFile}
                shouldShowHiddenFiles={shouldShowHiddenFiles}
                onDropPathsToDirectory={onDropPathsToDirectory}
              />
            );
          }

          return (
            <div
              key={childNode.path}
              className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-accent/50 rounded-md text-sm"
              style={{
                paddingLeft: `${(indentationLevel + 1) * 12 + 8}px`,
              }}
              onClick={() => onOpenFile(childNode)}
            >
              <span className="w-[15px] shrink-0" />
              {getFileIcon(childNode, 16)}
              <span className="truncate">{getDisplayName(childNode)}</span>
            </div>
          );
        })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar panel                                                     */
/* ------------------------------------------------------------------ */

interface FileExplorerSidebarProps {
  bookmarks: SidebarBookmark[];
  currentDirectoryPath: string;
  rootDirectories: FileSystemNode[];
  shouldShowHiddenFiles: boolean;
  isPickerMode: boolean;
  pickerRootPath: string;
  onNavigateToDirectory: (path: string) => void;
  onOpenFile: (node: FileSystemNode) => void;
  onDropPathsToDirectory: (
    paths: string[],
    destinationDirectoryPath: string,
  ) => void;
}

const FileExplorerSidebar = memo(function FileExplorerSidebar({
  bookmarks,
  currentDirectoryPath,
  rootDirectories,
  shouldShowHiddenFiles,
  isPickerMode,
  pickerRootPath,
  onNavigateToDirectory,
  onOpenFile,
  onDropPathsToDirectory,
}: FileExplorerSidebarProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-2">
        {/* Quick-access bookmark list */}
        <div className="mb-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase px-2 mb-2">
            Places
          </div>
          {bookmarks.map((bookmark) => {
            const BookmarkIcon = bookmark.icon;
            return (
              <button
                key={bookmark.path}
                onClick={() => onNavigateToDirectory(bookmark.path)}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent/50 transition-colors",
                  currentDirectoryPath === bookmark.path &&
                    "bg-accent text-accent-foreground",
                )}
              >
                <BookmarkIcon size={16} className="shrink-0" />
                <span className="truncate">{bookmark.name}</span>
              </button>
            );
          })}
        </div>

        <Separator className="my-2" />

        {/* Full file system tree */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase px-2 mb-2">
            File System
          </div>
          <button
            onClick={() =>
              onNavigateToDirectory(isPickerMode ? pickerRootPath : "/")
            }
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1 rounded-md text-sm hover:bg-accent/50",
              currentDirectoryPath === (isPickerMode ? pickerRootPath : "/") &&
                "bg-accent text-accent-foreground",
            )}
          >
            <HardDrive size={16} className="text-muted-foreground" />
            <span>{isPickerMode ? pickerRootPath : "/"}</span>
          </button>
          {rootDirectories.map((directory) => (
            <DirectoryTreeItem
              key={directory.path}
              node={directory}
              indentationLevel={1}
              currentDirectoryPath={currentDirectoryPath}
              onNavigateToDirectory={onNavigateToDirectory}
              onOpenFile={onOpenFile}
              shouldShowHiddenFiles={shouldShowHiddenFiles}
              onDropPathsToDirectory={onDropPathsToDirectory}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
});

export default FileExplorerSidebar;
