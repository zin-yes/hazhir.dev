import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { getCwd } from "./cd";
import type { CommandAutocomplete, CommandCallback } from "./index";

async function pwd(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  terminal.writeln(getCwd());
}

export default pwd satisfies CommandCallback;

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
