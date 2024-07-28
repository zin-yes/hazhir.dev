import type { Terminal } from "@xterm/xterm";
import type { CommandCallback } from "./index";

import ansi, { Style } from "ansi-escape-sequences";

import commands from "../commands.json";

import wrap from "word-wrap";

const TOP_LEFT_CORNER = "╔";
const TOP_RIGHT_CORNER = "╗";
const BOTTOM_LEFT_CORNER = "╚";
const BOTTOM_RIGHT_CORNER = "╝";

const TOP_EDGE = "═";
const BOTTOM_EDGE = "═";
const LEFT_EDGE = "║ ";
const RIGHT_EDGE = " ║";

const HORIZONTAL_SPACER = "═";
const HORIZONTAL_SPACER_LEFT_JOINT = "╠";
const HORIZONTAL_SPACER_RIGHT_JOINT = "╣";

const HEADER_MARGIN = "  ";

const ITEM_SPACER = "─";
const ITEM_SPACER_MARGIN = " ";
const TEXT_ROW_SPACER = " ";

function constructHeaderText(text: string, width: number): string {
  const spacesLeftOver =
    width -
    (TOP_LEFT_CORNER.length +
      HEADER_MARGIN.length * 2 +
      text.length +
      TOP_RIGHT_CORNER.length);

  if (spacesLeftOver < 2) {
    return text;
  }

  let result =
    TOP_LEFT_CORNER +
    TOP_EDGE.repeat(Math.max(spacesLeftOver / 2, 0)) +
    HEADER_MARGIN +
    text +
    HEADER_MARGIN +
    TOP_EDGE.repeat(Math.max(spacesLeftOver / 2, 0)) +
    TOP_RIGHT_CORNER;

  if (result.length < width) {
    result =
      result.substring(0, result.length - TOP_RIGHT_CORNER.length) +
      TOP_EDGE.repeat(width - result.length) +
      TOP_RIGHT_CORNER;
  }

  return result;
}

function removeAllAnsiEscapeCharacters(text: string): string {
  let result = text;
  const styles: string[] = [
    "reset",
    "bold",
    "italic",
    "underline",
    "fontDefault",
    "font2",
    "font3",
    "font4",
    "font5",
    "font6",
    "imageNegative",
    "imagePositive",
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "grey",
    "gray",
    "bg-black",
    "bg-red",
    "bg-green",
    "bg-yellow",
    "bg-blue",
    "bg-magenta",
    "bg-cyan",
    "bg-white",
    "bg-grey",
    "bg-gray",
  ];

  for (let i = 0; i < styles.length; i++) {
    const style = styles[i] as Style;
    result = result.replaceAll(ansi.style[style], "");
  }

  return result;
}

function sorroundTextWithCharacters(
  text: string,
  width: number,
  spacer: string,
  leftEdge: string,
  rightEdge: string
): string {
  const spacesLeftOver =
    width -
    (removeAllAnsiEscapeCharacters(text).length +
      leftEdge.length +
      rightEdge.length);

  let result =
    leftEdge + text + spacer.repeat(Math.max(spacesLeftOver, 0)) + rightEdge;

  if (result.length < width) {
    result =
      result.substring(0, result.length - rightEdge.length) +
      spacer.repeat(width - result.length) +
      rightEdge;
  }

  return result;
}

function sorroundTextWithCharactersCentered(
  text: string,
  width: number,
  spacer: string,
  leftEdge: string,
  rightEdge: string
): string {
  const spacesLeftOver =
    width -
    (removeAllAnsiEscapeCharacters(text).length +
      leftEdge.length +
      rightEdge.length);

  let result =
    leftEdge +
    spacer.repeat(Math.max(spacesLeftOver / 2, 0)) +
    text +
    spacer.repeat(Math.max(spacesLeftOver / 2, 0)) +
    rightEdge;

  if (result.length < width) {
    result =
      result.substring(0, result.length - rightEdge.length) +
      spacer.repeat(width - result.length) +
      rightEdge;
  }

  return result;
}

