import type { Terminal } from "@xterm/xterm";
import ansi from "ansi-escape-sequences";

import wrap from "word-wrap";

import commandCallbacks from "./command-callbacks";
import commands from "./commands.json";
import { useSession } from "next-auth/react";

import Fuse from "fuse.js";

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
    terminal.write(
      "\n" + COMMAND_LINE_PREFIX.replaceAll("%username", username)
    );
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
    terminal.write(ansi.cursor.hide);
    commandCallbacks[queryForCommand.callbackFunctionName](
      commandBuffer.content,
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
          queryForCommand.name !== "exit" &&
          queryForCommand.name !== "reload"
        ) {
          terminal.write(COMMAND_LINE_PREFIX.replaceAll("%username", username));
        }
        terminal.write(ansi.cursor.show);
      });
  } else {
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
      terminal.write(COMMAND_LINE_PREFIX.replaceAll("%username", username));
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
      terminal.write(COMMAND_LINE_PREFIX.replaceAll("%username", username));
    }
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

  if (content === "^z") {
    terminal.write(ansi.style.gray + content + ansi.style.reset);

    const username =
      session.status === "authenticated"
        ? session.data.user.name + " " ?? session.data.user.id + " "
        : "";

    terminal.write(
      "\n" + COMMAND_LINE_PREFIX.replaceAll("%username", username)
    );

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
      const args = _commandBuffer.content.split(" ");

      const cursorAtEndOfCommandBuffer =
        _commandBuffer.content.length === _commandBuffer.cursorPosition;
      const cursorNotOnASpace =
        _commandBuffer.content.charAt(_commandBuffer.cursorPosition) !== " ";

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
