import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { useFileSystem } from "@/hooks/use-file-system";
import { getHomePath } from "@/lib/system-user";
import { getPathCompletions } from "./autocomplete";
import { getCwd } from "./cd";
import type { CommandAutocomplete, CommandCallback } from "./index";

function resolvePath(fs: ReturnType<typeof useFileSystem>, value: string): string {
  if (value === "~" || value.startsWith("~/")) {
    return fs.normalizePath(value.replace("~", getHomePath()));
  }
  if (value.startsWith("/")) {
    return fs.normalizePath(value);
  }
  return fs.normalizePath(`${getCwd()}/${value}`);
}

async function cp(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/);

  if (args.length < 3) {
    terminal.writeln("\x1b[31mcp: missing file operand\x1b[0m");
    return;
  }

  const sourcePath = resolvePath(fs, args[1]);
  const destinationPath = resolvePath(fs, args[2]);

  if (!fs.exists(sourcePath)) {
    terminal.writeln(`\x1b[31mcp: cannot stat '${args[1]}': No such file or directory\x1b[0m`);
    return;
  }

  if (!fs.exists(destinationPath)) {
    terminal.writeln(`\x1b[31mcp: cannot create copy in '${args[2]}': No such directory\x1b[0m`);
    return;
  }

  if (!fs.isDirectory(destinationPath)) {
    terminal.writeln(`\x1b[31mcp: target '${args[2]}' is not a directory\x1b[0m`);
    return;
  }

  if (!fs.copy(sourcePath, destinationPath)) {
    terminal.writeln(`\x1b[31mcp: cannot copy '${args[1]}' to '${args[2]}': Permission denied\x1b[0m`);
  }
}

export default cp satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentIndex, currentToken }) => {
  if (currentIndex <= 1) {
    return getPathCompletions(currentToken, {
      includeFiles: true,
      includeDirs: true,
      includeHidden: true,
      appendDirSlash: true,
    });
  }

  return getPathCompletions(currentToken, {
    includeFiles: false,
    includeDirs: true,
    includeHidden: true,
    appendDirSlash: true,
  });
};

export { autocomplete };
