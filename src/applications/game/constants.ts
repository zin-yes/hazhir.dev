import { BlockType } from "./blocks";

export const HOTBAR_SIZE = 9;

export function normalizeHotbar(slots: BlockType[] | undefined): BlockType[] {
  const arr = Array.isArray(slots) ? [...slots] : [];
  if (arr.length > HOTBAR_SIZE) return arr.slice(0, HOTBAR_SIZE);
  if (arr.length < HOTBAR_SIZE) {
    const padded = arr.concat(
      new Array(HOTBAR_SIZE - arr.length).fill(BlockType.AIR)
    );
    return padded;
  }
  return arr;
}
