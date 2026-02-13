"use client";

import type { FileSystemNode, useFileSystem } from "@/hooks/use-file-system";
import { requestLaunchApplication } from "@/lib/application-launcher";
import { parseAppExecutable, parseShortcut } from "@/lib/shortcut";

type FileSystemApi = ReturnType<typeof useFileSystem>;

export type FileExecutionResult = {
  ok: boolean;
  message?: string;
};

function executeApplicationNode(
  node: FileSystemNode,
  fs: FileSystemApi,
  launchArgs: string[] = []
): FileExecutionResult {
  const contents = fs.getFileContents(node.path) ?? "";
  const parsed = parseAppExecutable(contents);
  if (!parsed) {
    return { ok: false, message: `Invalid app executable format: ${node.name}` };
  }

  requestLaunchApplication(parsed.appId, launchArgs);
  return { ok: true };
}

export function executeFilePath(path: string, fs: FileSystemApi): FileExecutionResult {
  const node = fs.getNode(path);
  if (!node || node.type !== "file") {
    return { ok: false, message: `File not found: ${path}` };
  }

  if (node.name.endsWith(".shortcut")) {
    const shortcut = parseShortcut(fs.getFileContents(node.path) ?? "");
    if (!shortcut) {
      return { ok: false, message: `Invalid shortcut format: ${node.name}` };
    }

    if (shortcut.type === "application") {
      const targetNode = fs.getNode(shortcut.target);
      if (!targetNode || targetNode.type !== "file") {
        return { ok: false, message: `Shortcut target not found: ${shortcut.target}` };
      }
      return executeApplicationNode(targetNode, fs, shortcut.args);
    }
  }

  if (node.name.endsWith(".app") || node.executable) {
    if (!node.executable && !node.name.endsWith(".app")) {
      return { ok: false, message: `${node.name}: Permission denied` };
    }
    return executeApplicationNode(node, fs);
  }

  return { ok: false, message: `${node.name}: is not executable` };
}

export function isShortcutFile(node: FileSystemNode): boolean {
  return node.type === "file" && node.name.endsWith(".shortcut");
}

export function isExecutableFile(node: FileSystemNode): boolean {
  return node.type === "file" && (node.executable || node.name.endsWith(".app"));
}
