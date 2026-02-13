import type { Terminal } from "@xterm/xterm";
import ansi from "ansi-escape-sequences";

import { useSession } from "@/auth/client";
import { executeFilePath } from "@/lib/file-execution";
import { getHomePath } from "@/lib/system-user";
import commandCallbacks, { commandAutoCompletes } from "./command-callbacks";
import commands from "./commands.json";

import Fuse from "fuse.js";

import { useFileSystem } from "@/hooks/use-file-system";
import { getPathCompletions } from "./command-callbacks/autocomplete";
import { getCwd, setActiveTerminalWindow } from "./command-callbacks/cd";
import { getAliases, getEnvVar } from "./shell-state";

// FIXME: When resizing the lines dont unwrap and wrap properly.

function getTerminalHistoryPath() {
  return `${getHomePath()}/.terminal_history`;
}

interface CommandBuffer {
  content: string;
  cursorPosition: number;
}

// TODO: Check if theres a better way to store this.
let _commandBuffer: CommandBuffer = {
  content: "",
  cursorPosition: 0,
};

let _historyLoaded = false;
let _commandHistory: string[] = [];
let _historyIndex = -1;
let _historyDraft = "";
let _historyPendingCreate = false;
let _autocompleteLines = 0;
let _autocompleteSuggestions: string[] = [];
let _autocompleteSelectedIndex = -1;
let _autocompleteContextKey = "";

function resetAutocompleteState() {
  _autocompleteSuggestions = [];
  _autocompleteSelectedIndex = -1;
  _autocompleteContextKey = "";
}

function ensureHistoryLoaded(createIfMissing: boolean) {
  if (typeof window === "undefined") return;
  const fs = useFileSystem();

  const historyPath = getTerminalHistoryPath();

  if (!fs.exists(historyPath)) {
    _commandHistory = [];
    _historyIndex = -1;
    _historyDraft = "";
    _historyLoaded = false;
    _historyPendingCreate = true;
    if (createIfMissing) {
      fs.createFile(getHomePath(), ".terminal_history", "");
      _historyLoaded = true;
      _historyPendingCreate = false;
    }
    return;
  }

  if (_historyLoaded) return;

  const contents = fs.getFileContents(historyPath) ?? "";
  _commandHistory = contents
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  _historyLoaded = true;
}

function syncHistoryWithFileSystem() {
  if (typeof window === "undefined") return;
  const fs = useFileSystem();
  if (!fs.exists(getTerminalHistoryPath())) {
    _commandHistory = [];
    _historyIndex = -1;
    _historyDraft = "";
    _historyLoaded = false;
    _historyPendingCreate = true;
  }
}

function persistHistory(createIfMissing: boolean) {
  if (typeof window === "undefined") return;
  const fs = useFileSystem();
  const historyPath = getTerminalHistoryPath();
  if (!fs.exists(historyPath)) {
    if (!createIfMissing) return;
    fs.createFile(getHomePath(), ".terminal_history", "");
    _historyPendingCreate = false;
  }
  fs.updateFile(historyPath, _commandHistory.join("\n"));
}

function appendHistory(command: string) {
  const trimmed = command.trim();
  if (trimmed.length === 0) return;
  ensureHistoryLoaded(false);
  _commandHistory.push(command);
  if (_commandHistory.length > 100) {
    _commandHistory = _commandHistory.slice(-100);
  }
  if (!_historyPendingCreate) {
    persistHistory(false);
  }
  _historyIndex = -1;
  _historyDraft = "";
}

function replaceCommandBuffer(newContent: string, terminal: Terminal) {
  const end = _commandBuffer.content.substring(
    _commandBuffer.cursorPosition,
    _commandBuffer.content.length,
  );
  moveCursorForward(end.length, terminal);
  _commandBuffer.cursorPosition = _commandBuffer.content.length;

  if (_commandBuffer.content.length > 0) {
    _commandBuffer = removeFromTerminalAndCommandBuffer(
      _commandBuffer.content.length,
      _commandBuffer,
      terminal,
    );
  }

  _commandBuffer = writeToTerminalAndCommandBuffer(
    newContent,
    _commandBuffer,
    terminal,
  );
}

function expandAliasesAndEnv(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return input;

  const parts = trimmed.split(/\s+/);
  const command = parts[0];
  const aliases = getAliases();
  const aliasValue = aliases[command];

  let expanded = input;
  if (aliasValue) {
    const rest = trimmed.slice(command.length).trimStart();
    expanded = `${aliasValue}${rest ? ` ${rest}` : ""}`;
  }

  return expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    const value = getEnvVar(name);
    return value !== undefined ? value : "";
  });
}

