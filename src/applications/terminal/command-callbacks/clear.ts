import type { Terminal } from "@xterm/xterm";
import type { CommandAutocomplete, CommandCallback } from "./index";

async function clear(fullCommand: string, terminal: Terminal): Promise<void> {
  terminal.reset();
}

export default clear satisfies CommandCallback;

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
