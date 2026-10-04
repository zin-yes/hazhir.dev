// Run: bun src/applications/game/world/chunk-compression.benchmark.ts [columnsPerSide]
// Compresses real generated terrain (6x6 columns by default) and prints sizes and timings.

import {
  CHUNK_CELL_COUNT,
  byteSize,
  compress,
  decompressInto,
  readCell,
  type CompressedChunk,
} from "./chunk-compression";
import { loadRealisticChunks } from "./realistic-chunk-fixture";

const DEFAULT_COLUMNS_PER_SIDE = 6;
const TIMING_REPEATS = 5;
const RANDOM_READS_PER_CHUNK = 1000;

interface ChannelReport {
  name: string;
  averageCompressedBytes: number;
  averageNonUniformBytes: number;
  compressionRatio: number;
  compressMillisecondsPerChunk: number;
  decompressMillisecondsPerChunk: number;
  readCellNanoseconds: number;
  kindCounts: Record<string, number>;
}

function measureChannel(name: string, channels: Uint8Array[]): ChannelReport {
  const kindCounts: Record<string, number> = {};
  let compressed: CompressedChunk[] = [];
  const compressStartedAt = performance.now();
  for (let repeat = 0; repeat < TIMING_REPEATS; repeat++) compressed = channels.map((cells) => compress(cells));
  const compressMilliseconds = performance.now() - compressStartedAt;

  const target = new Uint8Array(CHUNK_CELL_COUNT);
  const decompressStartedAt = performance.now();
  for (let repeat = 0; repeat < TIMING_REPEATS; repeat++) {
    for (const chunk of compressed) decompressInto(chunk, target);
  }
  const decompressMilliseconds = performance.now() - decompressStartedAt;

  let checksum = 0;
  const readStartedAt = performance.now();
  for (const chunk of compressed) {
    for (let read = 0; read < RANDOM_READS_PER_CHUNK; read++) checksum += readCell(chunk, (read * 7919) % CHUNK_CELL_COUNT);
  }
  const readNanoseconds = ((performance.now() - readStartedAt) * 1e6) / (compressed.length * RANDOM_READS_PER_CHUNK);
  if (checksum < 0) throw new Error("unreachable, keeps the read loop observable");

  let totalBytes = 0;
  let nonUniformCount = 0;
  for (const chunk of compressed) {
    totalBytes += byteSize(chunk);
    if (chunk.kind !== "uniform") nonUniformCount++;
    kindCounts[chunk.kind] = (kindCounts[chunk.kind] ?? 0) + 1;
  }
  const averageCompressedBytes = totalBytes / compressed.length;
  return {
    name,
    averageCompressedBytes,
    averageNonUniformBytes: totalBytes / Math.max(nonUniformCount, 1),
    compressionRatio: CHUNK_CELL_COUNT / Math.max(averageCompressedBytes, 1),
    compressMillisecondsPerChunk: compressMilliseconds / (TIMING_REPEATS * channels.length),
    decompressMillisecondsPerChunk: decompressMilliseconds / (TIMING_REPEATS * channels.length),
    readCellNanoseconds: readNanoseconds,
    kindCounts,
  };
}

const columnsPerSide = Number(process.argv[2] ?? DEFAULT_COLUMNS_PER_SIDE);
const generationStartedAt = performance.now();
const chunks = loadRealisticChunks(columnsPerSide);
console.log(`loaded ${chunks.length} chunks (${columnsPerSide}x${columnsPerSide} columns) in ${(performance.now() - generationStartedAt).toFixed(0)} ms`);

for (const report of [
  measureChannel("blocks", chunks.map((chunk) => chunk.blocks)),
  measureChannel("light", chunks.map((chunk) => chunk.light)),
]) {
  console.log(
    [
      `${report.name}: avg ${report.averageCompressedBytes.toFixed(0)} B of ${CHUNK_CELL_COUNT} B`,
      `non-uniform avg ${report.averageNonUniformBytes.toFixed(0)} B`,
      `ratio ${report.compressionRatio.toFixed(1)}x`,
      `compress ${report.compressMillisecondsPerChunk.toFixed(3)} ms/chunk`,
      `decompress ${report.decompressMillisecondsPerChunk.toFixed(3)} ms/chunk`,
      `readCell ${report.readCellNanoseconds.toFixed(0)} ns`,
      `kinds ${JSON.stringify(report.kindCounts)}`,
    ].join(" | "),
  );
}
