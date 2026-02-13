import type { Terminal } from "@xterm/xterm";
import ansi from "ansi-escape-sequences";


import { useSession } from "@/auth/client";
import commandCallbacks, { commandAutoCompletes } from "./command-callbacks";
import commands from "./commands.json";

import Fuse from "fuse.js";

import { getCwd } from "./command-callbacks/cd";
import { useFileSystem } from "@/hooks/use-file-system";
import { getAliases, getEnvVar } from "./shell-state";

// FIXME: When resizing the lines dont unwrap and wrap properly.

const TERMINAL_HISTORY_PATH = "/home/user/.terminal_history";

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

function ensureHistoryLoaded(createIfMissing: boolean) {
  if (typeof window === "undefined") return;
  const fs = useFileSystem();

  if (!fs.exists(TERMINAL_HISTORY_PATH)) {
    _commandHistory = [];
    _historyIndex = -1;
    _historyDraft = "";
    _historyLoaded = false;
    _historyPendingCreate = true;
    if (createIfMissing) {
      fs.createFile("/home/user", ".terminal_history", "");
      _historyLoaded = true;
      _historyPendingCreate = false;
    }
    return;
  }

  if (_historyLoaded) return;

  const contents = fs.getFileContents(TERMINAL_HISTORY_PATH) ?? "";
  _commandHistory = contents
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  _historyLoaded = true;
}

