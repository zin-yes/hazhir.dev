import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import type { CommandAutocomplete, CommandCallback } from "./index";

import commands from "../commands.json";

import { all, createEmphasize } from "emphasize";


async function session(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const trimmedCommand = fullCommand.trim();

  if (trimmedCommand.toLowerCase().startsWith("session status")) {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln("Session status: " + session.status);
    if (session.status === "authenticated") {
      terminal.writeln("Auth mode: " + (session.isGuest ? "guest" : "user"));
    }
    terminal.writeln(" ".repeat(terminal.cols));
  } else if (trimmedCommand.toLowerCase().startsWith("session data")) {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln(
      createEmphasize(all).highlight(
        "json",
        JSON.stringify(session.data ?? {}, null, 2)
      ).value
    );
    terminal.writeln(" ".repeat(terminal.cols));
  } else {
    const commandInfo = commands.find((command) => command.name === "session");
    throw new Error(
      "Incorrect command usage; usage & examples: \n\nUsage(s):\n - " +
        commandInfo?.usage.join("\n - ") +
        "\n\nExample(s):\n - " +
        commandInfo?.examples.join("\n - ")
    );
  }
}

export default session satisfies CommandCallback;

const autocomplete: CommandAutocomplete = ({ currentIndex, currentToken }) => {
  if (currentIndex === 0) {
    return ["status", "data"].filter((item) => item.startsWith(currentToken));
  }
  return [];
};

export { autocomplete };
