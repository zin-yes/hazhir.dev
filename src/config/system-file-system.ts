"use client";

import type { FileSystemNode } from "@/hooks/use-file-system";
import {
    createAppExecutableContents,
    createShortcutContents,
} from "@/lib/shortcut";

export type SystemAppDefinition = {
  id: string;
  executableName: string;
  displayName: string;
  icon: string;
  desktopIconText: string;
  includeDesktopShortcut?: boolean;
};

export const SYSTEM_APPS: SystemAppDefinition[] = [
  {
    id: "terminal",
    executableName: "terminal.app",
    displayName: "Terminal",
    icon: "TerminalSquare",
    desktopIconText: "Terminal",
  },
  {
    id: "file-explorer",
    executableName: "file-explorer.app",
    displayName: "File Explorer",
    icon: "FolderClosed",
    desktopIconText: "Files",
  },
  {
    id: "voxel-game",
    executableName: "voxel-game.app",
    displayName: "Voxel Game",
    icon: "Gamepad2",
    desktopIconText: "Voxel Game",
  },
  {
    id: "calculator",
    executableName: "calculator.app",
    displayName: "Calculator",
    icon: "Calculator",
    desktopIconText: "Calculator",
  },
  {
    id: "visual-novel",
    executableName: "visual-novel.app",
    displayName: "Visual Novel",
    icon: "BookText",
    desktopIconText: "Visual Novel",
  },
  {
    id: "text-editor",
    executableName: "text-editor.app",
    displayName: "Text Editor",
    icon: "BookText",
    desktopIconText: "Text Editor",
    includeDesktopShortcut: false,
  },
  {
    id: "document-viewer",
    executableName: "document-viewer.app",
    displayName: "Document Viewer",
    icon: "BookOpen",
    desktopIconText: "Document Viewer",
    includeDesktopShortcut: false,
  },
];

export function buildDefaultFileSystem(username: string): FileSystemNode[] {
  const now = Date.now();
  const homePath = `/home/${username}`;
  const desktopPath = `${homePath}/Desktop`;
  const documentsPath = `${homePath}/Documents`;

  const baseNodes: FileSystemNode[] = [
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
      readOnly: true,
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
    },
    {
      name: "Desktop",
      type: "directory",
      path: desktopPath,
      parentPath: homePath,
      permissions: "rwxr-xr-x",
      owner: username,
      group: username,
      size: 4096,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
    },
    {
      name: "Documents",
      type: "directory",
      path: documentsPath,
      parentPath: homePath,
      permissions: "rwxr-xr-x",
      owner: username,
      group: username,
      size: 4096,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
    },
    {
      name: "applications",
      type: "directory",
      path: "/applications",
      parentPath: "/",
      permissions: "r-xr-xr-x",
      owner: "root",
      group: "root",
      size: 4096,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
      readOnly: true,
    },
    {
      name: ".terminal_history",
      type: "file",
      path: `${homePath}/.terminal_history`,
      parentPath: homePath,
      contents: "",
      permissions: "rw-------",
      owner: username,
      group: username,
      size: 0,
      createdAt: now,
      modifiedAt: now,
      isHidden: true,
    },
    {
      name: ".terminal_rc",
      type: "file",
      path: `${homePath}/.terminal_rc`,
      parentPath: homePath,
      contents: [
        "# Terminal startup script",
        `export HOME=${homePath}`,
        "export PATH=/applications",
        "alias edit=text-editor",
      ].join("\n"),
      permissions: "rw-r--r--",
      owner: username,
      group: username,
      size: 0,
      createdAt: now,
      modifiedAt: now,
      isHidden: true,
    },
  ];

  const executableNodes: FileSystemNode[] = SYSTEM_APPS.map((app) => {
    const contents = createAppExecutableContents(app.id, app.displayName);
    return {
      name: app.executableName,
      type: "file",
      path: `/applications/${app.executableName}`,
      parentPath: "/applications",
      contents,
      permissions: "r-xr-xr-x",
      owner: "root",
      group: "root",
      size: new Blob([contents]).size,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
      readOnly: true,
      executable: true,
    };
  });

  const shortcutNodes: FileSystemNode[] = SYSTEM_APPS.filter(
    (app) => app.includeDesktopShortcut !== false
  ).map((app) => {
    const fileName = `${app.id}.shortcut`;
    const contents = createShortcutContents(`/applications/${app.executableName}`, {
      name: app.desktopIconText,
      icon: app.icon,
      iconDisplayText: app.desktopIconText,
    });
    return {
      name: fileName,
      type: "file",
      path: `${desktopPath}/${fileName}`,
      parentPath: desktopPath,
      contents,
      permissions: "rw-r--r--",
      owner: username,
      group: username,
      size: new Blob([contents]).size,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
    };
  });

  const cvShortcutContents = createShortcutContents(
    "/applications/document-viewer.app",
    {
      name: "CV",
      icon: "BookOpen",
      iconDisplayText: "CV",
      args: ["CV.pdf", "CV.pdf"],
    }
  );

  const cvShortcutNode: FileSystemNode = {
    name: "cv.shortcut",
    type: "file",
    path: `${desktopPath}/cv.shortcut`,
    parentPath: desktopPath,
    contents: cvShortcutContents,
    permissions: "rw-r--r--",
    owner: username,
    group: username,
    size: new Blob([cvShortcutContents]).size,
    createdAt: now,
    modifiedAt: now,
    isHidden: false,
  };

  return [...baseNodes, ...executableNodes, ...shortcutNodes, cvShortcutNode].map((node) => {
    if (node.type !== "file") return node;
    return { ...node, size: new Blob([node.contents ?? ""]).size };
  });
}