function hasAlias(aliases: unknown, name: string): boolean {
  return Array.isArray(aliases) && (aliases as string[]).includes(name);
}

function getExecutableCommandNames(): string[] {
  const fs = useFileSystem();
  const rawPath = getEnvVar("PATH") ?? "/applications";
  const entries = rawPath
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const names = new Set<string>();

  entries.forEach((entry) => {
    const dirPath = fs.normalizePath(entry);
    if (!fs.exists(dirPath) || !fs.isDirectory(dirPath)) return;

    fs.getChildren(dirPath, true).forEach((node) => {
      if (node.type !== "file") return;
      if (!(node.executable || node.name.endsWith(".app"))) return;

      if (node.name.endsWith(".app")) {
        names.add(node.name.slice(0, -4));
      } else {
        names.add(node.name);
      }
    });
  });

  return Array.from(names);
}

function getFirstTokenCompletions(currentToken: string): string[] {
  const token = currentToken ?? "";
  const isPathLike =
    token.startsWith("/") ||
    token.startsWith(".") ||
    token.startsWith("~") ||
    token.includes("/");

  if (isPathLike) {
    const raw = getPathCompletions(token, {
      includeFiles: true,
      includeDirs: true,
      includeHidden: true,
      appendDirSlash: true,
      includeDotDirs: true,
    });

    const expanded = new Set<string>();
    raw.forEach((value) => {
      if (value.endsWith(".app")) {
        expanded.add(value.slice(0, -4));
      } else {
        expanded.add(value);
      }
    });

    return Array.from(expanded).filter((value) =>
      token.length > 0 ? value.startsWith(token) : true,
    );
  }

  const commandList: string[] = [];
  commands.forEach((command) => {
    commandList.push(command.name);
    command.aliases.forEach((alias) => {
      commandList.push(alias);
    });
  });

  const combined = new Set<string>([
    ...commandList,
    ...getExecutableCommandNames(),
  ]);

  return Array.from(combined).filter((value) =>
    token.length > 0 ? value.startsWith(token) : true,
  );
}

function clearAutocompleteDisplay(terminal: Terminal) {
  if (_autocompleteLines <= 0) return;

  terminal.write(cursor.savePosition);
  terminal.write(ansi.cursor.nextLine());

  for (let i = 0; i < _autocompleteLines; i += 1) {
    terminal.write("\r");
    terminal.write("\x1b[2K");
    if (i < _autocompleteLines - 1) {
      terminal.write(ansi.cursor.nextLine());
    }
  }

  terminal.write(cursor.returnToSavedPosition);
  _autocompleteLines = 0;
}

function renderAutocompleteSuggestions(
  terminal: Terminal,
  suggestions: string[],
  selectedIndex: number,
) {
  const displaySuggestions = suggestions.map((item, index) => {
    const formatted = formatCompletionSuggestionForDisplay(item);
    return index === selectedIndex ? `\x1b[7m${formatted}\x1b[0m` : formatted;
  });

  const plainDisplay = suggestions.map((item) =>
    formatCompletionSuggestionForDisplay(item),
  );
  const suggestionText = plainDisplay.join("  ");
  const neededLines = Math.max(
    1,
    Math.ceil(suggestionText.length / terminal.cols),
  );

  terminal.write(cursor.savePosition);
  terminal.writeln(" ".repeat(terminal.cols));
  displaySuggestions.forEach((item, index) => {
    terminal.write(
      item + (index !== displaySuggestions.length - 1 ? "  " : ""),
    );
  });
  terminal.write(cursor.returnToSavedPosition);
  _autocompleteLines = neededLines + 1;
}

function applyAutocompleteSelection(
  terminal: Terminal,
  previousToken: string,
  nextToken: string,
) {
  if (previousToken.length > 0) {
    _commandBuffer = removeFromTerminalAndCommandBuffer(
      previousToken.length,
      _commandBuffer,
      terminal,
    );
  }

  _commandBuffer = writeToTerminalAndCommandBuffer(
    nextToken,
    _commandBuffer,
    terminal,
  );
}

