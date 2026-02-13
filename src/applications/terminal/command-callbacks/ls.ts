import type { Terminal } from "@xterm/xterm";

import { humanFileSize } from "@/applications/file-explorer";
import { FileSystemNode, useFileSystem } from "@/hooks/use-file-system";
import { useSession } from "@/auth/client";
import { getCwd } from "./cd";
import type { CommandAutocomplete, CommandCallback } from "./index";
import { getPathCompletions } from "./autocomplete";

async function ls(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/);
  
  // Parse flags
  const showAll = args.includes("-a") || args.includes("-la") || args.includes("-al");
  const longFormat = args.includes("-l") || args.includes("-la") || args.includes("-al");
  
  // Get path argument (ignore flags), default to current working directory
  let targetPath: string | null = null;
  for (let i = 1; i < args.length; i++) {
    if (!args[i].startsWith("-")) {
      targetPath = args[i];
      break;
    }
  }
  
  // Use current working directory if no path specified
  if (targetPath === null) {
    targetPath = getCwd();
  } else if (targetPath === "~" || targetPath.startsWith("~/")) {
    targetPath = targetPath.replace("~", "/home/user");
  } else if (!targetPath.startsWith("/")) {
    // Relative path - resolve from cwd
    targetPath = fs.normalizePath(`${getCwd()}/${targetPath}`);
  }
  
  targetPath = fs.normalizePath(targetPath);
  
  if (!fs.exists(targetPath)) {
    terminal.writeln(`\x1b[31mls: cannot access '${targetPath}': No such file or directory\x1b[0m`);
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
  
  const items = fs
    .getChildren(targetPath, true)
    .filter((item) => showAll || !item.isHidden || item.name === ".terminal_history");
  
  terminal.writeln("");
  
  if (longFormat) {
    terminal.writeln(`total ${items.length}`);
    items.forEach((item) => {
      printLongFormat(terminal, item);
    });
  } else {
    // Grid format
    if (items.length === 0) {
      // Empty directory - do nothing
    } else {
      const maxNameLength = Math.max(...items.map(i => i.name.length), 10);
      const colWidth = maxNameLength + 2;
      const cols = Math.max(1, Math.floor(terminal.cols / colWidth));
      
      for (let i = 0; i < items.length; i += cols) {
        const row = items.slice(i, i + cols);
        const line = row.map((item) => {
          const color = item.type === "directory" ? "\x1b[34m" : "\x1b[0m";
          const reset = "\x1b[0m";
          const name = item.name.padEnd(colWidth);
          return `${color}${name}${reset}`;
        }).join("");
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
  
  terminal.writeln(`${typeChar}${perms} ${owner} ${group} ${size} ${dateStr} ${color}${item.name}${reset}`);
}

export default ls satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  const flags = ["-a", "-l", "-la", "-al"];
  if (currentToken.startsWith("-")) {
    return flags.filter((flag) => flag.startsWith(currentToken));
  }

  return getPathCompletions(currentToken, {
    includeFiles: true,
    includeDirs: true,
    includeHidden: true,
    appendDirSlash: true,
  });
};

export { autocomplete };
