import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { useFileSystem } from "@/hooks/use-file-system";
import { getPathCompletions } from "./autocomplete";
import { getCwd } from "./cd";
import type { CommandAutocomplete, CommandCallback } from "./index";

async function cat(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/);
  
  if (args.length < 2) {
    terminal.writeln("\x1b[31mcat: missing file operand\x1b[0m");
    return;
  }
  
  const names = args.slice(1);
  
  for (const name of names) {
    let targetPath: string;
    
    if (name.startsWith("/")) {
      targetPath = fs.normalizePath(name);
    } else {
      targetPath = fs.normalizePath(`${getCwd()}/${name}`);
    }
    
    if (!fs.exists(targetPath)) {
      terminal.writeln(`\x1b[31mcat: ${name}: No such file or directory\x1b[0m`);
      continue;
    }
    
    const node = fs.getNode(targetPath);
    if (node?.type === "directory") {
      terminal.writeln(`\x1b[31mcat: ${name}: Is a directory\x1b[0m`);
      continue;
    }
    
    const contents = fs.getFileContents(targetPath);
    if (contents !== undefined) {
      const lines = contents.split("\n");
      lines.forEach(line => {
        terminal.writeln(line);
      });
    }
  }
}

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  return getPathCompletions(currentToken, {
    includeFiles: true,
    includeDirs: false,
    includeHidden: true,
    appendDirSlash: false,
  });
};

export default cat satisfies CommandCallback;
export { autocomplete };
