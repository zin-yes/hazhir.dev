// Real generated terrain for tests and benchmarks. Generation is slow (seconds for the first chunk, 100+ ms per
// column afterwards), so the result is cached in the OS temp directory, never in the repository.
//
// Light is a stand-in: initializeChunkLight run top-down per column with full sky above the world. It has sky
// columns and block emitters but no horizontal spreading, so it is smoother than the live light would be.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeChunkLight } from "@/applications/game/workers/lighting";
import { generateChunkBlocks } from "@/applications/game/worldgen/chunk-generator";
import { CHUNK_CELL_COUNT } from "./chunk-compression";

const FIXTURE_FORMAT_VERSION = 1;
const FULL_SKY_LIGHT = 0xf0;

export const REALISTIC_FIXTURE_SEED = 2024;
export const REALISTIC_LOWEST_CHUNK_Y = -2;
export const REALISTIC_HIGHEST_CHUNK_Y = 10;

export interface RealisticChunk {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  blocks: Uint8Array;
  light: Uint8Array;
}

function listChunkCoordinates(columnsPerSide: number): [number, number, number][] {
  const firstColumn = -Math.floor(columnsPerSide / 2);
  const coordinates: [number, number, number][] = [];
  for (let chunkX = firstColumn; chunkX < firstColumn + columnsPerSide; chunkX++) {
    for (let chunkZ = firstColumn; chunkZ < firstColumn + columnsPerSide; chunkZ++) {
      for (let chunkY = REALISTIC_LOWEST_CHUNK_Y; chunkY <= REALISTIC_HIGHEST_CHUNK_Y; chunkY++) {
        coordinates.push([chunkX, chunkY, chunkZ]);
      }
    }
  }
  return coordinates;
}

function generateColumn(chunkX: number, chunkZ: number): RealisticChunk[] {
  const column: RealisticChunk[] = [];
  let lightOfChunkAbove: Uint8Array = new Uint8Array(CHUNK_CELL_COUNT).fill(FULL_SKY_LIGHT);
  for (let chunkY = REALISTIC_HIGHEST_CHUNK_Y; chunkY >= REALISTIC_LOWEST_CHUNK_Y; chunkY--) {
    const blocks = generateChunkBlocks(REALISTIC_FIXTURE_SEED, chunkX, chunkY, chunkZ);
    const { light } = initializeChunkLight(blocks, REALISTIC_FIXTURE_SEED, chunkX, chunkY, chunkZ, undefined, lightOfChunkAbove);
    column.push({ chunkX, chunkY, chunkZ, blocks, light });
    lightOfChunkAbove = light;
  }
  return column.reverse();
}

function cachePathFor(columnsPerSide: number): string {
  return join(tmpdir(), `hazhir-dev-voxel-fixture-v${FIXTURE_FORMAT_VERSION}-seed${REALISTIC_FIXTURE_SEED}-${columnsPerSide}x${columnsPerSide}.bin`);
}

function readCache(columnsPerSide: number): RealisticChunk[] | undefined {
  const cachePath = cachePathFor(columnsPerSide);
  if (!existsSync(cachePath)) return undefined;
  const coordinates = listChunkCoordinates(columnsPerSide);
  const bytes = readFileSync(cachePath);
  if (bytes.byteLength !== coordinates.length * CHUNK_CELL_COUNT * 2) return undefined;
  return coordinates.map(([chunkX, chunkY, chunkZ], chunkIndex) => {
    const start = chunkIndex * CHUNK_CELL_COUNT * 2;
    return {
      chunkX,
      chunkY,
      chunkZ,
      blocks: Uint8Array.from(bytes.subarray(start, start + CHUNK_CELL_COUNT)),
      light: Uint8Array.from(bytes.subarray(start + CHUNK_CELL_COUNT, start + CHUNK_CELL_COUNT * 2)),
    };
  });
}

function writeCache(columnsPerSide: number, chunks: RealisticChunk[]): void {
  const bytes = new Uint8Array(chunks.length * CHUNK_CELL_COUNT * 2);
  chunks.forEach((chunk, chunkIndex) => {
    bytes.set(chunk.blocks, chunkIndex * CHUNK_CELL_COUNT * 2);
    bytes.set(chunk.light, chunkIndex * CHUNK_CELL_COUNT * 2 + CHUNK_CELL_COUNT);
  });
  const cachePath = cachePathFor(columnsPerSide);
  const partialPath = `${cachePath}.${process.pid}.partial`;
  writeFileSync(partialPath, bytes);
  renameSync(partialPath, cachePath);
}

/** Every vertical chunk of a square block of columns centered on the origin, ordered x, then z, then y. */
export function loadRealisticChunks(columnsPerSide: number): RealisticChunk[] {
  const cached = readCache(columnsPerSide);
  if (cached) return cached;
  const firstColumn = -Math.floor(columnsPerSide / 2);
  const chunks: RealisticChunk[] = [];
  for (let chunkX = firstColumn; chunkX < firstColumn + columnsPerSide; chunkX++) {
    for (let chunkZ = firstColumn; chunkZ < firstColumn + columnsPerSide; chunkZ++) {
      chunks.push(...generateColumn(chunkX, chunkZ));
    }
  }
  writeCache(columnsPerSide, chunks);
  return chunks;
}
