import type { Terminal } from "@xterm/xterm";

import { signOut, useSession } from "@/auth/client";
import type { CommandAutocomplete, CommandCallback } from "./index";

import ansi from "ansi-escape-sequences";

async function template(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>
): Promise<void> {
  if (session.status === "authenticated") {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln(
      session.isGuest
        ? "Ending guest session and returning to login screen..."
        : "Signing you out, and refreshing the page..."
    );
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

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
