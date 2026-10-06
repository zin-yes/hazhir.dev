// Splits a big edit batch into one batch per chunk, nearest chunk to a point first, so a brush stroke can be applied
// over several frames under a time budget (each piece relights and saves on its own) with the cells under the
// cursor on screen first.

import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";
import { profiler } from "../profiler";
import { BlockEditBatch, type BlockPosition } from "./block-edit-batch";

export function splitBatchByChunk(batch: BlockEditBatch, nearestTo: BlockPosition): BlockEditBatch[] {
  const scopeToken = profiler.begin("main.edit.splitBatch");
  try {
    return splitIntoPieces(batch, nearestTo);
  } finally {
    profiler.end(scopeToken);
  }
}

function splitIntoPieces(batch: BlockEditBatch, nearestTo: BlockPosition): BlockEditBatch[] {
  const pieces = new Map<string, { batch: BlockEditBatch; distance: number }>();
  let lastKey = "";
  let lastPiece: BlockEditBatch | null = null;
  let chunkRunSwitches = 0;
  let pieceLookupsFound = 0;
  for (let position = 0; position < batch.length; position++) {
    const chunkX = Math.floor(batch.xs[position] / CHUNK_WIDTH);
    const chunkY = Math.floor(batch.ys[position] / CHUNK_HEIGHT);
    const chunkZ = Math.floor(batch.zs[position] / CHUNK_LENGTH);
    const key = `${chunkX},${chunkY},${chunkZ}`;
    if (key !== lastKey || !lastPiece) {
      chunkRunSwitches++;
      let piece = pieces.get(key);
      if (piece) pieceLookupsFound++;
      if (!piece) {
        const distance = Math.hypot(
          (chunkX + 0.5) * CHUNK_WIDTH - nearestTo.x,
          (chunkY + 0.5) * CHUNK_HEIGHT - nearestTo.y,
          (chunkZ + 0.5) * CHUNK_LENGTH - nearestTo.z,
        );
        piece = { batch: new BlockEditBatch(batch.replaceRule, 256), distance };
        pieces.set(key, piece);
      }
      lastKey = key;
      lastPiece = piece.batch;
    }
    lastPiece.push(batch.xs[position], batch.ys[position], batch.zs[position], batch.blocks[position]);
  }
  const sortToken = profiler.begin("main.edit.slice.sortPieces");
  const orderedPieces = [...pieces.values()].sort((first, second) => first.distance - second.distance).map((piece) => piece.batch);
  profiler.end(sortToken);
  if (profiler.enabled) recordSplit(batch, orderedPieces, chunkRunSwitches, pieceLookupsFound);
  return orderedPieces;
}

function recordSplit(source: BlockEditBatch, pieces: BlockEditBatch[], chunkRunSwitches: number, pieceLookupsFound: number) {
  let allocatedBytes = 0;
  let largestPiece = 0;
  for (const piece of pieces) {
    allocatedBytes += piece.allocatedBytes;
    if (piece.length > largestPiece) largestPiece = piece.length;
    profiler.sampleGauge("game.edit.slice.cellsPerPiece", piece.length);
  }
  profiler.addCounter("game.edit.slice.batchesSplit");
  profiler.addCounter("game.edit.slice.piecesCreated", pieces.length);
  profiler.addCounter("game.edit.slice.cellsSplit", source.length);
  profiler.addCounter("game.edit.slice.chunkRunSwitches", chunkRunSwitches);
  profiler.addCounter("game.edit.slice.pieceLookupsFound", pieceLookupsFound);
  profiler.sampleGauge("game.edit.slice.piecesPerBatch", pieces.length);
  profiler.sampleGauge("game.edit.slice.largestPieceCells", largestPiece);
  profiler.recordBytes("bytes.edit.slice.pieces", allocatedBytes);
}
