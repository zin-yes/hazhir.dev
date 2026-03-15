"use client";

import { generateCVDocumentHtml } from "@/applications/document-viewer/articles/CV";
import AtlasDocument from "@/applications/document-viewer/articles/Portfolio/Atlas";
import GammaEngineDocument from "@/applications/document-viewer/articles/Portfolio/gamma-engine";
import HazhirDevDocument from "@/applications/document-viewer/articles/Portfolio/hazhir.dev";
import MetricJournalDocument from "@/applications/document-viewer/articles/Portfolio/metricjournal";
import type { FileSystemNode } from "@/hooks/use-file-system";
import {
  getImagesDirectoryPath,
  getWallpaperImageEntries,
} from "@/lib/image-files";
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
    id: "meditation",
    executableName: "meditation.app",
    displayName: "Nadi Shuddhi",
    icon: "Heart",
    desktopIconText: "Meditation",
    menuDescription: "Guided breathing meditation practice.",
    includeDesktopShortcut: false,
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
  {
    id: "image-viewer",
    executableName: "image-viewer.app",
    displayName: "Image Viewer",
    icon: "Image",
    desktopIconText: "Image Viewer",
    menuDescription: "Open and inspect image files.",
    includeDesktopShortcut: false,
  },
  {
    id: "file-properties",
    executableName: "file-properties.app",
    displayName: "File Properties",
    icon: "Info",
    desktopIconText: "Properties",
    menuDescription: "Inspect metadata, permissions, and storage usage.",
    includeDesktopShortcut: false,
  },
  {
    id: "settings",
    executableName: "settings.app",
    displayName: "Settings",
    icon: "Settings",
    desktopIconText: "Settings",
    menuDescription: "Adjust desktop, account, and terminal preferences.",
    includeDesktopShortcut: false,
  },
  {
    id: "visual-novel",
    executableName: "visual-novel.app",
    displayName: "Visual Novel",
    icon: "BookText",
    desktopIconText: "Visual Novel",
    menuDescription: "Play the built-in visual novel.",
    includeDesktopShortcut: false,
  },
  {
    id: "chat",
    executableName: "chat.app",
    displayName: "Chat",
    icon: "MessageSquare",
    desktopIconText: "Chat",
    menuDescription: "Chat with friends in real-time.",
    includeDesktopShortcut: false,
  },
];

