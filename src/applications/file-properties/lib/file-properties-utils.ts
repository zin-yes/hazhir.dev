/**
 * Utility functions for the file properties application.
 * Handles storage size calculations, formatting, and filesystem traversal.
 */

import { type FileSystemNode, useFileSystem } from "@/hooks/use-file-system";

/** File extensions recognized as text-based content for character/line counts */
export const TEXT_EXTENSIONS = new Set([
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

/** Estimates the localStorage byte cost for a UTF-16 encoded string */
export function getUtf16StorageBytes(value: string): number {
  return value.length * 2;
}

/** Formats a byte count into a human-readable string (e.g. "1.25 MB") */
export function formatBytes(bytes: number): string {
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

/** Converts a Unix timestamp into a locale-formatted date string */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/** Counts the number of lines in a text string */
export function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

/**
 * Recursively collects all descendant filesystem nodes under a given path.
 * Uses breadth-first traversal to enumerate subdirectories and their contents.
 */
export function collectDescendants(
  path: string,
  fileSystem: ReturnType<typeof useFileSystem>,
): FileSystemNode[] {
  const allDescendants: FileSystemNode[] = [];
  const queue: string[] = [path];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) continue;

    const children = fileSystem.getChildren(currentPath, true);
    children.forEach((child) => {
      allDescendants.push(child);
      if (child.type === "directory") {
        queue.push(child.path);
      }
    });
  }

  return allDescendants;
}