function constructItemText(
  item: {
    name: string;
    usage: string[];
    examples: string[];
    aliases: string[];
    description: string;
    callbackFunctionName: string;
  },
  width: number
): string[] {
  const spacesLeftOver =
    width -
    (LEFT_EDGE.length +
      item.name.length +
      item.description.length +
      ITEM_SPACER_MARGIN.length * 2 +
      RIGHT_EDGE.length);

  if (spacesLeftOver < 2) {
    const nameSpacesLeftOver =
      width -
      (item.name.length +
        ITEM_SPACER_MARGIN.length * 2 +
        LEFT_EDGE.length +
        RIGHT_EDGE.length);
    const nameHeaderText =
      ITEM_SPACER.repeat(Math.max(nameSpacesLeftOver / 2, 0)) +
      ITEM_SPACER_MARGIN +
      ansi.style.underline +
      item.name +
      ansi.style.reset +
      ITEM_SPACER_MARGIN +
      ITEM_SPACER.repeat(Math.max(nameSpacesLeftOver / 2, 0));

    const nameHeader = sorroundTextWithCharacters(
      nameHeaderText,
      width,
      ITEM_SPACER,
      LEFT_EDGE,
      RIGHT_EDGE
    );
    let lines = [nameHeader];

    const descriptionSpacesLeftOver =
      width - (LEFT_EDGE.length + RIGHT_EDGE.length);
    wrap(item.description, { width: descriptionSpacesLeftOver - 2, indent: "" })
      .split("\n")
      .forEach((line) =>
        lines.push(
          sorroundTextWithCharacters(
            line,
            width,
            TEXT_ROW_SPACER,
            LEFT_EDGE,
            RIGHT_EDGE
          )
        )
      );
    return lines;
  }

  return [
    LEFT_EDGE +
      ansi.style.underline +
      item.name +
      ansi.style.reset +
      ITEM_SPACER_MARGIN +
      ITEM_SPACER.repeat(Math.max(spacesLeftOver, 0)) +
      ITEM_SPACER_MARGIN +
      item.description +
      RIGHT_EDGE,
  ];
}
function constructHorizontalSpacer(width: number): string {
  const spacesLeftOver =
    width -
    (HORIZONTAL_SPACER_LEFT_JOINT.length +
      HORIZONTAL_SPACER_RIGHT_JOINT.length);

  return (
    HORIZONTAL_SPACER_LEFT_JOINT +
    HORIZONTAL_SPACER.repeat(Math.max(spacesLeftOver, 0)) +
    HORIZONTAL_SPACER_RIGHT_JOINT
  );
}
function constructFooter(width: number): string {
  const spacesLeftOver =
    width - (BOTTOM_LEFT_CORNER.length + BOTTOM_RIGHT_CORNER.length);

  let result =
    BOTTOM_LEFT_CORNER +
    BOTTOM_EDGE.repeat(Math.max(spacesLeftOver / 2, 0)) +
    BOTTOM_EDGE.repeat(Math.max(spacesLeftOver / 2, 0)) +
    BOTTOM_RIGHT_CORNER;

  if (result.length < width) {
    result =
      result.substring(0, result.length - BOTTOM_RIGHT_CORNER.length) +
      BOTTOM_EDGE.repeat(width - result.length) +
      BOTTOM_RIGHT_CORNER;
  }

  return result;
}

const COMMANDS_PER_PAGE = 5;

async function help(fullCommand: string, terminal: Terminal): Promise<void> {
  const args = fullCommand.trim().split(" ");
  let currentPage = 0;

  if (args.length > 1) {
    currentPage = Number(args[1]) - 1;
  }

  const width = terminal.cols;

  const currentPageCommands = commands.slice(
    currentPage * COMMANDS_PER_PAGE,
    currentPage * COMMANDS_PER_PAGE + COMMANDS_PER_PAGE
  );

  if (currentPageCommands.length > 0) {
    terminal.writeln(" ".repeat(terminal.cols));
    terminal.writeln(constructHeaderText("HELP", width));
    currentPageCommands.map((item, index) => {
      if (item.name.length > 0) {
        constructItemText(item, width).forEach((item) => {
          terminal.writeln(item);
        });
        if (index < currentPageCommands.length - 1)
          terminal.writeln(constructHorizontalSpacer(width));
      }
    });
    terminal.writeln(constructFooter(width));
    const totalPages = Math.ceil(commands.length / COMMANDS_PER_PAGE);
    if (totalPages > 1) {
      terminal.writeln(
        sorroundTextWithCharactersCentered(
          `Page ${currentPage + 1} of ${totalPages} ${
            currentPage === 0
              ? ansi.style.gray +
                "(type 'help <page>' to see more)" +
                ansi.style.reset
              : ""
          }`,
          width,
          " ",
          "",
          ""
        )
      );
    }
    terminal.writeln(" ".repeat(terminal.cols));
  } else {
    const commandInfo = commands.find((command) => command.name === "help");
    throw new Error(
      "Incorrect command usage; usage & examples: \n\nUsage(s):\n - " +
        commandInfo?.usage.join("\n - ") +
        "\n\nExample(s):\n - " +
        commandInfo?.examples.join("\n - ")
    );
  }
}

export default help satisfies CommandCallback;
