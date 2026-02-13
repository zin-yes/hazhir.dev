import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { SYSTEM_APPS } from "@/config/system-file-system";
import { useFileSystem } from "@/hooks/use-file-system";
import { executeFilePath } from "@/lib/file-execution";
import { getHomePath } from "@/lib/system-user";
import commands from "../commands.json";
import { getPathCompletions } from "./autocomplete";
import { getCwd } from "./cd";
import type { CommandAutocomplete, CommandCallback } from "./index";

function hasAlias(aliases: unknown, name: string): boolean {
  return Array.isArray(aliases) && (aliases as string[]).includes(name);
}

function resolvePath(fs: ReturnType<typeof useFileSystem>, value: string): string {
  if (value === "~" || value.startsWith("~/")) {
    return fs.normalizePath(value.replace("~", getHomePath()));
  }
  if (value.startsWith("/")) {
    return fs.normalizePath(value);
  }
  return fs.normalizePath(`${getCwd()}/${value}`);
}

async function runApp(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const fs = useFileSystem();
  const parts = fullCommand.trim().split(/\s+/);
  const commandName = parts[0];
  const launchArgs = parts.slice(1);

  const commandMeta = commands.find(
    (entry) => entry.name === commandName || hasAlias(entry.aliases, commandName),
  );

  const resolvedAppId =
    commandMeta?.callbackFunctionName === "runApp"
      ? commandMeta.name
      : commandName;

  const app = SYSTEM_APPS.find((entry) => entry.id === resolvedAppId);
  if (!app) {
    terminal.writeln(`\x1b[31m${commandName}: app command not found\x1b[0m`);
    return;
  }

  const normalizedLaunchArgs: string[] = [];

  if (app.id === "file-explorer" && launchArgs[0]) {
    const initialPath = resolvePath(fs, launchArgs[0]);
    if (!fs.exists(initialPath)) {
      terminal.writeln(
        `\x1b[31mfile-explorer: ${launchArgs[0]}: No such file or directory\x1b[0m`,
      );
      return;
    }

    if (!fs.isDirectory(initialPath)) {
      terminal.writeln(`\x1b[31mfile-explorer: ${launchArgs[0]}: Not a directory\x1b[0m`);
      return;
    }

    normalizedLaunchArgs.push(initialPath);
  } else {
    normalizedLaunchArgs.push(...launchArgs);
  }

  const result = executeFilePath(
    `/applications/${app.executableName}`,
    fs,
    normalizedLaunchArgs,
  );
  if (!result.ok && result.message) {
    terminal.writeln(`\x1b[31m${result.message}\x1b[0m`);
  }
}

export default runApp satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({
  commandName,
  args,
  currentIndex,
  currentToken,
}) => {
  const invokedByAppCommand =
    commandName !== "run-app" && SYSTEM_APPS.some((app) => app.id === commandName);

  if (invokedByAppCommand && commandName === "file-explorer") {
    return getPathCompletions(currentToken, {
      includeFiles: false,
      includeDirs: true,
      includeHidden: true,
      appendDirSlash: true,
      includeDotDirs: true,
    });
  }

  if (currentIndex === 0) {
    if (args.length > 0 && currentToken.length > 0) {
      return getPathCompletions(currentToken, {
        includeFiles: false,
        includeDirs: true,
        includeHidden: true,
        appendDirSlash: true,
        includeDotDirs: true,
      });
    }

    return SYSTEM_APPS.map((app) => app.id).filter((id) => id.startsWith(currentToken));
  }

  if (currentIndex === 1) {
    return getPathCompletions(currentToken, {
      includeFiles: false,
      includeDirs: true,
      includeHidden: true,
      appendDirSlash: true,
      includeDotDirs: true,
    });
  }

  return [];
};

export { autocomplete };
