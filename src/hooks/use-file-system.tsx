"use client";

import { buildDefaultFileSystem } from "@/config/system-file-system";
import { getImagesDirectoryPath } from "@/lib/image-files";
import { getCurrentSystemUsername, getHomePath } from "@/lib/system-user";

export type FileSystemNodeType = "file" | "directory";

export interface FileSystemNode {
  name: string;
  type: FileSystemNodeType;
  path: string;
  parentPath: string;
  contents?: string;
  permissions: string;
  owner: string;
  group: string;
  size: number;
  createdAt: number;
  modifiedAt: number;
  isHidden: boolean;
  readOnly?: boolean;
  executable?: boolean;
  system?: boolean;
}

export interface FileSystemDirectory extends FileSystemNode {
  type: "directory";
}

export interface FileSystemFile extends FileSystemNode {
  type: "file";
  contents: string;
  mimeType?: string;
}

const STORAGE_KEY_PREFIX = "filesystem_v6";

/**
 * Returns the per-user localStorage key for filesystem data.
 * Each user (including "guest") gets an isolated filesystem.
 */
export function getFileSystemStorageKey(username: string): string {
  return `${STORAGE_KEY_PREFIX}_${username}`;
}

export function useFileSystem() {
  function normalizePath(path: string): string {
    const raw = (path || "").replace(/\/+/g, "/");
    const absolute = raw.startsWith("/") ? raw : `/${raw}`;
    const segments = absolute.split("/");
    const resolved: string[] = [];

    for (const segment of segments) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        if (resolved.length > 0) resolved.pop();
        continue;
      }
      resolved.push(segment);
    }

    return resolved.length === 0 ? "/" : `/${resolved.join("/")}`;
  }

  /**
   * Ensures only truly system-protected files exist in the filesystem.
   * Protected files are: /applications/*.app executables and ~/Images/* wallpapers.
   * User-editable files (shortcuts, documents, etc.) are NEVER re-added here.
   */
  function ensureSystemFilesExist(
    nodes: FileSystemNode[],
    username: string,
  ): FileSystemNode[] {
    const defaults = buildDefaultFileSystem(username);
    const existingPaths = new Set(nodes.map((n) => normalizePath(n.path)));
    const imagesPath = normalizePath(
      getImagesDirectoryPath(`/home/${username}`),
    );

    const missingSystemFiles = defaults.filter((defaultNode) => {
      const path = normalizePath(defaultNode.path);
      if (existingPaths.has(path)) return false;

      // Always ensure /applications directory and its .app executables
      if (path === "/applications") return true;
      if (
        path.startsWith("/applications/") &&
        defaultNode.type === "file" &&
        Boolean(defaultNode.executable)
      )
        return true;

      // Always ensure ~/Images directory and its wallpaper images
      if (path === imagesPath) return true;
      if (
        path.startsWith(`${imagesPath}/`) &&
        defaultNode.type === "file" &&
        Boolean(defaultNode.readOnly)
      )
        return true;

      return false;
    });

    if (missingSystemFiles.length === 0) return nodes;
    return [...nodes, ...missingSystemFiles];
  }

  function getFileSystem(): FileSystemNode[] {
    if (typeof window === "undefined") {
      return buildDefaultFileSystem("guest");
    }

    const username = getCurrentSystemUsername();
    const storageKey = getFileSystemStorageKey(username);
    const stored = window.localStorage.getItem(storageKey);

    // First time for this user - initialize with full default filesystem
    if (!stored) {
      const defaults = buildDefaultFileSystem(username);
      window.localStorage.setItem(storageKey, JSON.stringify(defaults));
      return defaults;
    }

    const nodes = JSON.parse(stored) as FileSystemNode[];

    // Only ensure system-protected files (app executables + wallpapers) exist.
    // User-editable files are never auto-regenerated.
    const patched = ensureSystemFilesExist(nodes, username);
    if (patched !== nodes) {
      window.localStorage.setItem(storageKey, JSON.stringify(patched));
    }

    return patched;
  }

  function saveFileSystem(nodes: FileSystemNode[]) {
    const username = getCurrentSystemUsername();
    const storageKey = getFileSystemStorageKey(username);
    window.localStorage.setItem(storageKey, JSON.stringify(nodes));
    window.dispatchEvent(new Event("storage"));
  }

  function isNodeReadOnly(path: string): boolean {
    const normalized = normalizePath(path);
    const node = getNode(normalized);
    if (node?.readOnly) return true;
    return false;
  }

  function hasReadOnlyDescendant(path: string): boolean {
    const normalized = normalizePath(path);
    return getFileSystem().some(
      (node) =>
        node.path.startsWith(`${normalized}/`) && Boolean(node.readOnly),
    );
  }

  function canWriteToDirectory(path: string): boolean {
    const normalized = normalizePath(path);
    const node = getNode(path);
    if (!node || node.type !== "directory") return false;
    if (node.readOnly) {
      return false;
    }
    return true;
  }

  function getParentPath(path: string): string {
    const normalized = normalizePath(path);
    if (normalized === "/") return "/";
    const parts = normalized.split("/").filter(Boolean);
    parts.pop();
    return parts.length === 0 ? "/" : "/" + parts.join("/");
  }

  function getNodeName(path: string): string {
    const normalized = normalizePath(path);
    if (normalized === "/") return "/";
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || "/";
  }

  function getNode(path: string): FileSystemNode | undefined {
    const normalized = normalizePath(path);
    if (normalized === "/") {
      // Return a virtual root directory
      return {
        name: "/",
        type: "directory",
        path: "/",
        parentPath: "/",
        permissions: "rwxr-xr-x",
        owner: "root",
        group: "root",
        size: 4096,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        isHidden: false,
      };
    }
    return getFileSystem().find((node) => node.path === normalized);
  }

  function getChildren(path: string, showHidden = false): FileSystemNode[] {
    const normalized = normalizePath(path);
    const fs = getFileSystem();
    return fs
      .filter((node) => {
        const matches = node.parentPath === normalized;
        if (!showHidden && node.isHidden) return false;
        return matches;
      })
      .sort((a, b) => {
        // Directories first, then alphabetically
        if (a.type === "directory" && b.type === "file") return -1;
        if (a.type === "file" && b.type === "directory") return 1;
        return a.name.localeCompare(b.name);
      });
  }

  function getAllDirectories(): FileSystemNode[] {
    return getFileSystem().filter((node) => node.type === "directory");
  }

  function exists(path: string): boolean {
    const normalized = normalizePath(path);
    if (normalized === "/") return true;
    return getFileSystem().some((node) => node.path === normalized);
  }

  function isDirectory(path: string): boolean {
    const normalized = normalizePath(path);
    if (normalized === "/") return true;
    const node = getNode(normalized);
    return node?.type === "directory";
  }

  function createDirectory(path: string, name: string): boolean {
    const parentPath = normalizePath(path);
    const fullPath = normalizePath(`${parentPath}/${name}`);

    if (exists(fullPath)) return false;
    if (!exists(parentPath) && parentPath !== "/") return false;
    if (!canWriteToDirectory(parentPath)) return false;

    const username = getCurrentSystemUsername();

    const fs = getFileSystem();
    fs.push({
      name,
      type: "directory",
      path: fullPath,
      parentPath,
      permissions: "rwxr-xr-x",
      owner: username,
      group: username,
      size: 4096,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      isHidden: name.startsWith("."),
    });
    saveFileSystem(fs);
    return true;
  }

  function createFile(
    path: string,
    name: string,
    contents: string = "",
  ): boolean {
    const parentPath = normalizePath(path);
    const fullPath = normalizePath(`${parentPath}/${name}`);

    if (exists(fullPath)) return false;
    if (!exists(parentPath) && parentPath !== "/") return false;
    if (!canWriteToDirectory(parentPath)) return false;

    const username = getCurrentSystemUsername();

    const fs = getFileSystem();
    fs.push({
      name,
      type: "file",
      path: fullPath,
      parentPath,
      contents,
      permissions: "rw-r--r--",
      owner: username,
      group: username,
      size: new Blob([contents]).size,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      isHidden: name.startsWith("."),
    });
    saveFileSystem(fs);
    return true;
  }

  function updateFile(path: string, contents: string): boolean {
    const normalized = normalizePath(path);
    if (isNodeReadOnly(normalized)) return false;

    const fs = getFileSystem();
    const index = fs.findIndex(
      (node) => node.path === normalized && node.type === "file",
    );

    if (index === -1) return false;

    fs[index] = {
      ...fs[index],
      contents,
      size: new Blob([contents]).size,
      modifiedAt: Date.now(),
    };
    saveFileSystem(fs);
    return true;
  }

  function rename(path: string, newName: string): boolean {
    const normalized = normalizePath(path);
    if (isNodeReadOnly(normalized)) return false;

    const fs = getFileSystem();
    const index = fs.findIndex((node) => node.path === normalized);

    if (index === -1) return false;

    const node = fs[index];
    const newPath = normalizePath(`${node.parentPath}/${newName}`);
    if (!canWriteToDirectory(node.parentPath)) return false;

    // Check if new path already exists
    if (exists(newPath)) return false;

    // Update the node
    fs[index] = {
      ...node,
      name: newName,
      path: newPath,
      isHidden: newName.startsWith("."),
      modifiedAt: Date.now(),
    };

    // If it's a directory, update all children paths
    if (node.type === "directory") {
      fs.forEach((child, i) => {
        if (child.path.startsWith(normalized + "/")) {
          fs[i] = {
            ...child,
            path: child.path.replace(normalized, newPath),
            parentPath:
              child.parentPath === normalized
                ? newPath
                : child.parentPath.replace(normalized, newPath),
          };
        }
      });
    }

    saveFileSystem(fs);
    return true;
  }

  function deleteNode(path: string): boolean {
    const normalized = normalizePath(path);
    if (normalized === "/") return false;
    if (isNodeReadOnly(normalized)) return false;
    if (hasReadOnlyDescendant(normalized)) return false;

    let fs = getFileSystem();
    const node = fs.find((n) => n.path === normalized);

    if (!node) return false;

    // If directory, delete all children recursively
    if (node.type === "directory") {
      fs = fs.filter(
        (n) => !n.path.startsWith(normalized + "/") && n.path !== normalized,
      );
    } else {
      fs = fs.filter((n) => n.path !== normalized);
    }

    saveFileSystem(fs);
    return true;
  }

  function move(sourcePath: string, destPath: string): boolean {
    const srcNormalized = normalizePath(sourcePath);
    const destNormalized = normalizePath(destPath);
    if (isNodeReadOnly(srcNormalized)) return false;
    if (!canWriteToDirectory(destNormalized)) return false;

    const fs = getFileSystem();
    const srcIndex = fs.findIndex((node) => node.path === srcNormalized);

    if (srcIndex === -1) return false;
    if (!isDirectory(destNormalized)) return false;

    const srcNode = fs[srcIndex];

    if (
      srcNode.type === "directory" &&
      (destNormalized === srcNormalized ||
        destNormalized.startsWith(`${srcNormalized}/`))
    ) {
      return false;
    }

    const newPath = normalizePath(`${destNormalized}/${srcNode.name}`);

    if (exists(newPath)) return false;

    // Update source node
    fs[srcIndex] = {
      ...srcNode,
      path: newPath,
      parentPath: destNormalized,
      modifiedAt: Date.now(),
    };

    // If directory, update all children
    if (srcNode.type === "directory") {
      fs.forEach((child, i) => {
        if (child.path.startsWith(srcNormalized + "/")) {
          fs[i] = {
            ...child,
            path: child.path.replace(srcNormalized, newPath),
            parentPath:
              child.parentPath === srcNormalized
                ? newPath
                : child.parentPath.replace(srcNormalized, newPath),
          };
        }
      });
    }

    saveFileSystem(fs);
    return true;
  }

  function copy(sourcePath: string, destPath: string): boolean {
    const srcNormalized = normalizePath(sourcePath);
    const destNormalized = normalizePath(destPath);
    if (!canWriteToDirectory(destNormalized)) return false;

    const fs = getFileSystem();
    const srcNode = fs.find((node) => node.path === srcNormalized);

    if (!srcNode) return false;
    if (!isDirectory(destNormalized)) return false;

    // Generate unique name if exists
    let newName = srcNode.name;
    let newPath = normalizePath(`${destNormalized}/${newName}`);
    let counter = 1;

    while (exists(newPath)) {
      const nameParts = srcNode.name.split(".");
      if (nameParts.length > 1) {
        const ext = nameParts.pop();
        newName = `${nameParts.join(".")}_copy${counter}.${ext}`;
      } else {
        newName = `${srcNode.name}_copy${counter}`;
      }
      newPath = normalizePath(`${destNormalized}/${newName}`);
      counter++;
    }

    // Create copy
    if (srcNode.type === "file") {
      fs.push({
        ...srcNode,
        name: newName,
        path: newPath,
        parentPath: destNormalized,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      });
    } else {
      // Copy directory and all its children
      fs.push({
        ...srcNode,
        name: newName,
        path: newPath,
        parentPath: destNormalized,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      });

      const children = fs.filter((n) => n.path.startsWith(srcNormalized + "/"));
      children.forEach((child) => {
        fs.push({
          ...child,
          path: child.path.replace(srcNormalized, newPath),
          parentPath:
            child.parentPath === srcNormalized
              ? newPath
              : child.parentPath.replace(srcNormalized, newPath),
          createdAt: Date.now(),
          modifiedAt: Date.now(),
        });
      });
    }

    saveFileSystem(fs);
    return true;
  }

  function getDirectoryTree(
    path: string = "/",
  ): FileSystemNode & { children?: FileSystemNode[] } {
    const node = getNode(path);
    if (!node || node.type !== "directory") {
      return node as FileSystemNode;
    }

    const children = getChildren(path, true).map((child) => {
      if (child.type === "directory") {
        return getDirectoryTree(child.path);
      }
      return child;
    });

    return { ...node, children };
  }

  function searchFiles(
    query: string,
    startPath: string = "/",
  ): FileSystemNode[] {
    const normalized = normalizePath(startPath);
    const lowerQuery = query.toLowerCase();

    return getFileSystem().filter((node) => {
      if (!node.path.startsWith(normalized === "/" ? "" : normalized))
        return false;
      return node.name.toLowerCase().includes(lowerQuery);
    });
  }

  function getFileContents(path: string): string | undefined {
    const node = getNode(path);
    if (node?.type === "file") {
      return (node as FileSystemFile).contents;
    }
    return undefined;
  }

  function getStats(
    path: string,
  ): { files: number; directories: number; totalSize: number } | undefined {
    const normalized = normalizePath(path);
    if (!exists(normalized)) return undefined;

    const fs = getFileSystem();
    const descendants = fs.filter(
      (n) =>
        n.path.startsWith(normalized === "/" ? "" : normalized + "/") ||
        n.path === normalized,
    );

    return {
      files: descendants.filter((n) => n.type === "file").length,
      directories: descendants.filter((n) => n.type === "directory").length,
      totalSize: descendants.reduce((sum, n) => sum + n.size, 0),
    };
  }

  return {
    getNode,
    getChildren,
    getAllDirectories,
    exists,
    isDirectory,
    createDirectory,
    createFile,
    updateFile,
    rename,
    deleteNode,
    move,
    copy,
    getDirectoryTree,
    searchFiles,
    getFileContents,
    getStats,
    normalizePath,
    getParentPath,
    getNodeName,
    isNodeReadOnly,
    canWriteToDirectory,
    getHomePath,
  };
}
