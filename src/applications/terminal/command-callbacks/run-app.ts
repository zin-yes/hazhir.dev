import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { SYSTEM_APPS } from "@/config/system-file-system";
import { useFileSystem } from "@/hooks/use-file-system";
import { executeFilePath } from "@/lib/file-execution";
import commands from "../commands.json";
import type { CommandAutocomplete, CommandCallback } from "./index";

async function runApp(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const fs = useFileSystem();
  const [commandName] = fullCommand.trim().split(/\s+/);

  const commandMeta = commands.find(
    (entry) => entry.name === commandName || entry.aliases.includes(commandName)
  );

  const resolvedAppId =
    commandMeta?.callbackFunctionName === "runApp"
      ? commandMeta.name
      : commandName;

  const app = SYSTEM_APPS.find((entry) => entry.id === resolvedAppId);
  if (!app) {
    terminal.writeln(`\x1b[31m${commandName}: app command not found\x1b[0m`);
    return;
  }

  const result = executeFilePath(`/applications/${app.executableName}`, fs);
  if (!result.ok && result.message) {
    terminal.writeln(`\x1b[31m${result.message}\x1b[0m`);
  }
}

export default runApp satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentIndex, currentToken }) => {
  if (currentIndex > 0) return [];
  return SYSTEM_APPS.map((app) => app.id).filter((id) => id.startsWith(currentToken));
};

export { autocomplete };
