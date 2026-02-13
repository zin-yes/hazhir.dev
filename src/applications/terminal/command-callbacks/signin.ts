import type { Terminal } from "@xterm/xterm";

import {
    requestSignInModal,
    signInAsGuest,
    useSession,
} from "@/auth/client";
import type { CommandAutocomplete, CommandCallback } from "./index";

import ansi from "ansi-escape-sequences";

async function signin(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>
): Promise<void> {
  const args = fullCommand.trim().split(/\s+/).slice(1);
  const provider = (args[0] || "modal").toLowerCase();

  if (provider !== "google" && provider !== "guest" && provider !== "modal") {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln(
      ansi.style.red +
        "Unsupported sign-in method. Use " +
        ansi.style.black +
        "`" +
        ansi.style.gray +
        "signin" +
        ansi.style.black +
        "`" +
        ansi.style.red +
        " or " +
        ansi.style.black +
        "`" +
        ansi.style.gray +
        "signin guest" +
        ansi.style.black +
        "`" +
        ansi.style.red +
        "." +
        ansi.style.reset
    );
    terminal.writeln(" ".repeat(terminal.cols));
    return;
  }

  if (provider === "modal" || provider === "google") {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln("Opening sign in modal...");
    terminal.writeln(" ".repeat(terminal.cols));

    requestSignInModal();
    location.assign("/");
    return;
  }

  if (session.status === "unauthenticated") {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln("Starting a temporary guest session...");
    terminal.writeln(" ".repeat(terminal.cols));

    signInAsGuest();
    location.reload();
    return;
  }

  if (session.isGuest && provider === "guest") {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln("Guest session already active.");
    terminal.writeln(" ".repeat(terminal.cols));
  } else {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln(
      ansi.style.red +
        "You are already signed in. To sign out use " +
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

const autocomplete: CommandAutocomplete = ({ currentIndex, currentToken }) => {
  if (currentIndex === 0) {
    return ["google", "guest", "modal"].filter((item) =>
      item.startsWith(currentToken)
    );
  }
  return [];
};

export { autocomplete };
