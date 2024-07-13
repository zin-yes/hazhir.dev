import type { Terminal } from "@xterm/xterm";

import clear from "./clear";
import help from "./help";

export type CommandCallback = (
  fullCommand: string,
  terminal: Terminal
) => Promise<void>;

const commandCallbacks: Record<string, CommandCallback> = {
  clear: clear,
  help: help,
};

export default commandCallbacks;
