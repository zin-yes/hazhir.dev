import { type BlockType, getWaterLevel, isWater } from "./blocks";

const WATER_LEVELS_PER_BLOCK = 9;
const POSITION_UNITS_PER_BLOCK = 16;
const MAXIMUM_COLUMN_CLIMB = 64;

type BlockAt = (x: number, y: number, z: number) => BlockType | null;

function isWaterCell(block: BlockType | null): boolean {
  return block !== null && isWater(block);
}

/**
 * Height of the water surface in the column at `position`, or null when there is no water at or just under it. A cell
 * centred on integer y spans y - 0.5 to y + 0.5. A cell with water above it is full; the topmost water cell is as
 * tall as the mesher draws it (see workers/mesh.ts), so the number matches the surface on screen.
 */
export function findWaterSurfaceHeight(getBlock: BlockAt, position: { x: number; y: number; z: number }): number | null {
  const cellX = Math.round(position.x);
  const cellZ = Math.round(position.z);
  let cellY = Math.round(position.y);
  if (!isWaterCell(getBlock(cellX, cellY, cellZ))) {
    cellY -= 1;
    if (!isWaterCell(getBlock(cellX, cellY, cellZ))) return null;
  }
  for (let climbed = 0; climbed < MAXIMUM_COLUMN_CLIMB; climbed++) {
    if (!isWaterCell(getBlock(cellX, cellY + 1, cellZ))) break;
    cellY += 1;
  }
  const topCell = getBlock(cellX, cellY, cellZ);
  if (topCell === null) return null;
  const topHeight16 = Math.round((getWaterLevel(topCell) / WATER_LEVELS_PER_BLOCK) * POSITION_UNITS_PER_BLOCK);
  return cellY - 0.5 + topHeight16 / POSITION_UNITS_PER_BLOCK;
}
