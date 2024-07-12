import type { Terminal } from "@xterm/xterm";

import { clear } from "./clear";
import { help } from "./help";

const commandCallbacks: Record<
  string,
  (terminal: Terminal, commandLinePrefix: string) => Promise<void>
> = {
  clear: clear,
  help: help,
};

export default commandCallbacks;
