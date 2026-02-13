import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { useFileSystem } from "@/hooks/use-file-system";
import { getPathCompletions } from "./autocomplete";
import { getCwd } from "./cd";
import type { CommandAutocomplete, CommandCallback } from "./index";

async function mkdir(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/);
  
  if (args.length < 2) {
    terminal.writeln("\x1b[31mmkdir: missing operand\x1b[0m");
    return;
  }
  
  const createParents = args.includes("-p");
  const names = args.slice(1).filter(a => !a.startsWith("-"));
  
  for (const name of names) {
    let targetPath: string;
    
    if (name.startsWith("/")) {
      targetPath = fs.normalizePath(name);
    } else {
      targetPath = fs.normalizePath(`${getCwd()}/${name}`);
    }
    
    const parentPath = fs.getParentPath(targetPath);
    const dirName = fs.getNodeName(targetPath);
    
    if (!createParents && !fs.exists(parentPath)) {
      terminal.writeln(`\x1b[31mmkdir: cannot create directory '${name}': No such file or directory\x1b[0m`);
      continue;
    }
    
    if (fs.exists(targetPath)) {
      terminal.writeln(`\x1b[31mmkdir: cannot create directory '${name}': File exists\x1b[0m`);
      continue;
    }
    
    // Create parent directories if -p flag is set
    if (createParents) {
      const parts = targetPath.split("/").filter(Boolean);
      let currentPath = "";
      for (const part of parts) {
        currentPath += "/" + part;
        if (!fs.exists(currentPath)) {
          const parent = fs.getParentPath(currentPath);
                  if (!fs.createDirectory(parent, part)) {
                    terminal.writeln(
                      `\x1b[31mmkdir: cannot create directory '${name}': Permission denied\x1b[0m`
                    );
                    break;
                  }
        }
      }
    } else {
      if (!fs.createDirectory(parentPath, dirName)) {
        terminal.writeln(
          `\x1b[31mmkdir: cannot create directory '${name}': Permission denied\x1b[0m`
        );
      }
    }
  }
}

export default mkdir satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  if (currentToken.startsWith("-")) {
    return ["-p"].filter((flag) => flag.startsWith(currentToken));
  }

  return getPathCompletions(currentToken, {
    includeFiles: false,
    includeDirs: true,
    includeHidden: true,
    appendDirSlash: true,
  });
};

export { autocomplete };
