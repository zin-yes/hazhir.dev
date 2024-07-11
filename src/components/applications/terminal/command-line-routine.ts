import type { Terminal } from "@xterm/xterm";
import ansiEscapes from "ansi-escape-sequences";

import commands from "./commands.json";

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

export const COMMAND_LINE_PREFIX = "$ ";

function writeToTerminalAndCommandBuffer(
  content: string,
  commandBuffer: CommandBuffer,
  terminal: Terminal
): CommandBuffer {
  let result: CommandBuffer = commandBuffer;

  console.log("Writing " + content + " to buffer: " + JSON.stringify(result));

  terminal.write(ansiEscapes.cursor.hide);

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
        terminal.write(ansiEscapes.cursor.nextLine());
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

  terminal.write(ansiEscapes.cursor.show);

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

  if (steps > 1) terminal.write(ansiEscapes.cursor.hide);
  for (let i = 0; i < steps; i++) {
    const isBeforeStartOfLine = (startingCursorX - i) % terminal.cols === 0;

    if (isBeforeStartOfLine) {
      terminal.write(ansiEscapes.cursor.hide);
      terminal.write(ansiEscapes.cursor.previousLine());
      terminal.write(ansiEscapes.cursor.forward(terminal.cols));
      terminal.write(ansiEscapes.cursor.show);
    } else {
      terminal.write(ansiEscapes.cursor.back());
    }
  }
  if (steps > 1) terminal.write(ansiEscapes.cursor.show);
}

function moveCursorForward(steps: number, terminal: Terminal) {
  const startingCursorX = terminal.buffer.active.cursorX;
  if (steps > 1) terminal.write(ansiEscapes.cursor.hide);
  for (let i = 0; i < steps; i++) {
    const isBeforeEndOfLine =
      (startingCursorX + i) % terminal.cols === terminal.cols - 1;

    if (isBeforeEndOfLine) {
      terminal.write(ansiEscapes.cursor.nextLine());
    } else {
      terminal.write(ansiEscapes.cursor.forward());
    }
  }
  if (steps > 1) terminal.write(ansiEscapes.cursor.show);
}

function onCommand(
  commandBuffer: CommandBuffer,
  terminal: Terminal
): CommandBuffer {
  const tokens = commandBuffer.content.split(" ");
  const command = tokens[0];

  const queryForCommand = commands.filter(
    (value) => value.name === command || value.aliases.includes(command)
  )[0];

  const commandExists = queryForCommand !== undefined;

  if (commandExists) {
    terminal.writeln("");
    terminal.writeln("");
    terminal.writeln(
      ansiEscapes.style.green +
        "Known command " +
        ansiEscapes.style.black +
        "`" +
        ansiEscapes.style.gray +
        commandBuffer.content +
        ansiEscapes.style.black +
        "`" +
        ansiEscapes.style.green +
        "." +
        ansiEscapes.style.reset
    );
    terminal.writeln("");
    terminal.write(COMMAND_LINE_PREFIX);
  } else {
    terminal.writeln("");
    terminal.writeln("");
    terminal.writeln(
      ansiEscapes.style.red +
        "Unknown command " +
        ansiEscapes.style.black +
        "`" +
        ansiEscapes.style.gray +
        commandBuffer.content +
        ansiEscapes.style.black +
        "`" +
        ansiEscapes.style.red +
        "." +
        ansiEscapes.style.reset
    );
    terminal.writeln("");
    terminal.write(COMMAND_LINE_PREFIX);
  }

  return {
    content: "",
    cursorPosition: 0,
  };
}

export function parseCommand(
  terminal: Terminal,
  event: { key: string; domEvent: KeyboardEvent }
) {
  const content = `${event.domEvent.ctrlKey ? "^" : ""}${event.domEvent.key}`;

  if (content === "^r") {
    location.reload();
    return;
  }

  switch (event.domEvent.key) {
    case "Enter":
      _commandBuffer = onCommand(_commandBuffer, terminal);
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
    case "PageDown":
    case "ArrowDown":
    case "PageUp":
    case "ArrowUp":
      break;
    case "ArrowLeft":
      if (!event.domEvent.shiftKey) {
        if (
          _commandBuffer.cursorPosition <= _commandBuffer.content.length &&
          _commandBuffer.cursorPosition > 0
        ) {
          moveCursorBack(1, terminal);

          _commandBuffer.cursorPosition += -1;
        }
      } else {
        moveCursorBack(1, terminal);
      }
      break;
    case "ArrowRight":
      if (!event.domEvent.shiftKey) {
        if (
          _commandBuffer.cursorPosition < _commandBuffer.content.length &&
          _commandBuffer.cursorPosition >= 0
        ) {
          moveCursorForward(1, terminal);

          _commandBuffer.cursorPosition += +1;
        }
      } else {
        moveCursorForward(1, terminal);
      }
      break;
    default:
      _commandBuffer = writeToTerminalAndCommandBuffer(
        content,
        _commandBuffer,
        terminal
      );
      break;
  }

  const start = _commandBuffer.content.substring(
    0,
    _commandBuffer.cursorPosition
  );
  const end = _commandBuffer.content.substring(
    _commandBuffer.cursorPosition,
    _commandBuffer.content.length
  );

  console.log({
    cursorX: terminal.buffer.active.cursorX,
    cols: terminal.cols,
    content: start + "|" + end,
    cursorPosition: _commandBuffer.cursorPosition,
  });
}