function syncHistoryWithFileSystem() {
  if (typeof window === "undefined") return;
  const fs = useFileSystem();
  if (!fs.exists(TERMINAL_HISTORY_PATH)) {
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
  if (!fs.exists(TERMINAL_HISTORY_PATH)) {
    if (!createIfMissing) return;
    fs.createFile("/home/user", ".terminal_history", "");
    _historyPendingCreate = false;
  }
  fs.updateFile(TERMINAL_HISTORY_PATH, _commandHistory.join("\n"));
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
    _commandBuffer.content.length
  );
  moveCursorForward(end.length, terminal);
  _commandBuffer.cursorPosition = _commandBuffer.content.length;

  if (_commandBuffer.content.length > 0) {
    _commandBuffer = removeFromTerminalAndCommandBuffer(
      _commandBuffer.content.length,
      _commandBuffer,
      terminal
    );
  }

  _commandBuffer = writeToTerminalAndCommandBuffer(
    newContent,
    _commandBuffer,
    terminal
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

export function getCommandLinePrefix(username: string): string {
  const cwd = getCwd();
  // Shorten home directory to ~
  const displayPath = cwd.replace("/home/user", "~");
  
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
  terminal: Terminal
): CommandBuffer {
  let result: CommandBuffer = commandBuffer;

  terminal.write(ansi.cursor.hide);

  const start = result.content.substring(0, result.cursorPosition);
  const end = result.content.substring(
    result.cursorPosition,
    result.content.length
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
  terminal: Terminal
): CommandBuffer {
  let result: CommandBuffer = commandBuffer;

  terminal.write(ansi.cursor.hide);

  const start = result.content.substring(0, result.cursorPosition - steps);
  const end = result.content.substring(
    result.cursorPosition,
    result.content.length
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
        commandBuffer.cursorPosition - steps
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

async function onCommand(
  commandBuffer: CommandBuffer,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string,
  options?: { writePrompt?: boolean }
): Promise<CommandBuffer> {
  const username =
    session.status === "authenticated"
      ? (session.data.user.username ??
          session.data.user.name ??
          session.data.user.id)
      : "";
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

  const queryForCommand = commands.filter(
    (value) => value.name === command || value.aliases.includes(command)
  )[0];

  const commandExists = queryForCommand !== undefined;

  if (commandExists) {
    clearAutocompleteDisplay(terminal);
    terminal.write(ansi.cursor.hide);
    terminal.writeln("");
    await commandCallbacks[queryForCommand.callbackFunctionName](
      expandedCommand,
      terminal,
      session,
      windowIdentifier
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
    clearAutocompleteDisplay(terminal);
    const commandList: string[] = [];

    commands.forEach((command) => {
      commandList.push(command.name);
      command.aliases.forEach((alias) => {
        commandList.push(alias);
      });
    });

    const searchResult = new Fuse(commandList, {}).search(
      commandBuffer.content
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
          ansi.style.reset
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
          ansi.style.reset
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
  options?: { writePrompt?: boolean }
) {
  const buffer: CommandBuffer = {
    content: command,
    cursorPosition: command.length,
  };
  await onCommand(buffer, terminal, session, windowIdentifier, options);
}

export async function parseCommand(
  terminal: Terminal,
  event: { key: string; domEvent: KeyboardEvent },
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
) {
  if (event.domEvent.key !== "Tab") {
    clearAutocompleteDisplay(terminal);
  }
  const content = `${event.domEvent.ctrlKey ? "^" : ""}${event.domEvent.key}`;

  if (content === "^r") {
    location.reload();
    return;
  }

  if (content === "^z") {
    terminal.write(ansi.style.gray + content + ansi.style.reset);

    const username =
      session.status === "authenticated"
        ? (session.data.user.username ??
            session.data.user.name ??
            session.data.user.id)
        : "";

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
        terminal
      );
    });
    return;
  }

  if (content === "^a") {
    terminal.select(
      terminal.buffer.active.cursorX - _commandBuffer.cursorPosition,
      terminal.buffer.active.cursorY,
      _commandBuffer.content.length
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
                _commandBuffer.cursorPosition - 1 - i
              ) === " ";

            if (cursorCurrentlyOnASpace !== cursorStartedOnASpace) break;

            toBeRemoved++;
          }

          _commandBuffer = removeFromTerminalAndCommandBuffer(
            toBeRemoved,
            _commandBuffer,
            terminal
          );
        } else {
          _commandBuffer = removeFromTerminalAndCommandBuffer(
            1,
            _commandBuffer,
            terminal
          );
        }
      }
      break;
    case "Enter":
      _commandBuffer = await onCommand(
        _commandBuffer,
        terminal,
        session,
        windowIdentifier,
        { writePrompt: true }
      );
      break;
    case "End":
      const end = _commandBuffer.content.substring(
        _commandBuffer.cursorPosition,
        _commandBuffer.content.length
      );

      moveCursorForward(end.length, terminal);
      _commandBuffer.cursorPosition += end.length;
      break;
    case "Home":
      const start = _commandBuffer.content.substring(
        0,
        _commandBuffer.cursorPosition
      );

      moveCursorBack(start.length, terminal);
      _commandBuffer.cursorPosition -= start.length;
      break;
    case "Tab":
      const beforeCursor = _commandBuffer.content.substring(
        0,
        _commandBuffer.cursorPosition
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
        const commandList: string[] = [];

        commands.forEach((command) => {
          commandList.push(command.name);
          command.aliases.forEach((alias) => {
            commandList.push(alias);
          });
        });

        const searchResult = new Fuse(commandList, { threshold: 0.005 }).search(
          _commandBuffer.content
        );

        if (searchResult.length === 1) {
          _commandBuffer = writeToTerminalAndCommandBuffer(
            searchResult[0].item.substring(
              _commandBuffer.cursorPosition,
              searchResult[0].item.length
            ),
            _commandBuffer,
            terminal
          );
        } else if (searchResult.length > 1) {
          const suggestionText = searchResult
            .map((item) => item.item)
            .join("  ");
          const neededLines = Math.max(
            1,
            Math.ceil(suggestionText.length / terminal.cols)
          );

          terminal.write(cursor.savePosition);

          terminal.writeln(" ".repeat(terminal.cols));
          searchResult
            .map((item) => item.item)
            .forEach((command, index) =>
              terminal.write(
                command + (index !== searchResult.length ? "  " : "")
              )
            );
          terminal.write(cursor.returnToSavedPosition);
          _autocompleteLines = neededLines + 1;
        }
      } else if (cursorAtEndOfCommandBuffer && parts.length > 0) {
        const commandName = parts[0];
        const autocomplete = commandAutoCompletes[commandName];

        if (autocomplete) {
          const argsWithoutCommand = parts.slice(1);
          const currentToken = hasTrailingSpace
            ? ""
            : parts[parts.length - 1] ?? "";
          const currentIndex = hasTrailingSpace
            ? argsWithoutCommand.length
            : Math.max(argsWithoutCommand.length - 1, 0);

          const completions = autocomplete({
            args: argsWithoutCommand,
            currentIndex,
            currentToken,
            cwd: getCwd(),
          });

          const matches = currentToken.length === 0
            ? completions
            : completions.filter((item) => item.startsWith(currentToken));

          if (matches.length === 1) {
            _commandBuffer = writeToTerminalAndCommandBuffer(
              matches[0].substring(currentToken.length),
              _commandBuffer,
              terminal
            );
          } else if (matches.length > 1) {
            const suggestionText = matches.join("  ");
            const neededLines = Math.max(1, Math.ceil(suggestionText.length / terminal.cols));

            terminal.write(cursor.savePosition);
            terminal.writeln(" ".repeat(terminal.cols));
            matches.forEach((item, index) => {
              terminal.write(item + (index !== matches.length ? "  " : ""));
            });
            terminal.write(cursor.returnToSavedPosition);
            _autocompleteLines = neededLines + 1;
          }
        } else {
          _commandBuffer = writeToTerminalAndCommandBuffer(
            "    ",
            _commandBuffer,
            terminal
          );
        }
      } else {
        _commandBuffer = writeToTerminalAndCommandBuffer(
          "    ",
          _commandBuffer,
          terminal
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
                _commandBuffer.cursorPosition - 1 - i
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
                _commandBuffer.cursorPosition + i
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
        terminal
      );
      break;
  }
}
