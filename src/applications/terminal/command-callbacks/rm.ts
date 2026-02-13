import type { Terminal } from "@xterm/xterm";

import { useFileSystem } from "@/hooks/use-file-system";
import { useSession } from "@/auth/client";
import { getCwd } from "./cd";
import type { CommandAutocomplete, CommandCallback } from "./index";
import { getPathCompletions } from "./autocomplete";

async function rm(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/);
  
  if (args.length < 2) {
    terminal.writeln("\x1b[31mrm: missing operand\x1b[0m");
    return;
  }
  
  const recursive = args.includes("-r") || args.includes("-rf") || args.includes("-R");
  const force = args.includes("-f") || args.includes("-rf");
  const names = args.slice(1).filter(a => !a.startsWith("-"));
  
  for (const name of names) {
    let targetPath: string;
    
    if (name.startsWith("/")) {
      targetPath = fs.normalizePath(name);
    } else {
      targetPath = fs.normalizePath(`${getCwd()}/${name}`);
    }
    
    if (!fs.exists(targetPath)) {
      if (!force) {
        terminal.writeln(`\x1b[31mrm: cannot remove '${name}': No such file or directory\x1b[0m`);
      }
      continue;
    }
    
    const node = fs.getNode(targetPath);
    if (node?.type === "directory" && !recursive) {
      terminal.writeln(`\x1b[31mrm: cannot remove '${name}': Is a directory\x1b[0m`);
      continue;
    }
    
    // Protect system directories
    const protectedPaths = ["/", "/home", "/etc", "/usr", "/var", "/tmp"];
    if (protectedPaths.includes(targetPath)) {
      terminal.writeln(`\x1b[31mrm: cannot remove '${name}': Permission denied\x1b[0m`);
      continue;
    }
    
    fs.deleteNode(targetPath);
  }
}

export default rm satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  if (currentToken.startsWith("-")) {
    return ["-r", "-R", "-f", "-rf"].filter((flag) => flag.startsWith(currentToken));
  }

  return getPathCompletions(currentToken, {
    includeFiles: true,
    includeDirs: true,
    includeHidden: true,
    appendDirSlash: true,
  });
};

export { autocomplete };
