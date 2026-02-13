import type { Terminal } from "@xterm/xterm";

import { humanFileSize } from "@/applications/file-explorer";
import { useSession } from "@/auth/client";
import { FileSystemNode, useFileSystem } from "@/hooks/use-file-system";
import { getHomePath } from "@/lib/system-user";
import { parseCommandArguments } from "./args";
import { getPathCompletions } from "./autocomplete";
import { getCwd } from "./cd";
import type { CommandAutocomplete, CommandCallback } from "./index";

async function ls(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/).slice(1);

  const supportedShort = new Set(["a", "l", "s"]);
  const supportedLong = new Set(["--all", "--list", "--size"]);
  const invalidOption = args.find((arg) => {
    if (!arg.startsWith("-") || arg === "-") return false;
    if (arg.startsWith("--")) {
      return !supportedLong.has(arg);
    }

    return arg
      .slice(1)
      .split("")
      .some((flag) => !supportedShort.has(flag));
  });

  if (invalidOption) {
    const invalidFlag = invalidOption.startsWith("--")
      ? invalidOption.slice(2)
      : invalidOption
          .slice(1)
          .split("")
          .find((flag) => !supportedShort.has(flag)) ?? invalidOption.slice(1);

    terminal.writeln(`\x1b[31mls: invalid option -- '${invalidFlag}'\x1b[0m`);
    terminal.writeln("Try 'help ls' for more information.");
    return;
  }

  const { options, positionals } = parseCommandArguments(args, {
    shortToLong: {
      a: "all",
      l: "list",
      s: "size",
    },
    longOnly: ["all", "list", "size"],
  });

  const showAll = options.has("all");
  const longFormat = options.has("list");
  const showSize = options.has("size");
  let targetPath: string | null = positionals[0] ?? null;

  if (targetPath === null) {
    targetPath = getCwd();
  } else if (targetPath === "~" || targetPath.startsWith("~/")) {
    targetPath = targetPath.replace("~", getHomePath());
  } else if (!targetPath.startsWith("/")) {
    targetPath = fs.normalizePath(`${getCwd()}/${targetPath}`);
  }

  targetPath = fs.normalizePath(targetPath);

  if (!fs.exists(targetPath)) {
    terminal.writeln(
      `\x1b[31mls: cannot access '${targetPath}': No such file or directory\x1b[0m`,
    );
    return;
  }

  if (!fs.isDirectory(targetPath)) {
    const node = fs.getNode(targetPath);
    if (node) {
      if (longFormat) {
        printLongFormat(terminal, node);
      } else {
        terminal.writeln(node.name);
      }
    }
    return;
  }

  const items = fs.getChildren(targetPath, true).filter((item) => {
    const hidden = item.isHidden || item.name.startsWith(".");
    return showAll || !hidden;
  });

  terminal.writeln("");

  if (longFormat) {
    terminal.writeln(`total ${items.length}`);
    items.forEach((item) => {
      printLongFormat(terminal, item);
    });
  } else {
    if (items.length === 0) {
      // Empty directory
    } else {
      if (showSize) {
        items.forEach((item) => {
          const color = item.type === "directory" ? "\x1b[34m" : "\x1b[0m";
          const reset = "\x1b[0m";
          const size = humanFileSize(item.size).padStart(9);
          terminal.writeln(`${size}  ${color}${item.name}${reset}`);
        });
      } else {
        const line = items
          .map((item) => {
            const color = item.type === "directory" ? "\x1b[34m" : "\x1b[0m";
            const reset = "\x1b[0m";
            return `${color}${item.name}${reset}`;
          })
          .join("  ");

        terminal.writeln(line);
      }
    }
  }

  terminal.writeln("");
}

function printLongFormat(terminal: Terminal, item: FileSystemNode) {
  const typeChar = item.type === "directory" ? "d" : "-";
  const perms = item.permissions;
  const owner = item.owner.padEnd(8);
  const group = item.group.padEnd(8);
  const size = humanFileSize(item.size).padStart(8);
  const date = new Date(item.modifiedAt);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const color = item.type === "directory" ? "\x1b[34m" : "\x1b[0m";
  const reset = "\x1b[0m";

  terminal.writeln(
    `${typeChar}${perms} ${owner} ${group} ${size} ${dateStr} ${color}${item.name}${reset}`,
  );
}

export default ls satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  const flags = [
    "-a",
    "-l",
    "-s",
    "-la",
    "-al",
    "-ls",
    "-sl",
    "-als",
    "-asl",
    "--all",
    "--list",
    "--size",
  ];
  if (currentToken.startsWith("-")) {
    return flags.filter((flag) => flag.startsWith(currentToken));
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
