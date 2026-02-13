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

async function touch(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/);
  
  if (args.length < 2) {
    terminal.writeln("\x1b[31mtouch: missing file operand\x1b[0m");
    return;
  }
  
  const names = args.slice(1);
  
  for (const name of names) {
    const targetPath = resolvePath(fs, name);
    
    if (fs.exists(targetPath)) {
      // File exists, just update timestamp (simulated)
      continue;
    }
    
    const parentPath = fs.getParentPath(targetPath);
    const fileName = fs.getNodeName(targetPath);
    
    if (!fs.exists(parentPath)) {
      terminal.writeln(`\x1b[31mtouch: cannot touch '${name}': No such file or directory\x1b[0m`);
      continue;
    }
    
    if (!fs.createFile(parentPath, fileName, "")) {
      terminal.writeln(`\x1b[31mtouch: cannot touch '${name}': Permission denied\x1b[0m`);
    }
  }
}

export default touch satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  return getPathCompletions(currentToken, {
    includeFiles: true,
    includeDirs: true,
    includeHidden: true,
    appendDirSlash: true,
    includeDotDirs: true,
  });
};

export { autocomplete };
