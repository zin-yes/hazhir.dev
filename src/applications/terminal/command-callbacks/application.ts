import type { Terminal } from "@xterm/xterm";

import type { CommandCallback } from "./index";
import { useSession } from "next-auth/react";

import commands from "../commands.json";

import { all, createEmphasize } from "emphasize";
import UseOperatingSystem from "@/hooks/use-operating-system";

import styles from "@/operating-system/application/window/application-window.module.css";

import ansi from "ansi-escape-sequences";

async function application(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const trimmedCommand = fullCommand.trim();

  const args = fullCommand.split(" ");

  const { getApplicationWindows, getApplicationWindow } = UseOperatingSystem();

  if (trimmedCommand.toLowerCase().startsWith("application info")) {
    if (args.length === 3) {
      const result = getApplicationWindow(args[2]) ?? {};

      if (result.identifier !== "NULL") {
        terminal.writeln("");
        terminal.writeln("");
        terminal.writeln(
          createEmphasize(all).highlight(
            "json",
            JSON.stringify(result, null, 2)
          ).value
        );
        terminal.writeln("");
      } else {
        throw new Error(
          "An invalid identifier was provided, and an application was not found."
        );
      }
    } else {
      const commandInfo = commands.find(
        (command) => command.name === "application"
      );
      throw new Error(
        "Incorrect command usage; usage & examples: \n\nUsage(s):\n - " +
          commandInfo?.usage.join("\n - ") +
          "\n\nExample(s):\n - " +
          commandInfo?.examples.join("\n - ")
      );
    }
  } else if (trimmedCommand.toLowerCase().startsWith("application list")) {
    terminal.writeln("");
    terminal.writeln("");
    terminal.writeln(
      createEmphasize(all).highlight(
        "json",
        JSON.stringify(getApplicationWindows() ?? {}, null, 2)
      ).value
    );
    terminal.writeln("");
  } else if (trimmedCommand.toLowerCase().startsWith("application close")) {
    const result = getApplicationWindow(args[2]) ?? {};

    if (result.identifier !== "NULL") {
      terminal.writeln("");
      terminal.writeln("");
      terminal.writeln(
        "Closing application " +
          ansi.style.black +
          "`" +
          ansi.style.gray +
          result.identifier +
          ansi.style.black +
          "`" +
          ansi.style.reset +
          "."
      );
      close(result.identifier);
      terminal.writeln("");
    } else {
      throw new Error(
        "An invalid identifier was provided, and the application could not be closed."
      );
    }
  } else {
    const commandInfo = commands.find(
      (command) => command.name === "application"
    );
    throw new Error(
      "Incorrect command usage; usage & examples: \n\nUsage(s):\n - " +
        commandInfo?.usage.join("\n - ") +
        "\n\nExample(s):\n - " +
        commandInfo?.examples.join("\n - ")
    );
  }
}

function close(windowIdentifier: string) {
  const element = document.getElementById(windowIdentifier) as HTMLDivElement;

  function getTopElement(a: HTMLElement, b: HTMLElement) {
    const aIndex = getZIndex(a);
    const bIndex = getZIndex(b);
    return aIndex > bIndex ? a : b;
  }

  function getZIndex(element: Element): number {
    if (document.defaultView) {
      const zIndex = document.defaultView
        .getComputedStyle(element)
        .getPropertyValue("z-index");
      return isNaN(Number(zIndex)) ? 0 : Number(zIndex);
    }
    return 0;
  }

  if (element) {
    element.style.opacity = "0";
    element.style.transform = "scale(0)";
    setTimeout(() => {
      if (element) {
        element.remove();
      }
    }, 600);
    const applicationWindowElements =
      document.getElementsByClassName("applicationWindow");

    let topPane: HTMLDivElement | undefined;
    for (let i = 0; i < applicationWindowElements.length; i++) {
      const item = applicationWindowElements[i];
      if (item.id === windowIdentifier) continue;

      if (!topPane) topPane = item as HTMLDivElement;

      if (getTopElement(topPane, item as HTMLDivElement) === item)
        topPane = item as HTMLDivElement;
    }

    if (topPane) {
      const thisPanesBodyElement = topPane.getElementsByClassName(
        styles.body
      )[0] as HTMLDivElement;

      if (!thisPanesBodyElement.classList.contains(styles.pane_in_focus)) {
        thisPanesBodyElement.classList.add(styles.pane_in_focus);
        thisPanesBodyElement.style.filter = "";
      }
    }
  }
}

export default application satisfies CommandCallback;
