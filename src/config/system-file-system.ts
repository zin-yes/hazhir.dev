"use client";

import { generateCVDocumentHtml } from "@/applications/document-viewer/articles/CV";
import type { FileSystemNode } from "@/hooks/use-file-system";
import {
  createAppExecutableContents,
  createLinkShortcutContents,
  createShortcutContents,
} from "@/lib/shortcut";

export type SystemAppDefinition = {
  id: string;
  executableName: string;
  displayName: string;
  icon: string;
  desktopIconText: string;
  menuDescription?: string;
  includeDesktopShortcut?: boolean;
};

export const SYSTEM_APPS: SystemAppDefinition[] = [
  {
    id: "terminal",
    executableName: "terminal.app",
    displayName: "Terminal",
    icon: "TerminalSquare",
    desktopIconText: "Terminal",
    menuDescription: "Run shell commands and scripts.",
  },
  {
    id: "file-explorer",
    executableName: "file-explorer.app",
    displayName: "File Explorer",
    icon: "FolderClosed",
    desktopIconText: "Files",
    menuDescription: "Browse and manage files.",
  },
  {
    id: "voxel-game",
    executableName: "voxel-game.app",
    displayName: "Voxel Game",
    icon: "Gamepad2",
    desktopIconText: "Voxel Game",
    menuDescription: "Play the built-in voxel game.",
  },
  {
    id: "calculator",
    executableName: "calculator.app",
    displayName: "Calculator",
    icon: "Calculator",
    desktopIconText: "Calculator",
    menuDescription: "Perform quick calculations.",
    includeDesktopShortcut: false,
  },
  {
    id: "visual-novel",
    executableName: "visual-novel.app",
    displayName: "Visual Novel",
    icon: "BookText",
    desktopIconText: "Visual Novel",
    menuDescription: "Launch the visual novel app.",
    includeDesktopShortcut: false,
  },
  {
    id: "text-editor",
    executableName: "text-editor.app",
    displayName: "Text Editor",
    icon: "BookText",
    desktopIconText: "Text Editor",
    menuDescription: "Edit text and code files.",
    includeDesktopShortcut: false,
  },
  {
    id: "document-viewer",
    executableName: "document-viewer.app",
    displayName: "Document Viewer",
    icon: "BookOpen",
    desktopIconText: "Document Viewer",
    menuDescription: "Open and read .document files.",
    includeDesktopShortcut: false,
  },
];

export function buildDefaultFileSystem(username: string): FileSystemNode[] {
  const now = Date.now();
  const homePath = `/home/${username}`;
  const desktopPath = `${homePath}/Desktop`;
  const menuPath = `${homePath}/.menu`;
  const documentsPath = `${homePath}/Documents`;
  const cvDocumentPath = `${documentsPath}/CV.document`;
  const defaultCvDocumentContents = generateCVDocumentHtml();

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
      name: ".menu",
      type: "directory",
      path: menuPath,
      parentPath: homePath,
      permissions: "rwxr-xr-x",
      owner: username,
      group: username,
      size: 4096,
      createdAt: now,
      modifiedAt: now,
      isHidden: true,
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
    {
      name: "CV.document",
      type: "file",
      path: cvDocumentPath,
      parentPath: documentsPath,
      contents: defaultCvDocumentContents,
      permissions: "rw-r--r--",
      owner: username,
      group: username,
      size: new Blob([defaultCvDocumentContents]).size,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
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
    (app) => app.includeDesktopShortcut !== false,
  ).map((app) => {
    const fileName = `${app.id}.shortcut`;
    const contents = createShortcutContents(
      `/applications/${app.executableName}`,
      {
        name: app.desktopIconText,
        icon: app.icon,
        iconDisplayText: app.desktopIconText,
      },
    );
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

  const menuShortcutNodes: FileSystemNode[] = SYSTEM_APPS.filter(
    (app) => app.id !== "link",
  ).map((app) => {
    const fileName = `${app.id}.shortcut`;
    const menuLabel =
      app.id === "visual-novel"
        ? "Visual Novel (work in progress)"
        : app.displayName;
    const contents = createShortcutContents(
      `/applications/${app.executableName}`,
      {
        name: menuLabel,
        icon: app.icon,
        iconDisplayText: menuLabel,
        description: app.menuDescription ?? `Open ${app.displayName}`,
      },
    );
    return {
      name: fileName,
      type: "file",
      path: `${menuPath}/${fileName}`,
      parentPath: menuPath,
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
      args: [cvDocumentPath, "CV.document"],
    },
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

  const githubShortcutContents = createLinkShortcutContents(
    "https://github.com/zin-yes/",
    {
      name: "GitHub",
      icon: "FileSymlink",
      iconDisplayText: "GitHub",
    },
  );

  const githubShortcutNode: FileSystemNode = {
    name: "github.shortcut",
    type: "file",
    path: `${desktopPath}/github.shortcut`,
    parentPath: desktopPath,
    contents: githubShortcutContents,
    permissions: "rw-r--r--",
    owner: username,
    group: username,
    size: new Blob([githubShortcutContents]).size,
    createdAt: now,
    modifiedAt: now,
    isHidden: false,
  };

  const linkedinShortcutContents = createLinkShortcutContents(
    "https://linkedin.com/in/hazhir-taher",
    {
      name: "LinkedIn",
      icon: "FileSymlink",
      iconDisplayText: "LinkedIn",
    },
  );

  const linkedinShortcutNode: FileSystemNode = {
    name: "linkedin.shortcut",
    type: "file",
    path: `${desktopPath}/linkedin.shortcut`,
    parentPath: desktopPath,
    contents: linkedinShortcutContents,
    permissions: "rw-r--r--",
    owner: username,
    group: username,
    size: new Blob([linkedinShortcutContents]).size,
    createdAt: now,
    modifiedAt: now,
    isHidden: false,
  };

  return [
    ...baseNodes,
    ...executableNodes,
    ...shortcutNodes,
    ...menuShortcutNodes,
    cvShortcutNode,
    githubShortcutNode,
    linkedinShortcutNode,
  ].map((node) => {
    if (node.type !== "file") return node;
    return { ...node, size: new Blob([node.contents ?? ""]).size };
  });
}
