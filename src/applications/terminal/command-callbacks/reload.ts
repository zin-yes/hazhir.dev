import type { Terminal } from "@xterm/xterm";

import type { CommandAutocomplete, CommandCallback } from "./index";
import { useSession } from "@/auth/client";

async function reload(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  location.reload();
}

export default reload satisfies CommandCallback;

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
