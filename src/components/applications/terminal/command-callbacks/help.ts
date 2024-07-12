import type { Terminal } from "@xterm/xterm";

export async function help(terminal: Terminal) {
  terminal.writeln("");
  terminal.writeln("");
  terminal.writeln("help command");
  terminal.writeln("");
}