export function buildDefaultFileSystem(username: string): FileSystemNode[] {
  const now = Date.now();
  const homePath = `/home/${username}`;
  const desktopPath = `${homePath}/Desktop`;
  const menuPath = `${homePath}/.menu`;
  const documentsPath = `${homePath}/Documents`;
  const imagesPath = getImagesDirectoryPath(homePath);
  const cvDocumentPath = `${documentsPath}/CV.document`;
  const defaultCvDocumentContents = generateCVDocumentHtml();

  const atlasDocumentPath = `${documentsPath}/Atlas.document`;
  const atlasDocumentContents = AtlasDocument();
  const gammaEngineDocumentPath = `${documentsPath}/Gamma-Engine.document`;
  const gammaEngineDocumentContents = GammaEngineDocument();
  const hazhirDevDocumentPath = `${documentsPath}/hazhir.dev.document`;
  const hazhirDevDocumentContents = HazhirDevDocument();
  const metricJournalDocumentPath = `${documentsPath}/MetricJournal.document`;
  const metricJournalDocumentContents = MetricJournalDocument();

  const projectsPath = `${desktopPath}/Projects`;
  const wallpaperImageEntries = getWallpaperImageEntries(homePath);

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
      name: "Images",
      type: "directory",
      path: imagesPath,
      parentPath: homePath,
      permissions: "r-xr-xr-x",
      owner: username,
      group: username,
      size: 4096,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
      readOnly: true,
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
    {
      name: "Atlas.document",
      type: "file",
      path: atlasDocumentPath,
      parentPath: documentsPath,
      contents: atlasDocumentContents,
      permissions: "rw-r--r--",
      owner: username,
      group: username,
      size: new Blob([atlasDocumentContents]).size,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
    },
    {
      name: "Gamma-Engine.document",
      type: "file",
      path: gammaEngineDocumentPath,
      parentPath: documentsPath,
      contents: gammaEngineDocumentContents,
      permissions: "rw-r--r--",
      owner: username,
      group: username,
      size: new Blob([gammaEngineDocumentContents]).size,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
    },
    {
      name: "hazhir.dev.document",
      type: "file",
      path: hazhirDevDocumentPath,
      parentPath: documentsPath,
      contents: hazhirDevDocumentContents,
      permissions: "rw-r--r--",
      owner: username,
      group: username,
      size: new Blob([hazhirDevDocumentContents]).size,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
    },
    {
      name: "MetricJournal.document",
      type: "file",
      path: metricJournalDocumentPath,
      parentPath: documentsPath,
      contents: metricJournalDocumentContents,
      permissions: "rw-r--r--",
      owner: username,
      group: username,
      size: new Blob([metricJournalDocumentContents]).size,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
    },
    ...wallpaperImageEntries.map((entry) => ({
      name: entry.name,
      type: "file" as const,
      path: entry.path,
      parentPath: entry.parentPath,
      contents: entry.url,
      mimeType: "image/jpeg",
      permissions: "r--r--r--",
      owner: username,
      group: username,
      size: 0,
      createdAt: now,
      modifiedAt: now,
      isHidden: false,
      readOnly: true,
    })),
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
    const contents = createShortcutContents({
      application: { target: `/applications/${app.executableName}` },
      meta: { display_name: app.desktopIconText },
      icon: { source: "lucide", url: app.icon },
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

  const menuShortcutNodes: FileSystemNode[] = SYSTEM_APPS.filter(
    (app) => app.id !== "link",
  ).map((app) => {
    const fileName = `${app.id}.shortcut`;
    const menuLabel = app.displayName;
    const contents = createShortcutContents({
      application: { target: `/applications/${app.executableName}` },
      meta: {
        display_name: menuLabel,
        description: app.menuDescription ?? `Open ${app.displayName}`,
      },
      icon: { source: "lucide", url: app.icon },
    });
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

  const cvShortcutContents = createShortcutContents({
    application: {
      target: "/applications/document-viewer.app",
      arguments: [cvDocumentPath, "CV.document"],
    },
    meta: { display_name: "CV" },
    icon: { source: "lucide", url: "BookOpen" },
  });

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

  // --- Projects folder and shortcuts ---

  const projectsFolderNode: FileSystemNode = {
    name: "Projects",
    type: "directory",
    path: projectsPath,
    parentPath: desktopPath,
    permissions: "rwxr-xr-x",
    owner: username,
    group: username,
    size: 4096,
    createdAt: now,
    modifiedAt: now,
    isHidden: false,
  };

  const metricJournalShortcutContents = createShortcutContents({
    application: {
      target: "/applications/document-viewer.app",
      arguments: [metricJournalDocumentPath, "MetricJournal.document"],
    },
    meta: { display_name: "MetricJournal" },
    icon: { source: "url", url: "/articles/mj_logo.png" },
  });

  const metricJournalShortcutNode: FileSystemNode = {
    name: "metricjournal.shortcut",
    type: "file",
    path: `${projectsPath}/metricjournal.shortcut`,
    parentPath: projectsPath,
    contents: metricJournalShortcutContents,
    permissions: "rw-r--r--",
    owner: username,
    group: username,
    size: new Blob([metricJournalShortcutContents]).size,
    createdAt: now,
    modifiedAt: now,
    isHidden: false,
  };

  const hazhirDevShortcutContents = createShortcutContents({
    application: {
      target: "/applications/document-viewer.app",
      arguments: [hazhirDevDocumentPath, "hazhir.dev.document"],
    },
    meta: { display_name: "hazhir.dev" },
    icon: { source: "url", url: "/articles/hd_logo.png" },
  });

  const hazhirDevShortcutNode: FileSystemNode = {
    name: "hazhir.dev.shortcut",
    type: "file",
    path: `${projectsPath}/hazhir.dev.shortcut`,
    parentPath: projectsPath,
    contents: hazhirDevShortcutContents,
    permissions: "rw-r--r--",
    owner: username,
    group: username,
    size: new Blob([hazhirDevShortcutContents]).size,
    createdAt: now,
    modifiedAt: now,
    isHidden: false,
  };

  const gammaEngineShortcutContents = createShortcutContents({
    application: {
      target: "/applications/document-viewer.app",
      arguments: [gammaEngineDocumentPath, "Gamma-Engine.document"],
    },
    meta: { display_name: "Gamma Engine" },
    icon: { source: "lucide", url: "Box" },
  });

  const gammaEngineShortcutNode: FileSystemNode = {
    name: "gamma-engine.shortcut",
    type: "file",
    path: `${projectsPath}/gamma-engine.shortcut`,
    parentPath: projectsPath,
    contents: gammaEngineShortcutContents,
    permissions: "rw-r--r--",
    owner: username,
    group: username,
    size: new Blob([gammaEngineShortcutContents]).size,
    createdAt: now,
    modifiedAt: now,
    isHidden: false,
  };

  const atlasShortcutContents = createShortcutContents({
    application: {
      target: "/applications/document-viewer.app",
      arguments: [atlasDocumentPath],
    },
    meta: { display_name: "Atlas" },
    icon: { source: "url", url: "/articles/atlas_logo.png" },
  });

  const atlasShortcutNode: FileSystemNode = {
    name: "atlas.shortcut",
    type: "file",
    path: `${projectsPath}/atlas.shortcut`,
    parentPath: projectsPath,
    contents: atlasShortcutContents,
    permissions: "rw-r--r--",
    owner: username,
    group: username,
    size: new Blob([atlasShortcutContents]).size,
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
    projectsFolderNode,
    metricJournalShortcutNode,
    hazhirDevShortcutNode,
    gammaEngineShortcutNode,
    atlasShortcutNode,
  ].map((node) => {
    if (node.type !== "file") return node;
    return { ...node, size: new Blob([node.contents ?? ""]).size };
  });
}
