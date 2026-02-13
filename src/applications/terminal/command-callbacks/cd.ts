import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { useFileSystem } from "@/hooks/use-file-system";
import { getHomePath } from "@/lib/system-user";
import { getPathCompletions } from "./autocomplete";
import type { CommandAutocomplete, CommandCallback } from "./index";

// Store current working directory in window for persistence
declare global {
  interface Window {
    terminalCwdByWindow?: Record<string, string>;
    activeTerminalWindowId?: string;
  }
}

function getActiveWindowId(fallback?: string): string | null {
  if (typeof window === "undefined") return null;
  return fallback ?? window.activeTerminalWindowId ?? null;
}

function getCwd(windowIdentifier?: string): string {
  const home = getHomePath();
  if (typeof window === "undefined") {
    return home;
  }

  if (!window.terminalCwdByWindow) {
    window.terminalCwdByWindow = {};
  }

  const activeId = getActiveWindowId(windowIdentifier);
  if (!activeId) {
    return home;
  }

  return window.terminalCwdByWindow[activeId] ?? home;
}

function setCwd(path: string, windowIdentifier?: string): void {
  if (typeof window === "undefined") return;

  const activeId = getActiveWindowId(windowIdentifier);
  if (!activeId) return;

  if (!window.terminalCwdByWindow) {
    window.terminalCwdByWindow = {};
  }

  window.terminalCwdByWindow[activeId] = path;
}

function setActiveTerminalWindow(windowIdentifier: string): void {
  if (typeof window === "undefined") return;
  window.activeTerminalWindowId = windowIdentifier;

  if (!window.terminalCwdByWindow) {
    window.terminalCwdByWindow = {};
  }

  if (!window.terminalCwdByWindow[windowIdentifier]) {
    window.terminalCwdByWindow[windowIdentifier] = getHomePath();
  }
}

function clearCwd(windowIdentifier: string): void {
  if (typeof window === "undefined") return;
  if (!window.terminalCwdByWindow) return;
  delete window.terminalCwdByWindow[windowIdentifier];
  if (window.activeTerminalWindowId === windowIdentifier) {
    window.activeTerminalWindowId = undefined;
  }
}

async function cd(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/);

  let targetPath = args[1] || getHomePath();

  // Handle ~ for home directory
  if (targetPath === "~" || targetPath.startsWith("~/")) {
    targetPath = targetPath.replace("~", getHomePath());
  }

  // Handle .. for parent directory
  if (targetPath === "..") {
    targetPath = fs.getParentPath(getCwd());
  } else if (targetPath === ".") {
    targetPath = getCwd();
  } else if (!targetPath.startsWith("/")) {
    // Relative path
    targetPath = fs.normalizePath(`${getCwd()}/${targetPath}`);
  }

  targetPath = fs.normalizePath(targetPath);

  if (!fs.exists(targetPath)) {
    terminal.writeln(
      `\x1b[31mcd: ${args[1] || targetPath}: No such file or directory\x1b[0m`,
    );
    return;
  }

  if (!fs.isDirectory(targetPath)) {
    terminal.writeln(
      `\x1b[31mcd: ${args[1] || targetPath}: Not a directory\x1b[0m`,
    );
    return;
  }

  setCwd(targetPath, windowIdentifier);
}

export default cd satisfies CommandCallback;
export { clearCwd, getCwd, setActiveTerminalWindow, setCwd };

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  return getPathCompletions(currentToken, {
    includeFiles: false,
    includeDirs: true,
    includeHidden: true,
    appendDirSlash: true,
    includeDotDirs: true,
  });
};

export { autocomplete };
