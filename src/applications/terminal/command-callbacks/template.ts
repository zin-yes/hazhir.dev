import type { Terminal } from "@xterm/xterm";

import type { CommandAutocomplete, CommandCallback } from "./index";
import { useSession } from "@/auth/client";

async function template(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {}

export default template satisfies CommandCallback;

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
