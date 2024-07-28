import type { Terminal } from "@xterm/xterm";

import type { CommandCallback } from "./index";
import { signOut, useSession } from "next-auth/react";

import ansi from "ansi-escape-sequences";

async function template(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>
): Promise<void> {
  if (session.status === "authenticated") {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln("Signing you out, and refreshing the page...");
    terminal.writeln(" ".repeat(terminal.cols));

    signOut({ callbackUrl: "/" });
  } else {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln(
      ansi.style.red +
        "You are not signed in, to sign in use the " +
        ansi.style.black +
        "`" +
        ansi.style.gray +
        "signin" +
        ansi.style.black +
        "`" +
        ansi.style.red +
        "command." +
        ansi.style.reset
    );
    terminal.writeln(" ".repeat(terminal.cols));
  }
}

export default template satisfies CommandCallback;
