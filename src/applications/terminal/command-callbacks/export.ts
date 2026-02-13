import type { Terminal } from "@xterm/xterm";

import type { CommandAutocomplete, CommandCallback } from "./index";
import { getAllEnv, setEnvVar } from "../shell-state";
import { useSession } from "@/auth/client";

async function exportCommand(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>
): Promise<void> {
  const args = fullCommand.trim().slice("export".length).trim();

  if (args.length === 0) {
    const env = getAllEnv();
    Object.keys(env).forEach((key) => {
      terminal.writeln(`${key}=${env[key]}`);
    });
    return;
  }

  const parts = args.split(/\s+/);
  parts.forEach((part) => {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) {
      setEnvVar(part, "");
      return;
    }
    const key = part.slice(0, eqIndex);
    const value = part.slice(eqIndex + 1);
    if (key.length > 0) {
      setEnvVar(key, value);
    }
  });
}

const autocomplete: CommandAutocomplete = ({ currentToken }) => {
  const env = getAllEnv();
  const keys = Object.keys(env).map((key) => `${key}=`);
  return keys.filter((item) => item.startsWith(currentToken));
};

export default exportCommand satisfies CommandCallback;
export { autocomplete };
