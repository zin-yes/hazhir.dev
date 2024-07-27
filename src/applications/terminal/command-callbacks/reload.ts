import type { Terminal } from "@xterm/xterm";

import type { CommandCallback } from "./index";
import { useSession } from "next-auth/react";

async function reload(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  location.reload();
}

export default reload satisfies CommandCallback;
