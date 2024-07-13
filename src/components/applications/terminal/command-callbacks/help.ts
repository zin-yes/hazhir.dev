import type { Terminal } from "@xterm/xterm";

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

const HEADER_MARGIN = " ";

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

function sorroundTextWithEdges(
  text: string,
  width: number,
  spacer: string
): string {
  const spacesLeftOver =
    width -
    (removeAllAnsiEscapeCharacters(text).length +
      LEFT_EDGE.length +
      RIGHT_EDGE.length);

  let result =
    LEFT_EDGE + text + spacer.repeat(Math.max(spacesLeftOver, 0)) + RIGHT_EDGE;

  if (result.length < width) {
    result =
      result.substring(0, result.length - RIGHT_EDGE.length) +
      spacer.repeat(width - result.length) +
      RIGHT_EDGE;
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
    callbackName: string;
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

    const nameHeader = sorroundTextWithEdges(
      nameHeaderText,
      width,
      ITEM_SPACER
    );
    let lines = [nameHeader];

    const descriptionSpacesLeftOver =
      width - (LEFT_EDGE.length + RIGHT_EDGE.length);
    wrap(item.description, { width: descriptionSpacesLeftOver, indent: "" })
      .split("\n")
      .forEach((line) =>
        lines.push(sorroundTextWithEdges(line, width, TEXT_ROW_SPACER))
      );

    // let description = item.description;
    // const descriptionSpacesLeftOver =
    //   width - (LEFT_EDGE.length + RIGHT_EDGE.length);
    // while (description.length > descriptionSpacesLeftOver) {
    //   lines.push(
    //     sorroundTextWithEdges(
    //       description.substring(0, descriptionSpacesLeftOver),
    //       width,
    //       TEXT_ROW_SPACER
    //     )
    //   );

    //   description = description.substring(
    //     descriptionSpacesLeftOver,
    //     description.length
    //   );
    // }
    // lines.push(sorroundTextWithEdges(description, width, TEXT_ROW_SPACER));
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

export async function help(terminal: Terminal) {
  const width = terminal.cols;

  terminal.writeln("");
  terminal.writeln("");
  terminal.writeln(constructHeaderText("HELP", width));
  commands.map((item, index) => {
    constructItemText(item, width).forEach((item) => {
      terminal.writeln(item);
    });
    if (index < commands.length - 1)
      terminal.writeln(constructHorizontalSpacer(width));
  });
  terminal.writeln(constructFooter(width));
  terminal.writeln("");
}
