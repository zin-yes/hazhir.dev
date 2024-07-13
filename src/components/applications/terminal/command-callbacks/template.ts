import type { Terminal } from "@xterm/xterm";

import type { CommandCallback } from "./index";

async function template(
  fullCommand: string,
  terminal: Terminal
): Promise<void> {}

export default template satisfies CommandCallback;
