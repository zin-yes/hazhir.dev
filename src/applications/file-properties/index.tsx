"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { type FileSystemNode, useFileSystem } from "@/hooks/use-file-system";
import { isImageFileName } from "@/lib/image-files";
import { cn } from "@/lib/utils";
import { FileImage, FileText, Folder, HardDrive, Lock, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const FILE_SYSTEM_STORAGE_KEY = "filesystem_v6";

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "document",
  "doc",
  "docx",
  "pdf",
  "js",
  "ts",
  "jsx",
  "tsx",
  "json",
  "css",
  "html",
  "xml",
  "yml",
  "yaml",
  "toml",
  "sh",
  "bash",
  "shortcut",
  "app",
]);

function getUtf16StorageBytes(value: string): number {
  return value.length * 2;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function collectDescendants(path: string, fs: ReturnType<typeof useFileSystem>): FileSystemNode[] {
  const all: FileSystemNode[] = [];
  const queue: string[] = [path];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) continue;

    const children = fs.getChildren(currentPath, true);
    children.forEach((child) => {
      all.push(child);
      if (child.type === "directory") {
        queue.push(child.path);
      }
    });
  }

  return all;
}

export default function FilePropertiesApplication({ filePath }: { filePath?: string }) {
  const fs = useFileSystem();
  const [storageVersion, setStorageVersion] = useState(0);
  const [imageResolution, setImageResolution] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const handleStorage = () => setStorageVersion((current) => current + 1);
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const normalizedPath = useMemo(() => {
    if (!filePath) return "";
    return fs.normalizePath(filePath);
  }, [filePath, fs]);

  const metadata = useMemo(() => {
    void storageVersion;

    if (!normalizedPath) {
      return null;
    }

    const node = fs.getNode(normalizedPath);
    if (!node) {
      return null;
    }

    const descendants =
      node.type === "directory" ? collectDescendants(node.path, fs) : [];
    const directChildren =
      node.type === "directory" ? fs.getChildren(node.path, true) : [];

    const localStorageValue = window.localStorage.getItem(FILE_SYSTEM_STORAGE_KEY) ?? "[]";
    const totalStorageBytes = getUtf16StorageBytes(localStorageValue);

    let subtreeNodes: FileSystemNode[] = [node];
    try {
      const parsed = JSON.parse(localStorageValue) as FileSystemNode[];
      subtreeNodes = parsed.filter((entry) => {
        if (entry.path === node.path) return true;
        return node.type === "directory" && entry.path.startsWith(`${node.path}/`);
      });
      if (subtreeNodes.length === 0) {
        subtreeNodes = [node];
      }
    } catch {
      subtreeNodes = [node, ...descendants];
    }

    const subtreeSerialized = JSON.stringify(subtreeNodes);
    const subtreeStorageBytes = getUtf16StorageBytes(subtreeSerialized);

    const extension = node.type === "file" ? node.name.split(".").pop()?.toLowerCase() ?? "" : "";
    const textContent = node.type === "file" ? fs.getFileContents(node.path) ?? "" : "";
    const isTextFile = node.type === "file" && TEXT_EXTENSIONS.has(extension);

    return {
      node,
      extension,
      descendants,
      directChildren,
      textContent,
      isTextFile,
      subtreeStorageBytes,
      totalStorageBytes,
    };
  }, [fs, normalizedPath, storageVersion]);

  useEffect(() => {
    setImageResolution(null);
    if (!metadata?.node || metadata.node.type !== "file") return;
    if (!isImageFileName(metadata.node.name)) return;

    const source = (metadata.node.contents ?? "").trim();
    if (!source) return;

    const image = new window.Image();
    image.onload = () => {
      setImageResolution({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      setImageResolution(null);
    };
    image.src = source;
  }, [metadata?.node]);

  if (!filePath) {
    return (
      <div className="h-full w-full p-2 bg-background">
        <div className="h-full w-full rounded-lg border border-border bg-card p-3 flex items-center justify-center text-xs text-muted-foreground">
          No file selected.
        </div>
      </div>
    );
  }

  if (!metadata?.node) {
    return (
      <div className="h-full w-full p-2 bg-background">
        <div className="h-full w-full rounded-lg border border-border bg-card p-3 flex items-center justify-center text-xs text-muted-foreground">
          This item could not be found.
        </div>
      </div>
    );
  }

  const { node, directChildren, descendants, textContent, isTextFile } = metadata;
  const fileCount = descendants.filter((entry) => entry.type === "file").length;
  const directoryCount = descendants.filter((entry) => entry.type === "directory").length;

  return (
    <div className="h-full w-full bg-background p-2">
      <ScrollArea className="h-full rounded-lg border border-border bg-card">
        <div className="p-3 space-y-3">
          <div>
            <div className="text-base font-semibold text-foreground truncate">{node.name}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{node.type === "directory" ? "Folder" : "File"}</div>
          </div>

          <Separator />

          <section className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Details</div>
            <div className="grid grid-cols-1 gap-2 text-xs">
              <InfoRow icon={<Folder size={14} />} label="Type" value={node.type === "directory" ? "Directory" : "File"} />
              <InfoRow icon={<HardDrive size={14} />} label="Path" value={node.path} mono />
              <InfoRow icon={<Lock size={14} />} label="Permissions" value={node.permissions} mono />
              <InfoRow icon={<User size={14} />} label="Owner / Group" value={`${node.owner}:${node.group}`} mono />
              <InfoRow label="Created" value={formatDate(node.createdAt)} />
              <InfoRow label="Modified" value={formatDate(node.modifiedAt)} />
              <InfoRow label="Filesystem size" value={formatBytes(node.size)} />
              <InfoRow
                label="LocalStorage usage"
                value={`${formatBytes(metadata.subtreeStorageBytes)} (${metadata.subtreeStorageBytes.toLocaleString()} bytes)`}
              />
            </div>
          </section>

          {node.type === "directory" ? (
            <>
              <Separator />
              <section className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Folder Stats</div>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <InfoRow label="Items in this folder" value={`${directChildren.length}`} />
                  <InfoRow label="Items in subtree" value={`${descendants.length}`} />
                  <InfoRow label="Files in subtree" value={`${fileCount}`} />
                  <InfoRow label="Folders in subtree" value={`${directoryCount}`} />
                </div>
              </section>
            </>
          ) : null}

          {node.type === "file" && isImageFileName(node.name) ? (
            <>
              <Separator />
              <section className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Image</div>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <InfoRow
                    icon={<FileImage size={14} />}
                    label="Resolution"
                    value={
                      imageResolution
                        ? `${imageResolution.width} × ${imageResolution.height}`
                        : "Unavailable"
                    }
                  />
                  <InfoRow label="Extension" value={metadata.extension || "None"} mono />
                </div>
              </section>
            </>
          ) : null}

          {node.type === "file" && isTextFile ? (
            <>
              <Separator />
              <section className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Text</div>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <InfoRow icon={<FileText size={14} />} label="Characters" value={textContent.length.toLocaleString()} />
                  <InfoRow label="Lines" value={countLines(textContent).toLocaleString()} />
                </div>
              </section>
            </>
          ) : null}

          <Separator />

          <section className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Storage Context</div>
            <div className="grid grid-cols-1 gap-2 text-xs">
              <InfoRow
                label="Total filesystem localStorage"
                value={`${formatBytes(metadata.totalStorageBytes)} (${metadata.totalStorageBytes.toLocaleString()} bytes)`}
              />
              <InfoRow
                label="Read-only"
                value={node.readOnly ? "Yes" : "No"}
              />
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function InfoRow({
  label,
  value,
  icon,
  mono,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-background/50 px-2.5 py-2">
      <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        {icon ? <span className="inline-flex">{icon}</span> : null}
        <span>{label}</span>
      </div>
      <div className={cn("mt-0.5 text-xs text-foreground break-words", mono && "font-mono text-[11px]")}>{value}</div>
    </div>
  );
}
