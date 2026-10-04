// Game chunks from the Terralith engine. A game chunk (32^3) covers 2x2 Minecraft chunk columns; the engine
// generates a whole 16x16 column over the full world height, so converting all four columns once yields every
// vertical game chunk of that footprint. Those are kept in a bounded per-seed cache, because vertical neighbours
// are requested one by one.

import { BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import {
  addWorkerCounter,
  addWorkerKeyedUnits,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import { BoundedLruCache, packChunkColumnKey } from "./engine/pipeline/bounded-lru-cache";
import { toGameBlockOrAir } from "./engine/blocks/lenient-block-map";
import { blockNameOf, CHUNK_COLUMN_SIZE, type ChunkBlocks } from "./engine/chunk";
import { GAME_Y_OFFSET } from "./constants";
import { getFullWorld, type FullWorld } from "./overworld-world";

const GAME_CHUNK_VOLUME = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;
const X_STRIDE = CHUNK_HEIGHT * CHUNK_LENGTH;
const Y_STRIDE = CHUNK_LENGTH;
const MINECRAFT_COLUMNS_PER_GAME_CHUNK_X = CHUNK_WIDTH / CHUNK_COLUMN_SIZE;
const MINECRAFT_COLUMNS_PER_GAME_CHUNK_Z = CHUNK_LENGTH / CHUNK_COLUMN_SIZE;
const MAX_CACHED_GAME_COLUMNS = 64;
const MAX_CACHED_SEEDS = 2;
const UNMAPPED_GAME_BLOCK_KEY = "unmapped";

/** All vertical chunks of one game column; a missing chunk y is entirely air. */
type GameColumn = Map<number, Uint8Array>;

class SeedChunkSource {
  private readonly world: FullWorld;
  private readonly gameColumns = new BoundedLruCache<number, GameColumn>(MAX_CACHED_GAME_COLUMNS);
  private readonly gameBlockByPaletteId: BlockType[] = [];
  private readonly unknownByPaletteId: boolean[] = [];

  constructor(seed: number) {
    this.world = getFullWorld(seed);
  }

  private gameBlockOf(column: ChunkBlocks, paletteId: number): BlockType {
    let gameBlock = this.gameBlockByPaletteId[paletteId];
    if (gameBlock === undefined) {
      if (isWorkerProfiling()) {
        startWorkerSection("convert.paletteLookup");
        addWorkerCounter("paletteLookupMisses", 1);
      }
      const lookup = toGameBlockOrAir(column.palette.stateOf(paletteId));
      gameBlock = lookup.gameBlock;
      this.gameBlockByPaletteId[paletteId] = gameBlock;
      this.unknownByPaletteId[paletteId] = lookup.isUnknown;
      if (isWorkerProfiling()) endWorkerSection();
    }
    return gameBlock;
  }

  /**
   * Block statistics of one decorated column: one counting pass over the palette ids, then one keyed flush per block
   * name and per game block type (never per block). Runs only while profiling.
   */
  private recordBlockStatistics(column: ChunkBlocks): void {
    const idCounts = new Uint32Array(column.palette.size);
    const blocks = column.blocks;
    for (let index = 0; index < blocks.length; index++) idCounts[blocks[index]!]++;
    const unitsByBlockName = new Map<string, number>();
    const unitsByGameBlock = new Map<string, number>();
    let distinctPaletteIds = 0;
    for (let paletteId = 1; paletteId < idCounts.length; paletteId++) {
      const count = idCounts[paletteId]!;
      if (count === 0) continue;
      distinctPaletteIds++;
      const blockName = blockNameOf(column.palette.stateOf(paletteId));
      unitsByBlockName.set(blockName, (unitsByBlockName.get(blockName) ?? 0) + count);
      const gameBlock = this.gameBlockOf(column, paletteId);
      if (gameBlock !== BlockType.AIR || this.unknownByPaletteId[paletteId]) {
        const gameBlockName = this.unknownByPaletteId[paletteId] ? UNMAPPED_GAME_BLOCK_KEY : BlockType[gameBlock]!;
        unitsByGameBlock.set(gameBlockName, (unitsByGameBlock.get(gameBlockName) ?? 0) + count);
      }
    }
    for (const [blockName, units] of unitsByBlockName) addWorkerKeyedUnits(DIMENSIONS.worldgenBlock, blockName, units);
    for (const [gameBlockName, units] of unitsByGameBlock) addWorkerKeyedUnits(DIMENSIONS.gameBlock, gameBlockName, units);
    addWorkerCounter("distinctPaletteIdsPerColumn", distinctPaletteIds);
  }

  private buildGameColumn(chunkX: number, chunkZ: number): GameColumn {
    startWorkerSection("convert.buildGameColumn");
    try {
      return this.convertDecoratedColumns(chunkX, chunkZ);
    } finally {
      endWorkerSection();
    }
  }

  private convertDecoratedColumns(chunkX: number, chunkZ: number): GameColumn {
    const isProfiling = isWorkerProfiling();
    const gameColumn: GameColumn = new Map();
    let solidBlocks = 0;
    let unknownBlocks = 0;
    for (let columnOffsetX = 0; columnOffsetX < MINECRAFT_COLUMNS_PER_GAME_CHUNK_X; columnOffsetX++) {
      for (let columnOffsetZ = 0; columnOffsetZ < MINECRAFT_COLUMNS_PER_GAME_CHUNK_Z; columnOffsetZ++) {
        const column = this.world.generateDecoratedColumn(
          chunkX * MINECRAFT_COLUMNS_PER_GAME_CHUNK_X + columnOffsetX,
          chunkZ * MINECRAFT_COLUMNS_PER_GAME_CHUNK_Z + columnOffsetZ,
        );
        const blocks = column.blocks;
        if (isProfiling) {
          startWorkerSection("convert.blockStatistics");
          this.recordBlockStatistics(column);
          endWorkerSection();
          startWorkerSection("convert.paletteToGameBlocks");
        }
        for (let minecraftY = column.minY; minecraftY <= column.maxY; minecraftY++) {
          const gameY = minecraftY + GAME_Y_OFFSET;
          const chunkY = Math.floor(gameY / CHUNK_HEIGHT);
          const localY = gameY - chunkY * CHUNK_HEIGHT;
          const layerStart = column.indexOf(0, minecraftY, 0);
          let chunkBlocks = gameColumn.get(chunkY);
          for (let localColumnZ = 0; localColumnZ < CHUNK_COLUMN_SIZE; localColumnZ++) {
            for (let localColumnX = 0; localColumnX < CHUNK_COLUMN_SIZE; localColumnX++) {
              const paletteId = blocks[layerStart + localColumnZ * CHUNK_COLUMN_SIZE + localColumnX]!;
              if (paletteId === 0) continue;
              const gameBlock = this.gameBlockOf(column, paletteId);
              if (gameBlock === BlockType.AIR) {
                if (this.unknownByPaletteId[paletteId]) unknownBlocks++;
                continue;
              }
              if (chunkBlocks === undefined) {
                chunkBlocks = new Uint8Array(GAME_CHUNK_VOLUME);
                gameColumn.set(chunkY, chunkBlocks);
              }
              const localX = columnOffsetX * CHUNK_COLUMN_SIZE + localColumnX;
              const localZ = columnOffsetZ * CHUNK_COLUMN_SIZE + localColumnZ;
              chunkBlocks[localX * X_STRIDE + localY * Y_STRIDE + localZ] = gameBlock;
              solidBlocks++;
            }
          }
        }
        if (isProfiling) endWorkerSection();
      }
    }
    addWorkerCounter("solidBlocks", solidBlocks);
    addWorkerCounter("unknownBlockNames", unknownBlocks);
    addWorkerCounter("gameColumnsConverted", 1);
    return gameColumn;
  }

  chunkBlocks(chunkX: number, chunkY: number, chunkZ: number): Uint8Array {
    const { minY, height } = this.world.generator.settings;
    const lowestGameY = minY + GAME_Y_OFFSET;
    const highestGameY = minY + height - 1 + GAME_Y_OFFSET;
    const isOutsideWorldHeight = (chunkY + 1) * CHUNK_HEIGHT - 1 < lowestGameY || chunkY * CHUNK_HEIGHT > highestGameY;
    if (isOutsideWorldHeight) {
      addWorkerCounter("verticalChunksOutsideWorld", 1);
      return new Uint8Array(GAME_CHUNK_VOLUME);
    }

    const key = packChunkColumnKey(chunkX, chunkZ);
    let gameColumn = this.gameColumns.get(key);
    if (gameColumn === undefined) {
      addWorkerCounter("gameColumnCacheMisses", 1);
      gameColumn = this.buildGameColumn(chunkX, chunkZ);
      this.gameColumns.set(key, gameColumn);
    } else {
      addWorkerCounter("gameColumnCacheHits", 1);
    }
    startWorkerSection("chunk.assembleVertical");
    const cached = gameColumn.get(chunkY);
    // The caller transfers the buffer to another thread, so it must own its copy.
    const assembled = cached === undefined ? new Uint8Array(GAME_CHUNK_VOLUME) : cached.slice();
    endWorkerSection();
    addWorkerCounter(cached === undefined ? "emptyVerticalChunks" : "verticalChunksCopied", 1);
    return assembled;
  }
}

const sourcesBySeed = new Map<number, SeedChunkSource>();

function sourceForSeed(seed: number): SeedChunkSource {
  let source = sourcesBySeed.get(seed);
  if (source === undefined) {
    if (sourcesBySeed.size >= MAX_CACHED_SEEDS) sourcesBySeed.delete(sourcesBySeed.keys().next().value as number);
    source = new SeedChunkSource(seed);
  } else {
    sourcesBySeed.delete(seed);
  }
  sourcesBySeed.set(seed, source);
  return source;
}

export function generateChunkBlocks(seed: number, chunkX: number, chunkY: number, chunkZ: number): Uint8Array {
  startWorkerSection("terrainNoise");
  let blocks: Uint8Array;
  try {
    blocks = sourceForSeed(seed).chunkBlocks(chunkX, chunkY, chunkZ);
  } finally {
    endWorkerSection();
  }
  addWorkerCounter("blocksGenerated", blocks.length);
  addWorkerCounter("verticalChunksGenerated", 1);
  return blocks;
}
