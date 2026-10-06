import { BlockType, getWaterLevel, isWater } from "./blocks";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";

const WATER_LEVEL_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8"];

/**
 * Call once per water interval tick with the number of queued cell updates, so
 * the queue depth shows up as a gauge and ticks are counted.
 */
export function recordWaterTick(queuedUpdates: number) {
  profiler.addCounter("game.water.ticks");
  profiler.sampleGauge("game.water.queueDepth", queuedUpdates, "cells");
}

// Safe version of isWater that handles null
const safeIsWater = (block: BlockType | null): block is BlockType => {
  return block !== null && isWater(block);
};

// Safe version of getWaterLevel that handles null
const safeGetWaterLevel = (block: BlockType | null): number => {
  if (block === null) return 0;
  return getWaterLevel(block);
};

export function updateWater(
  x: number,
  y: number,
  z: number,
  getBlock: (x: number, y: number, z: number) => BlockType | null,
  setBlock: (x: number, y: number, z: number, block: BlockType) => void,
  scheduleUpdate: (x: number, y: number, z: number) => void
) {
  profiler.addCounter("game.water.cellsUpdated");
  const scopeToken = profiler.begin(
    "main.water.updateWater",
    DIMENSIONS.simulationSystem,
    "water.cellUpdate",
  );
  try {
    updateWaterCell(x, y, z, getBlock, setBlock, scheduleUpdate);
  } finally {
    profiler.end(scopeToken);
  }
}

function updateWaterCell(
  x: number,
  y: number,
  z: number,
  getBlock: (x: number, y: number, z: number) => BlockType | null,
  setBlock: (x: number, y: number, z: number, block: BlockType) => void,
  scheduleUpdate: (x: number, y: number, z: number) => void
) {
  const currentBlock = getBlock(x, y, z);

  // If not water and not air, we don't do anything (unless we want to wash away things, but let's skip for now)
  if (
    currentBlock === null ||
    (!isWater(currentBlock) && currentBlock !== BlockType.AIR)
  ) {
    profiler.addCounter(
      currentBlock === null
        ? "game.water.skippedUnloaded"
        : "game.water.skippedSolid",
    );
    return;
  }

  let newLevel = 0;
  let isSource = currentBlock === BlockType.WATER;
  let isFalling = false;

  if (isSource) {
    profiler.addCounter("game.water.sourceCellsUpdated");
    newLevel = 8;
  } else {
    const blockAbove = getBlock(x, y + 1, z);
    if (safeIsWater(blockAbove)) {
      profiler.addCounter("game.water.fedFromAbove");
      newLevel = 8;
      isFalling = true;
    } else {
      profiler.addCounter("game.water.neighborArrayAllocations");
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
        if (safeIsWater(neighbor)) {
          const level = safeGetWaterLevel(neighbor);
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
        blockBelow !== null &&
        blockBelow !== BlockType.AIR &&
        (blockBelow === BlockType.WATER || !isWater(blockBelow)); // Simplified solid check

      if (sourceNeighbors >= 2 && solidBelow) {
        profiler.addCounter("game.water.infiniteSourceConversions");
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

    profiler.addCounter("game.water.stateChanges");
    if (newLevel === 0) profiler.addCounter("game.water.cellsDrained");
    if (profiler.enabled) {
      profiler.recordBreakdown(DIMENSIONS.waterLevel, WATER_LEVEL_KEYS[newLevel], {
        units: 1,
        calls: 1,
      });
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
      profiler.addCounter("game.water.spreadDown");
      setBlock(x, y - 1, z, BlockType.WATER_FALLING);
      scheduleUpdate(x, y - 1, z);
    } else if (
      safeIsWater(blockBelow) &&
      safeGetWaterLevel(blockBelow) < 8 &&
      blockBelow !== BlockType.WATER
    ) {
      profiler.addCounter("game.water.spreadDownIntoWater");
      setBlock(x, y - 1, z, BlockType.WATER_FALLING);
      scheduleUpdate(x, y - 1, z);
    } else if (blockBelow !== null && !safeIsWater(blockBelow)) {
      // Spread Sides (blockBelow is solid - not AIR and not water)
      const spreadLevel = newLevel - 1;
      if (spreadLevel <= 0) profiler.addCounter("game.water.sideSpreadExhausted");
      if (spreadLevel > 0) {
        const spreadTo = (nx: number, ny: number, nz: number) => {
          const neighbor = getBlock(nx, ny, nz);
          if (neighbor === BlockType.AIR) {
            profiler.addCounter("game.water.spreadSide");
            setBlock(nx, ny, nz, BlockType.WATER_LEVEL_1 + spreadLevel - 1);
            scheduleUpdate(nx, ny, nz);
          } else {
            profiler.addCounter("game.water.spreadSideBlocked");
          }
        };

        spreadTo(x + 1, y, z);
        spreadTo(x - 1, y, z);
        spreadTo(x, y, z + 1);
        spreadTo(x, y, z - 1);
      }
    } else {
      profiler.addCounter("game.water.spreadDownSettled");
    }
  } else {
    profiler.addCounter("game.water.cellsWithoutWater");
  }
}