function sameSuggestions(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function formatCompletionSuggestionForDisplay(value: string): string {
  const cwd = getCwd();
  const home = getHomePath();

  if (!value.startsWith("/")) return value;

  if (value === cwd) return ".";
  if (value.startsWith(`${cwd}/`)) {
    return `.${value.slice(cwd.length)}`;
  }

  if (value === home) return "~";
  if (value.startsWith(`${home}/`)) {
    return `~${value.slice(home.length)}`;
  }

  return value;
}

export function getCommandLinePrefix(username: string): string {
  const cwd = getCwd();
  // Shorten home directory to ~
  const displayPath = cwd.replace(getHomePath(), "~");

  return (
    "\x1b[38;2;249;117;22m" +
    username +
    ansi.style.reset +
    "\x1b[38;2;100;100;100m" +
    ":" +
    ansi.style.reset +
    "\x1b[38;2;80;160;255m" +
    displayPath +
    ansi.style.reset +
    "\x1b[38;2;180;180;180m" +
    "$ " +
    ansi.style.reset
  );
}

// Keep for backwards compatibility but use getCommandLinePrefix() instead
export const COMMAND_LINE_PREFIX =
  "\x1b[38;2;249;117;22m" +
  "%username" +
  ansi.style.reset +
  "\x1b[38;2;180;180;180m" +
  "$ " +
  ansi.style.reset;

function writeToTerminalAndCommandBuffer(
  content: string,
  commandBuffer: CommandBuffer,
  terminal: Terminal,
): CommandBuffer {
  let result: CommandBuffer = commandBuffer;

  terminal.write(ansi.cursor.hide);

  const start = result.content.substring(0, result.cursorPosition);
  const end = result.content.substring(
    result.cursorPosition,
    result.content.length,
  );

  const startingCursorX = terminal.buffer.active.cursorX;
  const startingCursorY = terminal.buffer.active.cursorY;
  let currentCursorY = startingCursorY;

  for (
    let characterIndex = 0;
    characterIndex < content.length;
    characterIndex++
  ) {
    const character = content[characterIndex];

    const isBeforeEndOfLine =
      (startingCursorX + characterIndex) % terminal.cols === terminal.cols - 1;

    if (isBeforeEndOfLine) {
      terminal.write(character);
      if (terminal.buffer.active.getLine(currentCursorY + 1)) {
        terminal.write("\n\r");
      } else {
        terminal.write(ansi.cursor.nextLine());
      }
      currentCursorY += 1;
    } else {
      terminal.write(character);
    }
  }

  if (result.cursorPosition === result.content.length) {
    result = {
      content: commandBuffer.content + content,
      cursorPosition: commandBuffer.cursorPosition + content.length,
    };
  } else {
    result = {
      content: start + content + end,
      cursorPosition: result.cursorPosition + content.length,
    };

    writeAndReturnToOriginalPosition(end, terminal);
  }

  terminal.write(ansi.cursor.show);

  return result;
}

function removeFromTerminalAndCommandBuffer(
  steps: number,
  commandBuffer: CommandBuffer,
  terminal: Terminal,
): CommandBuffer {
  let result: CommandBuffer = commandBuffer;

  terminal.write(ansi.cursor.hide);

  const start = result.content.substring(0, result.cursorPosition - steps);
  const end = result.content.substring(
    result.cursorPosition,
    result.content.length,
  );

  const startingCursorX = terminal.buffer.active.cursorX;

  for (let i = 0; i < steps; i++) {
    const isStartOfLine = (startingCursorX - i) % terminal.cols === 0;

    if (isStartOfLine) {
      terminal.write("\b \b");
      terminal.write(ansi.cursor.previousLine());
      terminal.write(ansi.cursor.forward(terminal.cols));
    } else {
      terminal.write("\b \b");
    }
  }

  if (result.cursorPosition === result.content.length) {
    result = {
      content: commandBuffer.content.substring(
        0,
        commandBuffer.cursorPosition - steps,
      ),
      cursorPosition: commandBuffer.cursorPosition - steps,
    };
    writeAndReturnToOriginalPosition(" ".repeat(steps), terminal);
  } else {
    result = {
      content: start + end,
      cursorPosition: result.cursorPosition - steps,
    };

    writeAndReturnToOriginalPosition(end + " ".repeat(steps), terminal);
  }

  terminal.write(ansi.cursor.show);

  return result;
}

export const cursor = {
  savePosition: "\x1b[s",
  returnToSavedPosition: "\x1b[u",
};

function writeAndReturnToOriginalPosition(content: string, terminal: Terminal) {
  terminal.write(cursor.savePosition);
  terminal.write(content);
  terminal.write(cursor.returnToSavedPosition);
}

function moveCursorBack(steps: number, terminal: Terminal) {
  const startingCursorX = terminal.buffer.active.cursorX;

  if (steps > 1) terminal.write(ansi.cursor.hide);
  for (let i = 0; i < steps; i++) {
    const isBeforeStartOfLine = (startingCursorX - i) % terminal.cols === 0;

    if (isBeforeStartOfLine) {
      terminal.write(ansi.cursor.hide);
      terminal.write(ansi.cursor.previousLine());
      terminal.write(ansi.cursor.forward(terminal.cols));
      terminal.write(ansi.cursor.show);
    } else {
      terminal.write(ansi.cursor.back());
    }
  }
  if (steps > 1) terminal.write(ansi.cursor.show);
}

function moveCursorForward(steps: number, terminal: Terminal) {
  const startingCursorX = terminal.buffer.active.cursorX;
  if (steps > 1) terminal.write(ansi.cursor.hide);
  for (let i = 0; i < steps; i++) {
    const isBeforeEndOfLine =
      (startingCursorX + i) % terminal.cols === terminal.cols - 1;

    if (isBeforeEndOfLine) {
      terminal.write(ansi.cursor.nextLine());
    } else {
      terminal.write(ansi.cursor.forward());
    }
  }
  if (steps > 1) terminal.write(ansi.cursor.show);
}

function getSessionUsername(session: ReturnType<typeof useSession>): string {
  if (session.status !== "authenticated" || !session.data?.user) return "";
  const user = session.data.user as {
    username?: string;
    name?: string;
    id?: string;
  };
  return user.username ?? user.name ?? user.id ?? "";
}

async function onCommand(
  commandBuffer: CommandBuffer,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
  options?: { writePrompt?: boolean },
): Promise<CommandBuffer> {
  setActiveTerminalWindow(windowIdentifier);

  const username = getSessionUsername(session);
  const shouldWritePrompt = options?.writePrompt !== false;

  if (commandBuffer.content.length === 0) {
    clearAutocompleteDisplay(terminal);
    terminal.write("\n");
    if (shouldWritePrompt) {
      terminal.write(getCommandLinePrefix(username));
    }
    return {
      content: "",
      cursorPosition: 0,
    };
  }

  appendHistory(commandBuffer.content);

  const expandedCommand = expandAliasesAndEnv(commandBuffer.content);
  const tokens = expandedCommand.split(" ");
  const command = tokens[0];
  const fs = useFileSystem();

  const queryForCommand = commands.filter(
    (value) => value.name === command || hasAlias(value.aliases, command),
  )[0];

  const commandExists = queryForCommand !== undefined;

  if (commandExists) {
    const helpRequested = tokens.slice(1).includes("--help");
    if (helpRequested && queryForCommand.name !== "help") {
      clearAutocompleteDisplay(terminal);
      terminal.write(ansi.cursor.hide);
      terminal.writeln("");
      await commandCallbacks
        .help(
          `help ${queryForCommand.name}`,
          terminal,
          session,
          windowIdentifier,
        )
        .catch((error: Error) => {
          terminal.writeln(" ".repeat(terminal.cols));
          terminal.write(ansi.style.red);
          terminal.write(error.message);
          terminal.write(ansi.style.reset);
          terminal.writeln(" ".repeat(terminal.cols));
        })
        .finally(() => {
          if (shouldWritePrompt) {
            terminal.write(getCommandLinePrefix(username));
          }
          terminal.write(ansi.cursor.show);
        });

      return {
        content: "",
        cursorPosition: 0,
      };
    }

    const canonicalExpandedCommand = `${queryForCommand.name}${tokens.length > 1 ? ` ${tokens.slice(1).join(" ")}` : ""}`;

    clearAutocompleteDisplay(terminal);
    terminal.write(ansi.cursor.hide);
    terminal.writeln("");
    await commandCallbacks[queryForCommand.callbackFunctionName](
      canonicalExpandedCommand,
      terminal,
      session,
      windowIdentifier,
    )
      .catch((error: Error) => {
        terminal.writeln(" ".repeat(terminal.cols));
        terminal.write(ansi.style.red);
        terminal.write(error.message);
        terminal.write(ansi.style.reset);
        terminal.writeln(" ".repeat(terminal.cols));

        terminal.write(ansi.cursor.show);
      })
      .finally(() => {
        if (
          shouldWritePrompt &&
          queryForCommand.name !== "exit" &&
          queryForCommand.name !== "reload"
        ) {
          terminal.write(getCommandLinePrefix(username));
        }
        terminal.write(ansi.cursor.show);
      });
  } else {
    const executableResult = (() => {
      if (!command) return null;

      const resolveCandidates = () => {
        if (command.startsWith("/") || command.startsWith(".")) {
          const directPath = command.startsWith("/")
            ? fs.normalizePath(command)
            : fs.normalizePath(`${getCwd()}/${command}`);
          return [
            directPath,
            directPath.endsWith(".app") ? "" : `${directPath}.app`,
          ].filter(Boolean) as string[];
        }

        const rawPath = getEnvVar("PATH") ?? "/applications";
        const pathEntries = rawPath
          .split(":")
          .map((entry) => entry.trim())
          .filter(Boolean);

        const candidates: string[] = [];
        pathEntries.forEach((entry) => {
          const base = fs.normalizePath(entry);
          candidates.push(fs.normalizePath(`${base}/${command}`));
          if (!command.endsWith(".app")) {
            candidates.push(fs.normalizePath(`${base}/${command}.app`));
          }
        });
        return candidates;
      };

      const candidates = resolveCandidates();
      const executablePath = candidates.find((candidate) => {
        const node = fs.getNode(candidate);
        return Boolean(
          node?.type === "file" &&
          (node.executable || node.name.endsWith(".app")),
        );
      });

      if (!executablePath) return null;
      return executeFilePath(executablePath, fs, tokens.slice(1));
    })();

    if (executableResult?.ok) {
      clearAutocompleteDisplay(terminal);
      terminal.writeln("");
      if (shouldWritePrompt) {
        terminal.write(getCommandLinePrefix(username));
      }
      return {
        content: "",
        cursorPosition: 0,
      };
    }

    if (executableResult && !executableResult.ok && executableResult.message) {
      clearAutocompleteDisplay(terminal);
      terminal.writeln(" ".repeat(terminal.cols));
      terminal.writeln(
        ansi.style.red + executableResult.message + ansi.style.reset,
      );
      terminal.writeln(" ".repeat(terminal.cols));
      if (shouldWritePrompt) {
        terminal.write(getCommandLinePrefix(username));
      }
      return {
        content: "",
        cursorPosition: 0,
      };
    }

    clearAutocompleteDisplay(terminal);
    const commandList: string[] = [];

    commands.forEach((command) => {
      commandList.push(command.name);
      command.aliases.forEach((alias) => {
        commandList.push(alias);
      });
    });

    const searchResult = new Fuse(commandList, {}).search(
      commandBuffer.content,
    );

    if (searchResult.length > 0) {
      terminal.writeln(" ".repeat(terminal.cols));
      terminal.writeln(
        ansi.style.red +
          "Unknown command " +
          ansi.style.black +
          "`" +
          ansi.style.gray +
          commandBuffer.content +
          ansi.style.black +
          "`" +
          ansi.style.red +
          ". Did you mean " +
          ansi.style.black +
          "`" +
          ansi.style.gray +
          searchResult[0].item +
          ansi.style.black +
          "`" +
          ansi.style.red +
          "?" +
          ansi.style.reset,
      );
      terminal.writeln(" ".repeat(terminal.cols));
      if (shouldWritePrompt) {
        terminal.write(getCommandLinePrefix(username));
      }
    } else {
      terminal.writeln(" ".repeat(terminal.cols));
      terminal.writeln(
        ansi.style.red +
          "Unknown command " +
          ansi.style.black +
          "`" +
          ansi.style.gray +
          commandBuffer.content +
          ansi.style.black +
          "`" +
          ansi.style.red +
          "." +
          ansi.style.reset,
      );
      terminal.writeln(" ".repeat(terminal.cols));
      if (shouldWritePrompt) {
        terminal.write(getCommandLinePrefix(username));
      }
    }
  }

  if (_historyPendingCreate) {
    persistHistory(true);
  }
  syncHistoryWithFileSystem();

  return {
    content: "",
    cursorPosition: 0,
  };
}

export async function executeCommandLine(
  command: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
  options?: { writePrompt?: boolean },
) {
  setActiveTerminalWindow(windowIdentifier);

  const buffer: CommandBuffer = {
    content: command,
    cursorPosition: command.length,
  };
  await onCommand(buffer, terminal, session, windowIdentifier, options);
}

export function insertTextIntoCommandBuffer(
  terminal: Terminal,
  rawText: string,
) {
  clearAutocompleteDisplay(terminal);

  const content = rawText.replaceAll("\r", " ").replaceAll("\n", " ").trim();
  if (!content) return;

  const left = _commandBuffer.content.substring(
    0,
    _commandBuffer.cursorPosition,
  );
  const right = _commandBuffer.content.substring(_commandBuffer.cursorPosition);

  const needsLeadingSpace = left.length > 0 && !left.endsWith(" ");
  const needsTrailingSpace = right.length > 0 && !right.startsWith(" ");

  const text = `${needsLeadingSpace ? " " : ""}${content}${needsTrailingSpace ? " " : ""}`;
  _commandBuffer = writeToTerminalAndCommandBuffer(
    text,
    _commandBuffer,
    terminal,
  );
}

export async function parseCommand(
  terminal: Terminal,
  event: { key: string; domEvent: KeyboardEvent },
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
) {
  setActiveTerminalWindow(windowIdentifier);

  if (event.domEvent.key !== "Tab" && event.domEvent.key !== "Enter") {
    clearAutocompleteDisplay(terminal);
    resetAutocompleteState();
  }
  const content = `${event.domEvent.ctrlKey ? "^" : ""}${event.domEvent.key}`;

  if (content === "^r") {
    location.reload();
    return;
  }

  if (content === "^z") {
    terminal.write(ansi.style.gray + content + ansi.style.reset);

    const username = getSessionUsername(session);

    terminal.write("\n" + getCommandLinePrefix(username));

    _commandBuffer = {
      content: "",
      cursorPosition: 0,
    };
    return;
  }

  if (content === "^c") {
    navigator.clipboard.writeText(terminal.getSelection());
    return;
  }

  if (content === "^v") {
    navigator.clipboard.readText().then((clipboardContents) => {
      _commandBuffer = writeToTerminalAndCommandBuffer(
        clipboardContents.replaceAll("\n", "").replaceAll("\r", ""),
        _commandBuffer,
        terminal,
      );
    });
    return;
  }

  if (content === "^a") {
    terminal.select(
      terminal.buffer.active.cursorX - _commandBuffer.cursorPosition,
      terminal.buffer.active.cursorY,
      _commandBuffer.content.length,
    );
    return;
  }

  switch (event.domEvent.key) {
    case "Backspace":
      if (
        _commandBuffer.cursorPosition <= _commandBuffer.content.length &&
        _commandBuffer.cursorPosition > 0
      ) {
        if (event.domEvent.ctrlKey) {
          const cursorStartedOnASpace =
            _commandBuffer.content.charAt(_commandBuffer.cursorPosition - 1) ===
            " ";
          let toBeRemoved = 0;

          // Count the number of spaces or characters to the left (depending on cursorStartingOnASpace) until we've hit something different.
          for (let i = 0; i < _commandBuffer.cursorPosition; i++) {
            const cursorCurrentlyOnASpace =
              _commandBuffer.content.charAt(
                _commandBuffer.cursorPosition - 1 - i,
              ) === " ";

            if (cursorCurrentlyOnASpace !== cursorStartedOnASpace) break;

            toBeRemoved++;
          }

          _commandBuffer = removeFromTerminalAndCommandBuffer(
            toBeRemoved,
            _commandBuffer,
            terminal,
          );
        } else {
          _commandBuffer = removeFromTerminalAndCommandBuffer(
            1,
            _commandBuffer,
            terminal,
          );
        }
      }
      break;
    case "Enter":
      if (
        _autocompleteSuggestions.length > 0 &&
        _autocompleteSelectedIndex >= 0
      ) {
        clearAutocompleteDisplay(terminal);
        resetAutocompleteState();
        break;
      }

      _commandBuffer = await onCommand(
        _commandBuffer,
        terminal,
        session,
        windowIdentifier,
        { writePrompt: true },
      );
      break;
    case "End":
      const end = _commandBuffer.content.substring(
        _commandBuffer.cursorPosition,
        _commandBuffer.content.length,
      );

      moveCursorForward(end.length, terminal);
      _commandBuffer.cursorPosition += end.length;
      break;
    case "Home":
      const start = _commandBuffer.content.substring(
        0,
        _commandBuffer.cursorPosition,
      );

      moveCursorBack(start.length, terminal);
      _commandBuffer.cursorPosition -= start.length;
      break;
    case "Tab":
      event.domEvent.preventDefault();
      event.domEvent.stopPropagation();

      const beforeCursor = _commandBuffer.content.substring(
        0,
        _commandBuffer.cursorPosition,
      );
      const args = _commandBuffer.content.split(" ");

      const cursorAtEndOfCommandBuffer =
        _commandBuffer.content.length === _commandBuffer.cursorPosition;
      const cursorNotOnASpace =
        _commandBuffer.content.charAt(_commandBuffer.cursorPosition) !== " ";
      const hasTrailingSpace = /\s$/.test(beforeCursor);
      const parts = beforeCursor.split(/\s+/).filter(Boolean);

      if (
        args.length === 1 &&
        cursorAtEndOfCommandBuffer &&
        cursorNotOnASpace
      ) {
        const firstToken = beforeCursor.trim();
        const firstTokenMatches = getFirstTokenCompletions(firstToken);
        const contextKey = "first";
        const hasCycleContext =
          _autocompleteContextKey === contextKey &&
          _autocompleteSuggestions.length > 1;
        const suggestions = hasCycleContext
          ? _autocompleteSuggestions
          : firstTokenMatches;

        if (suggestions.length === 1 && !hasCycleContext) {
          _commandBuffer = writeToTerminalAndCommandBuffer(
            suggestions[0].substring(
              _commandBuffer.cursorPosition,
              suggestions[0].length,
            ),
            _commandBuffer,
            terminal,
          );
          resetAutocompleteState();
        } else if (suggestions.length > 1) {
          const shouldResetCycle =
            _autocompleteContextKey !== contextKey ||
            !sameSuggestions(_autocompleteSuggestions, suggestions);

          if (shouldResetCycle) {
            _autocompleteSuggestions = suggestions;
            _autocompleteSelectedIndex = event.domEvent.shiftKey
              ? suggestions.length - 1
              : 0;
            _autocompleteContextKey = contextKey;

            applyAutocompleteSelection(
              terminal,
              firstToken,
              _autocompleteSuggestions[_autocompleteSelectedIndex],
            );
          } else {
            const previous =
              _autocompleteSuggestions[_autocompleteSelectedIndex] ?? "";
            _autocompleteSelectedIndex =
              (_autocompleteSelectedIndex +
                (event.domEvent.shiftKey ? -1 : 1) +
                _autocompleteSuggestions.length) %
              _autocompleteSuggestions.length;

            applyAutocompleteSelection(
              terminal,
              previous,
              _autocompleteSuggestions[_autocompleteSelectedIndex],
            );
          }

          clearAutocompleteDisplay(terminal);
          renderAutocompleteSuggestions(
            terminal,
            _autocompleteSuggestions,
            _autocompleteSelectedIndex,
          );
        }
      } else if (cursorAtEndOfCommandBuffer && parts.length > 0) {
        const commandName = parts[0];
        const matched = commands.find(
          (value) =>
            value.name === commandName || hasAlias(value.aliases, commandName),
        );
        const matchedAutocompleteKey = matched
          ? commandAutoCompletes[matched.callbackFunctionName]
            ? matched.callbackFunctionName
            : matched.name
          : commandName;
        const autocomplete = commandAutoCompletes[matchedAutocompleteKey];

        if (autocomplete) {
          const argsWithoutCommand = parts.slice(1);
          const currentToken = hasTrailingSpace
            ? ""
            : (parts[parts.length - 1] ?? "");
          const currentIndex = hasTrailingSpace
            ? argsWithoutCommand.length
            : Math.max(argsWithoutCommand.length - 1, 0);

          const completions = autocomplete({
            commandName: matched?.name ?? commandName,
            args: argsWithoutCommand,
            currentIndex,
            currentToken,
            cwd: getCwd(),
          });

          const matches =
            currentToken.length === 0
              ? completions
              : completions.filter((item) => item.startsWith(currentToken));
          const contextKey = `args:${matchedAutocompleteKey}:${currentIndex}:${beforeCursor.slice(0, Math.max(0, beforeCursor.length - currentToken.length))}`;
          const hasCycleContext =
            _autocompleteContextKey === contextKey &&
            _autocompleteSuggestions.length > 1;
          const suggestions = hasCycleContext
            ? _autocompleteSuggestions
            : matches;

          if (suggestions.length === 1 && !hasCycleContext) {
            _commandBuffer = writeToTerminalAndCommandBuffer(
              suggestions[0].substring(currentToken.length),
              _commandBuffer,
              terminal,
            );
            resetAutocompleteState();
          } else if (suggestions.length > 1) {
            const shouldResetCycle =
              _autocompleteContextKey !== contextKey ||
              !sameSuggestions(_autocompleteSuggestions, suggestions);

            if (shouldResetCycle) {
              _autocompleteSuggestions = suggestions;
              _autocompleteSelectedIndex = event.domEvent.shiftKey
                ? suggestions.length - 1
                : 0;
              _autocompleteContextKey = contextKey;

              applyAutocompleteSelection(
                terminal,
                currentToken,
                _autocompleteSuggestions[_autocompleteSelectedIndex],
              );
            } else {
              const previous =
                _autocompleteSuggestions[_autocompleteSelectedIndex] ?? "";
              _autocompleteSelectedIndex =
                (_autocompleteSelectedIndex +
                  (event.domEvent.shiftKey ? -1 : 1) +
                  _autocompleteSuggestions.length) %
                _autocompleteSuggestions.length;

              applyAutocompleteSelection(
                terminal,
                previous,
                _autocompleteSuggestions[_autocompleteSelectedIndex],
              );
            }

            clearAutocompleteDisplay(terminal);
            renderAutocompleteSuggestions(
              terminal,
              _autocompleteSuggestions,
              _autocompleteSelectedIndex,
            );
          }
        } else {
          resetAutocompleteState();
          _commandBuffer = writeToTerminalAndCommandBuffer(
            "    ",
            _commandBuffer,
            terminal,
          );
        }
      } else {
        resetAutocompleteState();
        _commandBuffer = writeToTerminalAndCommandBuffer(
          "    ",
          _commandBuffer,
          terminal,
        );
      }
      break;
    case "Escape":
      break;
    case "PageDown":
    case "ArrowDown":
    case "Down":
      event.domEvent.preventDefault();
      event.domEvent.stopPropagation();
      ensureHistoryLoaded(false);
      if (_commandHistory.length === 0) break;
      if (_historyIndex === -1) break;

      if (_historyIndex < _commandHistory.length - 1) {
        _historyIndex += 1;
        replaceCommandBuffer(_commandHistory[_historyIndex], terminal);
      } else {
        _historyIndex = -1;
        replaceCommandBuffer(_historyDraft, terminal);
      }
      break;
    case "PageUp":
    case "ArrowUp":
    case "Up":
      event.domEvent.preventDefault();
      event.domEvent.stopPropagation();
      ensureHistoryLoaded(false);
      if (_commandHistory.length === 0) break;

      if (_historyIndex === -1) {
        _historyDraft = _commandBuffer.content;
        _historyIndex = _commandHistory.length - 1;
      } else if (_historyIndex > 0) {
        _historyIndex -= 1;
      }

      replaceCommandBuffer(_commandHistory[_historyIndex], terminal);
      break;
    case "ArrowLeft":
      if (
        _commandBuffer.cursorPosition <= _commandBuffer.content.length &&
        _commandBuffer.cursorPosition > 0
      ) {
        if (event.domEvent.ctrlKey) {
          const cursorStartedOnASpace =
            _commandBuffer.content.charAt(_commandBuffer.cursorPosition - 1) ===
            " ";
          let toStep = 0;

          // Count the number of spaces or characters to the left (depending on cursorStartingOnASpace) until we've hit something different.
          for (let i = 0; i < _commandBuffer.cursorPosition; i++) {
            const cursorCurrentlyOnASpace =
              _commandBuffer.content.charAt(
                _commandBuffer.cursorPosition - 1 - i,
              ) === " ";

            if (cursorCurrentlyOnASpace !== cursorStartedOnASpace) break;

            toStep++;
          }

          _commandBuffer.cursorPosition += -toStep;

          moveCursorBack(toStep, terminal);
        } else {
          moveCursorBack(1, terminal);

          _commandBuffer.cursorPosition += -1;
        }
      }
      break;
    case "ArrowRight":
      if (
        _commandBuffer.cursorPosition < _commandBuffer.content.length &&
        _commandBuffer.cursorPosition >= 0
      ) {
        if (event.domEvent.ctrlKey) {
          const cursorStartedOnASpace =
            _commandBuffer.content.charAt(_commandBuffer.cursorPosition) ===
            " ";
          let toStep = 0;

          // Count the number of spaces or characters to the left (depending on cursorStartingOnASpace) until we've hit something different.
          for (
            let i = 0;
            i < _commandBuffer.content.length - _commandBuffer.cursorPosition;
            i++
          ) {
            const cursorCurrentlyOnASpace =
              _commandBuffer.content.charAt(
                _commandBuffer.cursorPosition + i,
              ) === " ";

            if (cursorCurrentlyOnASpace !== cursorStartedOnASpace) break;

            toStep++;
          }

          _commandBuffer.cursorPosition += toStep;

          moveCursorForward(toStep, terminal);
        } else {
          moveCursorForward(1, terminal);

          _commandBuffer.cursorPosition += 1;
        }
      }
      break;
    // TODO: Add delete key functionality.
    case "Delete":
      break;
    default:
      _commandBuffer = writeToTerminalAndCommandBuffer(
        content,
        _commandBuffer,
        terminal,
      );
      break;
  }
}
