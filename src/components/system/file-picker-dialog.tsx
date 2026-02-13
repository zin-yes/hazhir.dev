"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type FileSystemNode, useFileSystem } from "@/hooks/use-file-system";
import { getHomePath } from "@/lib/system-user";
import { cn } from "@/lib/utils";
import { ChevronRight, FolderClosed, FolderOpen, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type FilePickerSelectionMode = "file" | "directory";

export type FilePickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (node: FileSystemNode) => void;
  title?: string;
  description?: string;
  pickLabel?: string;
  selectionMode?: FilePickerSelectionMode;
  allowedExtensions?: string[];
  rootPath?: string;
  initialPath?: string;
  showHidden?: boolean;
};

function isWithinRoot(path: string, rootPath: string) {
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

export default function FilePickerDialog({
  open,
  onOpenChange,
  onPick,
  title = "Choose a file",
  description = "Select a file to continue.",
  pickLabel = "Open",
  selectionMode = "file",
  allowedExtensions,
  rootPath,
  initialPath,
  showHidden = false,
}: FilePickerDialogProps) {
  const fs = useFileSystem();
  const normalizedRoot = fs.normalizePath(rootPath ?? getHomePath());
  const [currentPath, setCurrentPath] = useState(
    fs.normalizePath(initialPath ?? normalizedRoot),
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");

  useEffect(() => {
    if (!open) return;
    const next = fs.normalizePath(initialPath ?? normalizedRoot);
    const safeStartPath =
      isWithinRoot(next, normalizedRoot) && fs.isDirectory(next)
        ? next
        : normalizedRoot;
    setCurrentPath(safeStartPath);
    setSelectedPath(null);
    setSearchValue("");
  }, [open, initialPath, normalizedRoot, fs]);

  useEffect(() => {
    if (!open) return;
    if (!fs.isDirectory(currentPath)) {
      setCurrentPath(normalizedRoot);
      setSelectedPath(null);
    }
  }, [open, currentPath, normalizedRoot, fs]);

  const extensionSet = useMemo(() => {
    const normalized = (allowedExtensions ?? []).map((ext) =>
      ext.toLowerCase().replace(/^\./, ""),
    );
    return new Set(normalized);
  }, [allowedExtensions]);

  const canShowFile = (node: FileSystemNode) => {
    if (selectionMode === "directory") return false;
    if (extensionSet.size === 0) return true;
    const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
    return extensionSet.has(ext);
  };

  const canSelectNode = (node: FileSystemNode) => {
    if (selectionMode === "directory") return node.type === "directory";
    return node.type === "file" && canShowFile(node);
  };

  const children = useMemo(() => {
    const all = fs.getChildren(currentPath, showHidden).filter((node) => {
      if (node.type === "directory") return true;
      return canShowFile(node);
    });

    const query = searchValue.trim().toLowerCase();
    if (!query) return all;
    return all.filter((node) => node.name.toLowerCase().includes(query));
  }, [
    fs,
    currentPath,
    showHidden,
    searchValue,
    selectionMode,
    allowedExtensions,
  ]);

  const breadcrumbs = useMemo(() => {
    const segments = currentPath.split("/").filter(Boolean);
    const paths: { label: string; path: string }[] = [
      {
        label:
          normalizedRoot === "/" ? "/" : normalizedRoot.split("/").pop() || "/",
        path: normalizedRoot,
      },
    ];

    let cursor = normalizedRoot;
    const rootSegments = normalizedRoot.split("/").filter(Boolean);
    const extraSegments = segments.slice(rootSegments.length);

    for (const segment of extraSegments) {
      cursor = fs.normalizePath(`${cursor}/${segment}`);
      paths.push({ label: segment, path: cursor });
    }

    return paths;
  }, [currentPath, normalizedRoot, fs]);

  const selectedNode = selectedPath ? fs.getNode(selectedPath) : undefined;
  const canPick = Boolean(selectedNode && canSelectNode(selectedNode));

  const goUp = () => {
    if (currentPath === normalizedRoot) return;
    const parent = fs.getParentPath(currentPath);
    setCurrentPath(
      isWithinRoot(parent, normalizedRoot) ? parent : normalizedRoot,
    );
    setSelectedPath(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 border-b border-border/60 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={goUp}>
            Up
          </Button>

          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
            {breadcrumbs.map((crumb, index) => (
              <div key={crumb.path} className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentPath(crumb.path);
                    setSelectedPath(null);
                  }}
                  className="max-w-[160px] truncate rounded px-1 text-xs text-foreground/85 hover:bg-accent"
                >
                  {crumb.label}
                </button>
                {index < breadcrumbs.length - 1 ? (
                  <ChevronRight className="size-3 text-muted-foreground" />
                ) : null}
              </div>
            ))}
          </div>

          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              className="h-8 pl-7 text-xs"
              placeholder="Filter current folder"
            />
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-3">
          <ul className="space-y-1">
            {children.map((node) => {
              const isSelected = selectedPath === node.path;
              const selectable = canSelectNode(node);

              return (
                <li key={node.path}>
                  <button
                    type="button"
                    onClick={() => {
                      if (node.type === "directory") {
                        if (selectionMode === "directory") {
                          setSelectedPath(node.path);
                        } else {
                          setCurrentPath(node.path);
                          setSelectedPath(null);
                        }
                        return;
                      }
                      if (selectable) {
                        setSelectedPath(node.path);
                      }
                    }}
                    onDoubleClick={() => {
                      if (node.type === "directory") {
                        setCurrentPath(node.path);
                        setSelectedPath(null);
                        return;
                      }
                      if (selectable) {
                        onPick(node);
                        onOpenChange(false);
                      }
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                      isSelected
                        ? "border-primary/40 bg-primary/10"
                        : "border-transparent hover:border-border/60 hover:bg-muted/30",
                      !selectable && node.type === "file" && "opacity-60",
                    )}
                  >
                    {node.type === "directory" ? (
                      isSelected ? (
                        <FolderOpen className="size-4 text-blue-300" />
                      ) : (
                        <FolderClosed className="size-4 text-blue-300" />
                      )
                    ) : (
                      <span className="inline-block size-4 rounded-sm border border-border/60 bg-muted/50" />
                    )}
                    <span className="truncate text-sm">{node.name}</span>
                    {node.type === "directory" ? (
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        folder
                      </span>
                    ) : !selectable ? (
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        unavailable
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {children.length === 0 ? (
              <li className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing to show here.
              </li>
            ) : null}
          </ul>
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!selectedNode || !canSelectNode(selectedNode)) return;
              onPick(selectedNode);
              onOpenChange(false);
            }}
            disabled={!canPick}
          >
            {pickLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
