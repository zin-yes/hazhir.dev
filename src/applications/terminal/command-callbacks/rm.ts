import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { useFileSystem } from "@/hooks/use-file-system";
import { getHomePath } from "@/lib/system-user";
import { getPathCompletions } from "./autocomplete";
import { getCwd } from "./cd";
import type { CommandAutocomplete, CommandCallback } from "./index";

function resolvePath(
  fs: ReturnType<typeof useFileSystem>,
  value: string,
): string {
  if (value === "~" || value.startsWith("~/")) {
    return fs.normalizePath(value.replace("~", getHomePath()));
  }
  if (value.startsWith("/")) {
    return fs.normalizePath(value);
  }
  return fs.normalizePath(`${getCwd()}/${value}`);
}

async function rm(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/);

  if (args.length < 2) {
    terminal.writeln("\x1b[31mrm: missing operand\x1b[0m");
    return;
  }

  const recursive =
    args.includes("-r") || args.includes("-rf") || args.includes("-R");
  const force = args.includes("-f") || args.includes("-rf");
  const names = args.slice(1).filter((a) => !a.startsWith("-"));

  for (const name of names) {
    const targetPath = resolvePath(fs, name);

    if (!fs.exists(targetPath)) {
      if (!force) {
        terminal.writeln(
          `\x1b[31mrm: cannot remove '${name}': No such file or directory\x1b[0m`,
        );
      }
      continue;
    }

    const node = fs.getNode(targetPath);
    if (node?.type === "directory" && !recursive) {
      terminal.writeln(
        `\x1b[31mrm: cannot remove '${name}': Is a directory\x1b[0m`,
      );
      continue;
    }

    // Protect system directories
    const protectedPaths = ["/", "/home", getHomePath(), "/applications"];
    if (protectedPaths.includes(targetPath)) {
      terminal.writeln(
        `\x1b[31mrm: cannot remove '${name}': Permission denied\x1b[0m`,
      );
      continue;
    }

    if (!fs.deleteNode(targetPath)) {
      terminal.writeln(
        `\x1b[31mrm: cannot remove '${name}': Permission denied\x1b[0m`,
      );
    }
  }
}

export default rm satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  if (currentToken.startsWith("-")) {
    return ["-r", "-R", "-f", "-rf"].filter((flag) =>
      flag.startsWith(currentToken),
    );
  }

  return getPathCompletions(currentToken, {
    includeFiles: true,
    includeDirs: true,
    includeHidden: true,
    appendDirSlash: true,
    includeDotDirs: true,
  });
};

export { autocomplete };
