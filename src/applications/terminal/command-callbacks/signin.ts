import type { Terminal } from "@xterm/xterm";

import type { CommandAutocomplete, CommandCallback } from "./index";
import { signIn, useSession } from "next-auth/react";

import ansi from "ansi-escape-sequences";

async function signin(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>
): Promise<void> {
  if (session.status === "unauthenticated") {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln("Redirecting you to the sign in page...");
    terminal.writeln(" ".repeat(terminal.cols));

    signIn(undefined, { callbackUrl: "/" });
  } else {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln(
      ansi.style.red +
        "You are already signed in. To sign out use the " +
        ansi.style.black +
        "`" +
        ansi.style.gray +
        "signout" +
        ansi.style.black +
        "`" +
        ansi.style.red +
        "command." +
        ansi.style.reset
    );
    terminal.writeln(" ".repeat(terminal.cols));
  }
}

export default signin satisfies CommandCallback;

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
