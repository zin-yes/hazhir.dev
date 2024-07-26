import type { Terminal } from "@xterm/xterm";

import type { CommandCallback } from "./index";
import { useSession } from "next-auth/react";

async function template(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {}

export default template satisfies CommandCallback;
