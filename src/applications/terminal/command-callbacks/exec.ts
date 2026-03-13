import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import type { CommandAutocomplete, CommandCallback } from "./index";

async function exec(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
): Promise<void> {
  const args = fullCommand.trim().split(/\s+/);
  const commandString = args.slice(1).join(" ");

  if (!commandString) {
    terminal.writeln("\x1b[31mexec: missing command operand\x1b[0m");
    return;
  }

  const { executeCommandLine } = await import("../command-line-routine");
  await executeCommandLine(commandString, terminal, session, windowIdentifier, {
    writePrompt: false,
  });
}

export default exec satisfies CommandCallback;

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
