import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { useFileSystem } from "@/hooks/use-file-system";
import { requestLaunchApplication } from "@/lib/application-launcher";
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

function parseFirstArg(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const first = value[0];
  if (first !== '"' && first !== "'") {
    return value.split(/\s+/)[0] ?? null;
  }

  let escaped = false;
  let result = "";
  for (let i = 1; i < value.length; i += 1) {
    const character = value[i];
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === first) {
      return result;
    }
    result += character;
  }

  return null;
}

async function documentViewer(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
): Promise<void> {
  const fs = useFileSystem();
  const trimmed = fullCommand.trim();
  const firstSpaceIndex = trimmed.indexOf(" ");
  const remainder =
    firstSpaceIndex === -1 ? "" : trimmed.slice(firstSpaceIndex + 1);
  const arg = parseFirstArg(remainder);

  if (!arg) {
    requestLaunchApplication("document-viewer");
    return;
  }

  const targetPath = resolvePath(fs, arg);
  const existing = fs.getNode(targetPath);

  if (!existing) {
    terminal.writeln(
      `\x1b[31mdocument-viewer: ${arg}: No such file or directory\x1b[0m`,
    );
    return;
  }

  if (existing.type === "directory") {
    terminal.writeln(
      `\x1b[31mdocument-viewer: ${arg}: Is a directory\x1b[0m`,
    );
    return;
  }

  if (!existing.name.endsWith(".document")) {
    terminal.writeln(
      `\x1b[31mdocument-viewer: ${arg}: Not a .document file\x1b[0m`,
    );
    return;
  }

  requestLaunchApplication("document-viewer", [targetPath, existing.name]);
}

export default documentViewer satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  const completions = getPathCompletions(currentToken, {
    includeFiles: true,
    includeDirs: true,
    includeHidden: false,
    appendDirSlash: true,
    includeDotDirs: true,
  });

  return completions.filter((item) => {
    if (item.endsWith("/")) return true;
    return item.endsWith(".document");
  });
};

export { autocomplete };
