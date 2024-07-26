import type { Terminal } from "@xterm/xterm";
import ansi from "ansi-escape-sequences";

import wrap from "word-wrap";

import commandCallbacks from "./command-callbacks";
import commands from "./commands.json";
import { useSession } from "next-auth/react";

// FIXME: When resizing the lines dont unwrap and wrap properly.

// TODO: Add command history.

interface CommandBuffer {
  content: string;
  cursorPosition: number;
}

// TODO: Check if theres a better way to store this.
let _commandBuffer: CommandBuffer = {
  content: "",
  cursorPosition: 0,
};

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
  windowIdentifier: string
): Promise<CommandBuffer> {
  const username =
    session.status === "authenticated"
      ? session.data.user.name + " " ?? session.data.user.id + " "
      : "";

  if (commandBuffer.content.length === 0) {
    terminal.writeln("");
    terminal.write(COMMAND_LINE_PREFIX.replaceAll("%username", username));
    return {
      content: "",
      cursorPosition: 0,
    };
  }

  const tokens = commandBuffer.content.split(" ");
  const command = tokens[0];

  const queryForCommand = commands.filter(
    (value) => value.name === command || value.aliases.includes(command)
  )[0];

  const commandExists = queryForCommand !== undefined;

  if (commandExists) {
    commandCallbacks[queryForCommand.callbackFunctionName](
      commandBuffer.content,
      terminal,
      session,
      windowIdentifier
    )
      .catch((error: Error) => {
        terminal.writeln(ansi.style.red + "Program threw an exception: ");
        wrap(error.message, { width: terminal.cols, indent: "" })
          .split("\n")
          .forEach((line) => {
            terminal.writeln(line);
          });
        terminal.write(ansi.style.reset);
      })
      .finally(() => {
        if (queryForCommand.name !== "exit") {
          terminal.write(COMMAND_LINE_PREFIX.replaceAll("%username", username));
        }
      });
  } else {
    terminal.writeln("");
    terminal.writeln("");
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
    terminal.writeln("");
    terminal.write(COMMAND_LINE_PREFIX.replaceAll("%username", username));
  }

  return {
    content: "",
    cursorPosition: 0,
  };
}

export async function parseCommand(
  terminal: Terminal,
  event: { key: string; domEvent: KeyboardEvent },
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
) {
  const content = `${event.domEvent.ctrlKey ? "^" : ""}${event.domEvent.key}`;

  if (content === "^r") {
    location.reload();
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
        windowIdentifier
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
      _commandBuffer = writeToTerminalAndCommandBuffer(
        "    ",
        _commandBuffer,
        terminal
      );
      break;
    case "Escape":
      break;
    case "PageDown":
    case "ArrowDown":
      break;
    case "PageUp":
    case "ArrowUp":
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
    default:
      _commandBuffer = writeToTerminalAndCommandBuffer(
        content,
        _commandBuffer,
        terminal
      );
      break;
  }
}
