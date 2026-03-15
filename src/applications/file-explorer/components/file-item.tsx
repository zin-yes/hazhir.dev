"use client";

import {
  formatRelativeDate,
  getDisplayName,
  getFileIcon,
  humanReadableFileSize,
  isTextEditableFile,
} from "@/applications/file-explorer/lib/file-explorer-utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { FileSystemNode } from "@/hooks/use-file-system";
import { cn } from "@/lib/utils";
import {
  Copy,
  Edit3,
  Eye,
  FileText,
  Scissors,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { memo } from "react";

/* ------------------------------------------------------------------ */
/*  Shared props interface for both grid and list item variants        */
/* ------------------------------------------------------------------ */

export interface FileItemProps {
  node: FileSystemNode;
  isSelected: boolean;
  /** When true the item is hidden because it is being dragged via touch */
  isDragHidden?: boolean;
  onSelect: (
    path: string,
    event:
      | React.MouseEvent<HTMLDivElement>
      | React.PointerEvent<HTMLDivElement>,
  ) => void;
  onOpen: (node: FileSystemNode) => void;
  onTouchPointerDown: (
    node: FileSystemNode,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onOpenInEditor: (node: FileSystemNode) => void;
  onViewProperties: (node: FileSystemNode) => void;
  onOpenTerminalHere: (node: FileSystemNode) => void;
  onDragStartItem: (
    node: FileSystemNode,
    event: React.DragEvent<HTMLDivElement>,
  ) => void;
  onDragEndItem: () => void;
  onDropOnDirectory: (
    directoryPath: string,
    event: React.DragEvent<HTMLDivElement>,
  ) => void;
  onRename: (node: FileSystemNode) => void;
  onDelete: (node: FileSystemNode) => void;
  onCopy: (node: FileSystemNode) => void;
  onCut: (node: FileSystemNode) => void;
  onContextSelect: (
    path: string,
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  onItemRef: (path: string, element: HTMLDivElement | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Shared context menu rendered identically for both variants         */
/* ------------------------------------------------------------------ */

function FileItemContextMenuContent({
  node,
  onOpen,
  onOpenInEditor,
  onOpenTerminalHere,
  onCut,
  onCopy,
  onRename,
  onDelete,
  onViewProperties,
}: Pick<
  FileItemProps,
  | "node"
  | "onOpen"
  | "onOpenInEditor"
  | "onOpenTerminalHere"
  | "onCut"
  | "onCopy"
  | "onRename"
  | "onDelete"
  | "onViewProperties"
>) {
  const canOpenInTextEditor = isTextEditableFile(node);

  return (
    <ContextMenuContent className="w-48">
      <ContextMenuItem onClick={() => onOpen(node)}>
        <Eye size={16} className="mr-2" />
        Open
      </ContextMenuItem>
      {canOpenInTextEditor ? (
        <ContextMenuItem onClick={() => onOpenInEditor(node)}>
          <Edit3 size={16} className="mr-2" />
          Open in Text Editor
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onClick={() => onOpenTerminalHere(node)}>
        <TerminalSquare size={16} className="mr-2" />
        Open Terminal Here
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => onCut(node)}
        disabled={node.type === "file" && Boolean(node.readOnly)}
      >
        <Scissors size={16} className="mr-2" />
        Cut
        <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => onCopy(node)}
        disabled={node.type === "file" && Boolean(node.readOnly)}
      >
        <Copy size={16} className="mr-2" />
        Copy
        <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => onRename(node)}
        disabled={Boolean(node.readOnly)}
      >
        <Edit3 size={16} className="mr-2" />
        Rename
        <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => onDelete(node)}
        disabled={Boolean(node.readOnly)}
        className="text-destructive"
      >
        <Trash2 size={16} className="mr-2" />
        Delete
        <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onViewProperties(node)}>
        <FileText size={16} className="mr-2" />
        Properties
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/* ------------------------------------------------------------------ */
/*  Grid view file item                                               */
/* ------------------------------------------------------------------ */

export const FileGridItem = memo(function FileGridItem({
  node,
  isSelected,
  isDragHidden = false,
  onSelect,
  onOpen,
  onTouchPointerDown,
  onOpenInEditor,
  onViewProperties,
  onOpenTerminalHere,
  onDragStartItem,
  onDragEndItem,
  onDropOnDirectory,
  onRename,
  onDelete,
  onCopy,
  onCut,
  onContextSelect,
  onItemRef,
}: FileItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={(elementReference) => onItemRef(node.path, elementReference)}
          data-file-item="true"
          data-file-hit="true"
          data-file-drop-zone={node.type === "directory" ? "true" : undefined}
          data-file-drop-kind={
            node.type === "directory" ? "directory" : undefined
          }
          data-file-drop-path={
            node.type === "directory" ? node.path : undefined
          }
          draggable
          className={cn(
            "flex flex-col items-center gap-1 p-3 rounded-lg cursor-pointer transition-all",
            "hover:bg-primary/10 w-24",
            isSelected && "bg-primary/10 ring-2 ring-primary/40",
          )}
          style={{ visibility: isDragHidden ? "hidden" : "visible" }}
          onDragStart={(event) => onDragStartItem(node, event)}
          onDragEnd={onDragEndItem}
          onDragOver={(event) => {
            if (node.type === "directory") {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => {
            if (node.type === "directory") {
              onDropOnDirectory(node.path, event);
            }
          }}
          onPointerDown={(pointerEvent) => {
            pointerEvent.stopPropagation();
            onSelect(node.path, pointerEvent);
            onTouchPointerDown(node, pointerEvent);
          }}
          onContextMenu={(contextMenuEvent) => {
            onContextSelect(node.path, contextMenuEvent);
          }}
          onDoubleClick={() => onOpen(node)}
        >
          <div
            data-file-icon="true"
            className="w-12 h-12 flex items-center justify-center"
          >
            {getFileIcon(node, 40)}
          </div>
          <span
            className="text-xs text-center w-full leading-4 overflow-hidden break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
            title={getDisplayName(node)}
          >
            {getDisplayName(node)}
          </span>
        </div>
      </ContextMenuTrigger>
      <FileItemContextMenuContent
        node={node}
        onOpen={onOpen}
        onOpenInEditor={onOpenInEditor}
        onOpenTerminalHere={onOpenTerminalHere}
        onCut={onCut}
        onCopy={onCopy}
        onRename={onRename}
        onDelete={onDelete}
        onViewProperties={onViewProperties}
      />
    </ContextMenu>
  );
});

/* ------------------------------------------------------------------ */
/*  List view file item                                               */
/* ------------------------------------------------------------------ */

export const FileListItem = memo(function FileListItem({
  node,
  isSelected,
  isDragHidden = false,
  onSelect,
  onOpen,
  onTouchPointerDown,
  onOpenInEditor,
  onViewProperties,
  onOpenTerminalHere,
  onDragStartItem,
  onDragEndItem,
  onDropOnDirectory,
  onRename,
  onDelete,
  onCopy,
  onCut,
  onContextSelect,
  onItemRef,
}: FileItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={(elementReference) => onItemRef(node.path, elementReference)}
          data-file-item="true"
          data-file-hit="true"
          data-file-drop-zone={node.type === "directory" ? "true" : undefined}
          data-file-drop-kind={
            node.type === "directory" ? "directory" : undefined
          }
          data-file-drop-path={
            node.type === "directory" ? node.path : undefined
          }
          draggable
          className={cn(
            "flex items-center gap-3 px-3 py-2 hover:bg-primary/10 cursor-pointer transition-all border-b border-border/50",
            isSelected && "bg-primary/10",
          )}
          style={{ visibility: isDragHidden ? "hidden" : "visible" }}
          onDragStart={(event) => onDragStartItem(node, event)}
          onDragEnd={onDragEndItem}
          onDragOver={(event) => {
            if (node.type === "directory") {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => {
            if (node.type === "directory") {
              onDropOnDirectory(node.path, event);
            }
          }}
          onPointerDown={(pointerEvent) => {
            pointerEvent.stopPropagation();
            onSelect(node.path, pointerEvent);
            onTouchPointerDown(node, pointerEvent);
          }}
          onContextMenu={(contextMenuEvent) => {
            onContextSelect(node.path, contextMenuEvent);
          }}
          onDoubleClick={() => onOpen(node)}
        >
          <div
            data-file-icon="true"
            className="w-5 flex items-center justify-center shrink-0"
          >
            {getFileIcon(node, 18)}
          </div>
          <div className="flex-1 min-w-0">
            <span
              className="text-sm truncate block"
              title={getDisplayName(node)}
            >
              {getDisplayName(node)}
            </span>
          </div>
          <div className="w-20 text-xs text-muted-foreground text-right shrink-0">
            {node.type === "file" ? humanReadableFileSize(node.size) : "--"}
          </div>
          <div className="w-24 text-xs text-muted-foreground text-right shrink-0">
            {formatRelativeDate(node.modifiedAt)}
          </div>
          <div className="w-24 text-xs text-muted-foreground font-mono shrink-0">
            {node.permissions}
          </div>
        </div>
      </ContextMenuTrigger>
      <FileItemContextMenuContent
        node={node}
        onOpen={onOpen}
        onOpenInEditor={onOpenInEditor}
        onOpenTerminalHere={onOpenTerminalHere}
        onCut={onCut}
        onCopy={onCopy}
        onRename={onRename}
        onDelete={onDelete}
        onViewProperties={onViewProperties}
      />
    </ContextMenu>
  );
});
