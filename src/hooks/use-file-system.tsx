"use client";

import { generateCVDocumentHtml } from "@/applications/document-viewer/articles/CV";
import { buildDefaultFileSystem } from "@/config/system-file-system";
import { getCurrentSystemUsername, getHomePath } from "@/lib/system-user";

export type FileSystemNodeType = "file" | "directory";

export interface FileSystemNode {
  name: string;
  type: FileSystemNodeType;
  path: string; // Full path like /home/guest/Documents
  parentPath: string; // Parent directory path
  contents?: string; // Only for files
  permissions: string; // Unix-like permissions e.g., "rwxr-xr-x"
  owner: string;
  group: string;
  size: number; // In bytes
  createdAt: number; // Unix timestamp
  modifiedAt: number; // Unix timestamp
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
const FILE_SYSTEM_STORAGE_KEY = "filesystem_v6";

export function useFileSystem() {
  function normalizePath(path: string): string {
    const raw = (path || "").replace(/\/+/g, "/");
    const forcedAbsolute = raw.startsWith("/") ? raw : `/${raw}`;
    const segments = forcedAbsolute.split("/");
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

  function getFileSystem(): FileSystemNode[] {
    if (typeof window === "undefined") {
      return buildDefaultFileSystem("guest");
    }

    const stored = window.localStorage.getItem(FILE_SYSTEM_STORAGE_KEY);
    if (!stored) {
      const defaults = buildDefaultFileSystem(getCurrentSystemUsername());
      window.localStorage.setItem(
        FILE_SYSTEM_STORAGE_KEY,
        JSON.stringify(defaults),
      );
      return defaults;
    }

    const parsed = JSON.parse(stored) as FileSystemNode[];
    const username = getCurrentSystemUsername();
    const homePath = `/home/${username}`;
    const defaults = buildDefaultFileSystem(username);
    const existingPaths = new Set(
      parsed.map((node) => normalizePath(node.path)),
    );

    const missingSystemExecutables = defaults.filter((node) => {
      if (node.path === "/applications") {
        return !existingPaths.has("/applications");
      }

      const isApplicationsExecutable =
        node.path.startsWith("/applications/") &&
        node.type === "file" &&
        Boolean(node.executable);

      return (
        isApplicationsExecutable && !existingPaths.has(normalizePath(node.path))
      );
    });

    const missingDefaultDocuments = defaults.filter((node) => {
      const normalizedPath = normalizePath(node.path);
      const isDefaultDocument =
        node.type === "file" &&
        normalizedPath.startsWith(`${homePath}/Documents/`) &&
        node.name.endsWith(".document");

      return isDefaultDocument && !existingPaths.has(normalizedPath);
    });

    const defaultDesktopShortcutNames = new Set([
      "github.shortcut",
      "linkedin.shortcut",
    ]);

    const missingDefaultDesktopShortcuts = defaults.filter((node) => {
      const normalizedPath = normalizePath(node.path);
      const isDefaultDesktopShortcut =
        node.type === "file" &&
        normalizedPath.startsWith(`${homePath}/Desktop/`) &&
        defaultDesktopShortcutNames.has(node.name);

      return isDefaultDesktopShortcut && !existingPaths.has(normalizedPath);
    });

    const withDotHiddenFix = parsed.map((node) => {
      const shouldBeHidden = node.name.startsWith(".");
      if (node.isHidden === shouldBeHidden) return node;
      return {
        ...node,
        isHidden: shouldBeHidden,
      };
    });

    const isApplicationsPath = (path: string) =>
      path === "/applications" || path.startsWith("/applications/");

    const withProtectionPolicyFix = withDotHiddenFix.map((node) => {
      const normalizedPath = normalizePath(node.path);
      const shouldBeReadOnly = isApplicationsPath(normalizedPath);
      if (Boolean(node.readOnly) === shouldBeReadOnly) return node;
      return {
        ...node,
        readOnly: shouldBeReadOnly,
      };
    });

    const cvDocumentPath = `${homePath}/Documents/CV.document`;
    const nextGeneratedCvDocument = generateCVDocumentHtml();
    const withLegacyCvTemplateUpgrade = withProtectionPolicyFix.map((node) => {
      if (normalizePath(node.path) !== normalizePath(cvDocumentPath)) {
        return node;
      }

      if (node.type !== "file") return node;
      const currentContents = node.contents ?? "";
      const isLegacyCvTemplate =
        currentContents.includes('<main class="page">') &&
        currentContents.includes("<style>") &&
        currentContents.includes("section-title");

      if (!isLegacyCvTemplate) {
        return node;
      }

      return {
        ...node,
        contents: nextGeneratedCvDocument,
        size: new Blob([nextGeneratedCvDocument]).size,
        modifiedAt: Date.now(),
      };
    });

    const now = Date.now();
    const requiredDirectories: FileSystemNode[] = [
      {
        name: "home",
        type: "directory",
        path: "/home",
        parentPath: "/",
        permissions: "rwxr-xr-x",
        owner: "root",
        group: "root",
        size: 4096,
        createdAt: now,
        modifiedAt: now,
        isHidden: false,
        readOnly: false,
      },
      {
        name: username,
        type: "directory",
        path: homePath,
        parentPath: "/home",
        permissions: "rwxr-xr-x",
        owner: username,
        group: username,
        size: 4096,
        createdAt: now,
        modifiedAt: now,
        isHidden: false,
        readOnly: false,
      },
      {
        name: "Desktop",
        type: "directory",
        path: `${homePath}/Desktop`,
        parentPath: homePath,
        permissions: "rwxr-xr-x",
        owner: username,
        group: username,
        size: 4096,
        createdAt: now,
        modifiedAt: now,
        isHidden: false,
        readOnly: false,
      },
      {
        name: "Documents",
        type: "directory",
        path: `${homePath}/Documents`,
        parentPath: homePath,
        permissions: "rwxr-xr-x",
        owner: username,
        group: username,
        size: 4096,
        createdAt: now,
        modifiedAt: now,
        isHidden: false,
        readOnly: false,
      },
    ];

    const ensuredCoreDirectories = [...withLegacyCvTemplateUpgrade];
    const ensuredPathSet = new Set(
      ensuredCoreDirectories.map((node) => normalizePath(node.path)),
    );

    requiredDirectories.forEach((directoryNode) => {
      const path = normalizePath(directoryNode.path);
      if (!ensuredPathSet.has(path)) {
        ensuredCoreDirectories.push(directoryNode);
        ensuredPathSet.add(path);
      }
    });

    if (
      missingSystemExecutables.length === 0 &&
      missingDefaultDocuments.length === 0 &&
      missingDefaultDesktopShortcuts.length === 0
    ) {
      const changed =
        ensuredCoreDirectories.length !== parsed.length ||
        ensuredCoreDirectories.some((node, index) => node !== parsed[index]);
      if (changed) {
        window.localStorage.setItem(
          FILE_SYSTEM_STORAGE_KEY,
          JSON.stringify(ensuredCoreDirectories),
        );
      }
      return ensuredCoreDirectories;
    }

    const next = [
      ...ensuredCoreDirectories,
      ...missingSystemExecutables,
      ...missingDefaultDocuments,
      ...missingDefaultDesktopShortcuts,
    ];
    window.localStorage.setItem(FILE_SYSTEM_STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function saveFileSystem(nodes: FileSystemNode[]) {
    window.localStorage.setItem(FILE_SYSTEM_STORAGE_KEY, JSON.stringify(nodes));
    window.dispatchEvent(new Event("storage"));
  }

  function isNodeReadOnly(path: string): boolean {
    const normalized = normalizePath(path);
    return (
      normalized === "/applications" || normalized.startsWith("/applications/")
    );
  }

  function hasReadOnlyDescendant(path: string): boolean {
    const normalized = normalizePath(path);
    return getFileSystem().some(
      (node) =>
        node.path.startsWith(`${normalized}/`) &&
        (normalizePath(node.path) === "/applications" ||
          normalizePath(node.path).startsWith("/applications/")),
    );
  }

  function canWriteToDirectory(path: string): boolean {
    const normalized = normalizePath(path);
    const node = getNode(path);
    if (!node || node.type !== "directory") return false;
    if (
      normalized === "/applications" ||
      normalized.startsWith("/applications/")
    ) {
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
    getHomePath,
  };
}
