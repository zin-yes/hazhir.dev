// Mirrors the iteration orders of BlockPos.withinManhattan and BlockPos.betweenClosed. The yielded object is
// reused between iterations, as the Java cursor is, so copy it when it must outlive the loop step.

import type { BlockPosLike } from "../../core/block-pos";

export interface CursorPosition {
  x: number;
  y: number;
  z: number;
}

/** BlockPos.withinManhattan(origin, radiusX, radiusY, radiusZ): ascending manhattan distance, z mirrored last. */
export function* withinManhattan(origin: BlockPosLike, radiusX: number, radiusY: number, radiusZ: number): Generator<CursorPosition> {
  const maxDepth = radiusX + radiusY + radiusZ;
  const cursor: CursorPosition = { x: 0, y: 0, z: 0 };
  let currentDepth = 0;
  let maxX = 0;
  let maxY = 0;
  let x = 0;
  let y = 0;
  while (true) {
    let found = false;
    while (!found) {
      if (y > maxY) {
        x++;
        if (x > maxX) {
          currentDepth++;
          if (currentDepth > maxDepth) return;
          maxX = Math.min(radiusX, currentDepth);
          x = -maxX;
        }
        maxY = Math.min(radiusY, currentDepth - Math.abs(x));
        y = -maxY;
      }
      const offsetX = x;
      const offsetY = y;
      const offsetZ = currentDepth - Math.abs(offsetX) - Math.abs(offsetY);
      if (offsetZ <= radiusZ) {
        cursor.x = origin.x + offsetX;
        cursor.y = origin.y + offsetY;
        cursor.z = origin.z + offsetZ;
        found = true;
        yield cursor;
        if (offsetZ !== 0) {
          cursor.z = origin.z - (cursor.z - origin.z);
          yield cursor;
        }
      }
      y++;
    }
  }
}

/** BlockPos.betweenClosed(minX, minY, minZ, maxX, maxY, maxZ): x fastest, then y, then z. */
export function* betweenClosed(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Generator<CursorPosition> {
  const sizeX = maxX - minX + 1;
  const sizeY = maxY - minY + 1;
  const sizeZ = maxZ - minZ + 1;
  const total = sizeX * sizeY * sizeZ;
  const cursor: CursorPosition = { x: 0, y: 0, z: 0 };
  for (let index = 0; index < total; index++) {
    const columnIndex = Math.floor(index / sizeX);
    cursor.x = minX + (index % sizeX);
    cursor.y = minY + (columnIndex % sizeY);
    cursor.z = minZ + Math.floor(columnIndex / sizeY);
    yield cursor;
  }
}
