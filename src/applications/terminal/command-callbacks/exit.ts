import type { Terminal } from "@xterm/xterm";

import type { CommandAutocomplete, CommandCallback } from "./index";
import { useSession } from "next-auth/react";

import styles from "@/operating-system/application/window/application-window.module.css";

async function exit(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
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

  setTimeout(() => {
    terminal.dispose();
  }, 600);
}

export default exit satisfies CommandCallback;

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
