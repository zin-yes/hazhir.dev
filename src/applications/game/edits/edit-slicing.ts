// Splits a big edit batch into one batch per chunk, nearest chunk to a point first, so a brush stroke can be applied
// over several frames under a time budget (each piece relights and saves on its own) with the cells under the
// cursor on screen first.

import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";
import { BlockEditBatch, type BlockPosition } from "./block-edit-batch";

export function splitBatchByChunk(batch: BlockEditBatch, nearestTo: BlockPosition): BlockEditBatch[] {
  const pieces = new Map<string, { batch: BlockEditBatch; distance: number }>();
  let lastKey = "";
  let lastPiece: BlockEditBatch | null = null;
  for (let position = 0; position < batch.length; position++) {
    const chunkX = Math.floor(batch.xs[position] / CHUNK_WIDTH);
    const chunkY = Math.floor(batch.ys[position] / CHUNK_HEIGHT);
    const chunkZ = Math.floor(batch.zs[position] / CHUNK_LENGTH);
    const key = `${chunkX},${chunkY},${chunkZ}`;
    if (key !== lastKey || !lastPiece) {
      let piece = pieces.get(key);
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
  return [...pieces.values()].sort((first, second) => first.distance - second.distance).map((piece) => piece.batch);
}
