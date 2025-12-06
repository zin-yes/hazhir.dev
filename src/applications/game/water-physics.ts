import { BlockType, getWaterLevel, isWater } from "./blocks";

export function updateWater(
  x: number,
  y: number,
  z: number,
  getBlock: (x: number, y: number, z: number) => BlockType,
  setBlock: (x: number, y: number, z: number, block: BlockType) => void,
  scheduleUpdate: (x: number, y: number, z: number) => void
) {
  const currentBlock = getBlock(x, y, z);

  // If not water and not air, we don't do anything (unless we want to wash away things, but let's skip for now)
  if (!isWater(currentBlock) && currentBlock !== BlockType.AIR) return;

  let newLevel = 0;
  let isSource = currentBlock === BlockType.WATER;
  let isFalling = false;

  if (isSource) {
    newLevel = 8;
  } else {
    const blockAbove = getBlock(x, y + 1, z);
    if (isWater(blockAbove)) {
      newLevel = 8;
      isFalling = true;
    } else {
      // Check side neighbors
      let maxNeighborLevel = 0;
      let sourceNeighbors = 0;

      const neighbors = [
        getBlock(x + 1, y, z),
        getBlock(x - 1, y, z),
        getBlock(x, y, z + 1),
        getBlock(x, y, z - 1),
      ];

      for (const neighbor of neighbors) {
        if (isWater(neighbor)) {
          const level = getWaterLevel(neighbor);
          if (level > maxNeighborLevel) {
            maxNeighborLevel = level;
          }
          if (neighbor === BlockType.WATER) {
            sourceNeighbors++;
          }
        }
      }

      // Infinite water source rule
      // If 2 sources and solid block below (or water below?)
      // Minecraft: "horizontally adjacent to two or more other source blocks, and sitting on top of a solid block or another water source block"
      const blockBelow = getBlock(x, y - 1, z);
      const solidBelow =
        blockBelow !== BlockType.AIR &&
        (blockBelow === BlockType.WATER || !isWater(blockBelow)); // Simplified solid check

      if (sourceNeighbors >= 2 && solidBelow) {
        newLevel = 8;
        isSource = true; // Becomes source
      } else {
        newLevel = maxNeighborLevel - 1;
      }
    }
  }

  if (newLevel < 0) newLevel = 0;

  const currentLevel = isWater(currentBlock) ? getWaterLevel(currentBlock) : 0;

  // If state changed
  if (
    newLevel !== currentLevel ||
    (newLevel === 8 &&
      isFalling !== (currentBlock === BlockType.WATER_FALLING) &&
      !isSource)
  ) {
    if (newLevel === 0) {
      setBlock(x, y, z, BlockType.AIR);
    } else {
      let newType;
      if (newLevel === 8) {
        newType = isSource ? BlockType.WATER : BlockType.WATER_FALLING;
      } else {
        newType = BlockType.WATER_LEVEL_1 + newLevel - 1;
      }
      setBlock(x, y, z, newType);
    }

    // Schedule neighbors for update
    scheduleUpdate(x + 1, y, z);
    scheduleUpdate(x - 1, y, z);
    scheduleUpdate(x, y, z + 1);
    scheduleUpdate(x, y, z - 1);
    scheduleUpdate(x, y - 1, z);
    scheduleUpdate(x, y + 1, z);

    // If we changed, we stop here and let the next tick handle spreading from the new state
    return;
  }

  // If state didn't change, try to spread
  if (newLevel > 0) {
    // Spread Down
    const blockBelow = getBlock(x, y - 1, z);
    if (blockBelow === BlockType.AIR) {
      setBlock(x, y - 1, z, BlockType.WATER_FALLING);
      scheduleUpdate(x, y - 1, z);
    } else if (
      isWater(blockBelow) &&
      getWaterLevel(blockBelow) < 8 &&
      blockBelow !== BlockType.WATER
    ) {
      setBlock(x, y - 1, z, BlockType.WATER_FALLING);
      scheduleUpdate(x, y - 1, z);
    } else if (blockBelow !== BlockType.AIR && !isWater(blockBelow)) {
      // Spread Sides
      const spreadLevel = newLevel - 1;
      if (spreadLevel > 0) {
        const spreadTo = (nx: number, ny: number, nz: number) => {
          const neighbor = getBlock(nx, ny, nz);
          if (neighbor === BlockType.AIR) {
            setBlock(nx, ny, nz, BlockType.WATER_LEVEL_1 + spreadLevel - 1);
            scheduleUpdate(nx, ny, nz);
          }
        };

        spreadTo(x + 1, y, z);
        spreadTo(x - 1, y, z);
        spreadTo(x, y, z + 1);
        spreadTo(x, y, z - 1);
      }
    }
  }
}
