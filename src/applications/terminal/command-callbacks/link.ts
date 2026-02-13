import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import type { CommandAutocomplete, CommandCallback } from "./index";

function parseUrlOperand(fullCommand: string): string {
  return fullCommand.trim().slice("link".length).trim();
}

function normalizeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function link(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
): Promise<void> {
  const rawUrl = parseUrlOperand(fullCommand);
  if (!rawUrl) {
    terminal.writeln("\x1b[31mlink: missing URL operand\x1b[0m");
    return;
  }

  const url = normalizeExternalUrl(rawUrl);
  if (!url) {
    terminal.writeln(`\x1b[31mlink: invalid URL: ${rawUrl}\x1b[0m`);
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    terminal.writeln(
      "\x1b[31mlink: unable to open URL (pop-up may be blocked)\x1b[0m",
    );
  }
}

export default link satisfies CommandCallback;

const autocomplete: CommandAutocomplete = () => [];

export { autocomplete };
