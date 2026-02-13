import type { Terminal } from "@xterm/xterm";

import { useFileSystem } from "@/hooks/use-file-system";
import { useSession } from "@/auth/client";
import type { CommandAutocomplete, CommandCallback } from "./index";
import { getCwd } from "./cd";
import { getPathCompletions } from "./autocomplete";

async function source(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const fs = useFileSystem();
  const args = fullCommand.trim().split(/\s+/);
  const target = args[1] ?? "~/terminal_rc";

  let targetPath = target;
  if (targetPath.startsWith("~")) {
    targetPath = targetPath.replace("~", "/home/user");
  } else if (!targetPath.startsWith("/")) {
    targetPath = fs.normalizePath(`${getCwd()}/${targetPath}`);
  }

  targetPath = fs.normalizePath(targetPath);

  if (!fs.exists(targetPath)) {
    terminal.writeln(`\x1b[31msource: ${target}: No such file or directory\x1b[0m`);
    return;
  }

  const node = fs.getNode(targetPath);
  if (node?.type === "directory") {
    terminal.writeln(`\x1b[31msource: ${target}: Is a directory\x1b[0m`);
    return;
  }

  const contents = fs.getFileContents(targetPath) ?? "";
  const lines = contents.split("\n");

  const { executeCommandLine } = await import("../command-line-routine");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    await executeCommandLine(trimmed, terminal, session, windowIdentifier, {
      writePrompt: false,
    });
  }
}

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  if (currentToken.length === 0) return ["~/terminal_rc"];
  const base = getPathCompletions(currentToken, {
    includeFiles: true,
    includeDirs: false,
    includeHidden: true,
    appendDirSlash: false,
  });
  const suggestions = ["~/terminal_rc", ...base];
  return suggestions.filter((item) => item.startsWith(currentToken));
};

export default source satisfies CommandCallback;
export { autocomplete };
