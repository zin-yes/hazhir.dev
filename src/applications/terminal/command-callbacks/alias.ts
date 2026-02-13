import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import { getAliases, removeAlias, setAlias } from "../shell-state";
import type { CommandAutocomplete, CommandCallback } from "./index";

async function alias(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>
): Promise<void> {
  const args = fullCommand.trim().slice("alias".length).trim();

  if (args.length === 0) {
    const aliases = getAliases();
    const names = Object.keys(aliases);
    if (names.length === 0) return;
    names.forEach((name) => {
      terminal.writeln(`alias ${name}='${aliases[name]}'`);
    });
    return;
  }

  const unsetMatch = args.match(/^-(u|d)\s+(\S+)/);
  if (unsetMatch) {
    removeAlias(unsetMatch[2]);
    return;
  }

  const eqIndex = args.indexOf("=");
  if (eqIndex === -1) {
    const aliases = getAliases();
    const value = aliases[args];
    if (value !== undefined) {
      terminal.writeln(`alias ${args}='${value}'`);
    }
    return;
  }

  const name = args.slice(0, eqIndex).trim();
  let value = args.slice(eqIndex + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  if (name.length > 0) {
    setAlias(name, value);
  }
}

const autocomplete: CommandAutocomplete = ({ currentIndex, currentToken }) => {
  if (currentIndex === 0) {
    const flags = ["-u", "-d"];
    const names = Object.keys(getAliases());
    return [...flags, ...names].filter((item) => item.startsWith(currentToken));
  }
  return [];
};

export default alias satisfies CommandCallback;
export { autocomplete };
