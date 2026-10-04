import type { ReactNode } from "react";

/** Each icon is drawn on an 8 by 8 grid of whole pixels so it stays crisp at any button size. */
const ICON_PIXELS: Record<TouchIconName, string[]> = {
  jump: [
    "...##...",
    "..####..",
    ".######.",
    "########",
    "...##...",
    "...##...",
    "...##...",
    "........",
  ],
  break: [
    ".#####..",
    "#######.",
    "..#.####",
    ".#.#.###",
    ".#..#.##",
    "#....#.#",
    "#.....#.",
    "........",
  ],
  place: [
    ".######.",
    "########",
    "##....##",
    "##.##.##",
    "##.##.##",
    "##....##",
    "########",
    ".######.",
  ],
  fly: [
    "........",
    "#......#",
    "##....##",
    "###..###",
    "########",
    ".######.",
    "..####..",
    "........",
  ],
  inventory: [
    "........",
    "########",
    "........",
    "########",
    "........",
    "########",
    "........",
    "........",
  ],
};

export type TouchIconName = "jump" | "break" | "place" | "fly" | "inventory";

export function TouchIcon({ name, size }: { name: TouchIconName; size: number }): ReactNode {
  const rows = ICON_PIXELS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" fill="currentColor">
      {rows.flatMap((row, rowIndex) =>
        Array.from(row).map((cell, columnIndex) =>
          cell === "#" ? <rect key={`${rowIndex}-${columnIndex}`} x={columnIndex} y={rowIndex} width={1} height={1} /> : null,
        ),
      )}
    </svg>
  );
}
