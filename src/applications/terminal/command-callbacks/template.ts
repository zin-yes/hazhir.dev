import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import type { CommandAutocomplete, CommandCallback } from "./index";

async function template(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {}

export default template satisfies CommandCallback;

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
