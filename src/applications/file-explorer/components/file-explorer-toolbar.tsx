"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FileClipboardPayload } from "@/lib/file-clipboard";
import { readDroppedPathsFromDataTransfer } from "@/lib/file-transfer-dnd";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  ClipboardPaste,
  Eye,
  EyeOff,
  FilePlus,
  FolderPlus,
  Grid3X3,
  HardDrive,
  LayoutList,
  MoreVertical,
  RefreshCw,
  Search,
} from "lucide-react";
import { memo } from "react";

export type ViewMode = "grid" | "list";
export type SortByField = "name" | "size" | "modified" | "type";
export type SortOrder = "asc" | "desc";

/* ------------------------------------------------------------------ */
/*  Path breadcrumb segment                                           */
/* ------------------------------------------------------------------ */

export interface BreadcrumbSegment {
  name: string;
  path: string;
}

/* ------------------------------------------------------------------ */
/*  Toolbar props                                                     */
/* ------------------------------------------------------------------ */

interface FileExplorerToolbarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  currentDirectoryPath: string;
  breadcrumbSegments: BreadcrumbSegment[];
  searchQuery: string;
  viewMode: ViewMode;
  shouldShowHiddenFiles: boolean;
  isPickerMode: boolean;
  clipboard: FileClipboardPayload | null;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  onRefresh: () => void;
  onNavigateToDirectory: (path: string) => void;
  onSearchQueryChanged: (query: string) => void;
  onViewModeChanged: (mode: ViewMode) => void;
  onToggleHiddenFiles: () => void;
  onCreateFolder: () => void;
  onCreateFile: () => void;
  onPaste: () => void;
  onMovePathsToDirectory: (paths: string[], destinationPath: string) => void;
  onScheduleBreadcrumbAutoNavigate: (path: string) => void;
  onClearBreadcrumbHoverTimer: () => void;
}

const FileExplorerToolbar = memo(function FileExplorerToolbar({
  canGoBack,
  canGoForward,
  canGoUp,
  currentDirectoryPath,
  breadcrumbSegments,
  searchQuery,
  viewMode,
  shouldShowHiddenFiles,
  isPickerMode,
  clipboard,
  onGoBack,
  onGoForward,
  onGoUp,
  onRefresh,
  onNavigateToDirectory,
  onSearchQueryChanged,
  onViewModeChanged,
  onToggleHiddenFiles,
  onCreateFolder,
  onCreateFile,
  onPaste,
  onMovePathsToDirectory,
  onScheduleBreadcrumbAutoNavigate,
  onClearBreadcrumbHoverTimer,
}: FileExplorerToolbarProps) {
  return (
    <div className="flex items-center gap-1 p-2 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Navigation buttons */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onGoBack}
              disabled={!canGoBack}
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
              onClick={onGoForward}
              disabled={!canGoForward}
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
              onClick={onGoUp}
              disabled={!canGoUp}
            >
              <ArrowUp size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Go up</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onRefresh}>
              <RefreshCw size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Breadcrumb path bar */}
      <div className="flex-1 flex items-center gap-1 bg-muted/50 rounded-md px-2 py-1 min-w-0 overflow-hidden">
        <button
          onClick={() => onNavigateToDirectory("/")}
          className="hover:bg-accent rounded p-0.5 shrink-0"
          data-file-drop-zone="true"
          data-file-drop-kind="explorer-breadcrumb"
          data-file-drop-path="/"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            onScheduleBreadcrumbAutoNavigate("/");
          }}
          onDragLeave={() => {
            onClearBreadcrumbHoverTimer();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClearBreadcrumbHoverTimer();
            const droppedPaths = readDroppedPathsFromDataTransfer(
              event.dataTransfer,
            );
            if (!droppedPaths.length) return;
            onMovePathsToDirectory(droppedPaths, "/");
          }}
        >
          <HardDrive size={14} />
        </button>
        {breadcrumbSegments.map((segment) => (
          <div key={segment.path} className="flex items-center shrink-0">
            <ChevronRight size={12} className="text-muted-foreground mx-0.5" />
            <button
              onClick={() => onNavigateToDirectory(segment.path)}
              className="hover:bg-accent rounded px-1 py-0.5 text-sm truncate max-w-32"
              data-file-drop-zone="true"
              data-file-drop-kind="explorer-breadcrumb"
              data-file-drop-path={segment.path}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                onScheduleBreadcrumbAutoNavigate(segment.path);
              }}
              onDragLeave={() => {
                onClearBreadcrumbHoverTimer();
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClearBreadcrumbHoverTimer();
                const droppedPaths = readDroppedPathsFromDataTransfer(
                  event.dataTransfer,
                );
                if (!droppedPaths.length) return;
                onMovePathsToDirectory(droppedPaths, segment.path);
              }}
            >
              {segment.name}
            </button>
          </div>
        ))}
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Search input */}
      <div className="relative w-48">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={searchQuery}
          onChange={(event) => onSearchQueryChanged(event.target.value)}
          placeholder="Search..."
          className="h-7 pl-7 text-sm"
        />
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* View mode toggles */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => onViewModeChanged("grid")}
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
              onClick={() => onViewModeChanged("list")}
            >
              <LayoutList size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>List view</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={shouldShowHiddenFiles ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={onToggleHiddenFiles}
            >
              {shouldShowHiddenFiles ? <Eye size={16} /> : <EyeOff size={16} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {shouldShowHiddenFiles ? "Hide hidden files" : "Show hidden files"}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Actions overflow menu (non-picker mode only) */}
      {!isPickerMode ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <MoreVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onCreateFolder}>
              <FolderPlus size={16} className="mr-2" />
              New Folder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateFile}>
              <FilePlus size={16} className="mr-2" />
              New File
            </DropdownMenuItem>
            {clipboard ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onPaste}>
                  <ClipboardPaste size={16} className="mr-2" />
                  Paste
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
});

export default FileExplorerToolbar;
