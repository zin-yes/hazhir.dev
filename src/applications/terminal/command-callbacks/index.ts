import type { Terminal } from "@xterm/xterm";

import clear from "./clear";
import help from "./help";
import { useSession } from "next-auth/react";
import signin from "./signin";
import signout from "./signout";
import exit from "./exit";
import application from "./application";
import reload from "./reload";
import session from "./session";

export type CommandCallback = (
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
) => Promise<void>;

const commandCallbacks: Record<string, CommandCallback> = {
  clear: clear,
  help: help,
  signin: signin,
  signout: signout,
  exit: exit,
  application: application,
  reload: reload,
  session: session,
};

export default commandCallbacks;
