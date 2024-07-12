import type { Terminal } from "@xterm/xterm";

export async function clear(terminal: Terminal) {
  terminal.reset();
}
