"use client";

export type FileSystemNodeType = "file" | "directory";

export interface FileSystemNode {
  name: string;
  type: FileSystemNodeType;
  path: string; // Full path like /home/user/documents
  parentPath: string; // Parent directory path
  contents?: string; // Only for files
  permissions: string; // Unix-like permissions e.g., "rwxr-xr-x"
  owner: string;
  group: string;
  size: number; // In bytes
  createdAt: number; // Unix timestamp
  modifiedAt: number; // Unix timestamp
  isHidden: boolean;
}

export interface FileSystemDirectory extends FileSystemNode {
  type: "directory";
}

export interface FileSystemFile extends FileSystemNode {
  type: "file";
  contents: string;
  mimeType?: string;
}

// Default Linux-like file system structure
const DEFAULT_FILE_SYSTEM: FileSystemNode[] = [
  // Root directories
  {
    name: "home",
    type: "directory",
    path: "/home",
    parentPath: "/",
    permissions: "rwxr-xr-x",
    owner: "root",
    group: "root",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "user",
    type: "directory",
    path: "/home/user",
    parentPath: "/home",
    permissions: "rwxr-xr-x",
    owner: "user",
    group: "user",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "Documents",
    type: "directory",
    path: "/home/user/Documents",
    parentPath: "/home/user",
    permissions: "rwxr-xr-x",
    owner: "user",
    group: "user",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "Downloads",
    type: "directory",
    path: "/home/user/Downloads",
    parentPath: "/home/user",
    permissions: "rwxr-xr-x",
    owner: "user",
    group: "user",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "Pictures",
    type: "directory",
    path: "/home/user/Pictures",
    parentPath: "/home/user",
    permissions: "rwxr-xr-x",
    owner: "user",
    group: "user",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "Music",
    type: "directory",
    path: "/home/user/Music",
    parentPath: "/home/user",
    permissions: "rwxr-xr-x",
    owner: "user",
    group: "user",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "Videos",
    type: "directory",
    path: "/home/user/Videos",
    parentPath: "/home/user",
    permissions: "rwxr-xr-x",
    owner: "user",
    group: "user",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "Desktop",
    type: "directory",
    path: "/home/user/Desktop",
    parentPath: "/home/user",
    permissions: "rwxr-xr-x",
    owner: "user",
    group: "user",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: ".config",
    type: "directory",
    path: "/home/user/.config",
    parentPath: "/home/user",
    permissions: "rwxr-xr-x",
    owner: "user",
    group: "user",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: true,
  },
  {
    name: "etc",
    type: "directory",
    path: "/etc",
    parentPath: "/",
    permissions: "rwxr-xr-x",
    owner: "root",
    group: "root",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "var",
    type: "directory",
    path: "/var",
    parentPath: "/",
    permissions: "rwxr-xr-x",
    owner: "root",
    group: "root",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "tmp",
    type: "directory",
    path: "/tmp",
    parentPath: "/",
    permissions: "rwxrwxrwx",
    owner: "root",
    group: "root",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: "usr",
    type: "directory",
    path: "/usr",
    parentPath: "/",
    permissions: "rwxr-xr-x",
    owner: "root",
    group: "root",
    size: 4096,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  // Sample files
  {
    name: "readme.txt",
    type: "file",
    path: "/home/user/Documents/readme.txt",
    parentPath: "/home/user/Documents",
    contents: "Welcome to the file system!\n\nThis is a simulated Linux file system.",
    permissions: "rw-r--r--",
    owner: "user",
    group: "user",
    size: 71,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: false,
  },
  {
    name: ".bashrc",
    type: "file",
    path: "/home/user/.bashrc",
    parentPath: "/home/user",
    contents: "# ~/.bashrc\n\n# User specific aliases and functions\nalias ll='ls -la'\nalias la='ls -A'\n\nexport PATH=$HOME/bin:$PATH",
    permissions: "rw-r--r--",
    owner: "user",
    group: "user",
    size: 125,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: true,
  },
  {
    name: ".profile",
    type: "file",
    path: "/home/user/.profile",
    parentPath: "/home/user",
    contents: "# ~/.profile\n\n# Set default editor\nexport EDITOR=vim\n\n# Source bashrc\nif [ -f ~/.bashrc ]; then\n    . ~/.bashrc\nfi",
    permissions: "rw-r--r--",
    owner: "user",
    group: "user",
    size: 132,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    isHidden: true,
  },
];

const FILE_SYSTEM_STORAGE_KEY = "filesystem_v2";

export function useFileSystem() {
  function getFileSystem(): FileSystemNode[] {
    if (typeof window === "undefined") return DEFAULT_FILE_SYSTEM;
    
    const stored = window.localStorage.getItem(FILE_SYSTEM_STORAGE_KEY);
    if (!stored) {
      // Initialize with default file system
      window.localStorage.setItem(FILE_SYSTEM_STORAGE_KEY, JSON.stringify(DEFAULT_FILE_SYSTEM));
      return DEFAULT_FILE_SYSTEM;
    }
    return JSON.parse(stored);
  }

  function saveFileSystem(nodes: FileSystemNode[]) {
    window.localStorage.setItem(FILE_SYSTEM_STORAGE_KEY, JSON.stringify(nodes));
    window.dispatchEvent(new Event("storage"));
  }

  function normalizePath(path: string): string {
    // Remove trailing slash, except for root
    let normalized = path.replace(/\/+/g, "/");
    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    if (!normalized.startsWith("/")) {
      normalized = "/" + normalized;
    }
    return normalized;
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
    return fs.filter((node) => {
      const matches = node.parentPath === normalized;
      if (!showHidden && node.isHidden) return false;
      return matches;
    }).sort((a, b) => {
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

    const fs = getFileSystem();
    fs.push({
      name,
      type: "directory",
      path: fullPath,
      parentPath,
      permissions: "rwxr-xr-x",
      owner: "user",
      group: "user",
      size: 4096,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      isHidden: name.startsWith("."),
    });
    saveFileSystem(fs);
    return true;
  }

  function createFile(path: string, name: string, contents: string = ""): boolean {
    const parentPath = normalizePath(path);
    const fullPath = normalizePath(`${parentPath}/${name}`);
    
    if (exists(fullPath)) return false;
    if (!exists(parentPath) && parentPath !== "/") return false;

    const fs = getFileSystem();
    fs.push({
      name,
      type: "file",
      path: fullPath,
      parentPath,
      contents,
      permissions: "rw-r--r--",
      owner: "user",
      group: "user",
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
    const fs = getFileSystem();
    const index = fs.findIndex((node) => node.path === normalized && node.type === "file");
    
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
    const fs = getFileSystem();
    const index = fs.findIndex((node) => node.path === normalized);
    
    if (index === -1) return false;

    const node = fs[index];
    const newPath = normalizePath(`${node.parentPath}/${newName}`);
    
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
            parentPath: child.parentPath === normalized ? newPath : child.parentPath.replace(normalized, newPath),
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
    
    let fs = getFileSystem();
    const node = fs.find((n) => n.path === normalized);
    
    if (!node) return false;

    // If directory, delete all children recursively
    if (node.type === "directory") {
      fs = fs.filter((n) => !n.path.startsWith(normalized + "/") && n.path !== normalized);
    } else {
      fs = fs.filter((n) => n.path !== normalized);
    }

    saveFileSystem(fs);
    return true;
  }

  function move(sourcePath: string, destPath: string): boolean {
    const srcNormalized = normalizePath(sourcePath);
    const destNormalized = normalizePath(destPath);
    
    const fs = getFileSystem();
    const srcIndex = fs.findIndex((node) => node.path === srcNormalized);
    
    if (srcIndex === -1) return false;
    if (!isDirectory(destNormalized)) return false;

    const srcNode = fs[srcIndex];
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
            parentPath: child.parentPath === srcNormalized ? newPath : child.parentPath.replace(srcNormalized, newPath),
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
          parentPath: child.parentPath === srcNormalized ? newPath : child.parentPath.replace(srcNormalized, newPath),
          createdAt: Date.now(),
          modifiedAt: Date.now(),
        });
      });
    }

    saveFileSystem(fs);
    return true;
  }

  function getDirectoryTree(path: string = "/"): FileSystemNode & { children?: FileSystemNode[] } {
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

  function searchFiles(query: string, startPath: string = "/"): FileSystemNode[] {
    const normalized = normalizePath(startPath);
    const lowerQuery = query.toLowerCase();
    
    return getFileSystem().filter((node) => {
      if (!node.path.startsWith(normalized === "/" ? "" : normalized)) return false;
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

  function getStats(path: string): { files: number; directories: number; totalSize: number } | undefined {
    const normalized = normalizePath(path);
    if (!exists(normalized)) return undefined;

    const fs = getFileSystem();
    const descendants = fs.filter((n) => 
      n.path.startsWith(normalized === "/" ? "" : normalized + "/") || n.path === normalized
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
  };
}
