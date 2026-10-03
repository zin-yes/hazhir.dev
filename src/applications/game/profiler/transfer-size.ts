const MAX_DEPTH = 6;
const NUMBER_BYTES = 8;
const BOOLEAN_BYTES = 1;

/**
 * Estimates how many bytes structured clone has to copy for a value passed
 * through postMessage. Typed arrays and ArrayBuffers dominate; an ArrayBuffer
 * referenced more than once in the same message is counted once because
 * structured clone preserves object identity.
 */
export function estimateTransferBytes(value: unknown): number {
  return estimateInto(value, new Set<object>(), 0);
}

function estimateInto(value: unknown, seen: Set<object>, depth: number): number {
  if (value === null || value === undefined) return 0;
  switch (typeof value) {
    case "number":
      return NUMBER_BYTES;
    case "boolean":
      return BOOLEAN_BYTES;
    case "string":
      return value.length;
    case "bigint":
      return NUMBER_BYTES;
    case "object":
      break;
    default:
      return 0;
  }
  if (depth > MAX_DEPTH) return 0;

  const object = value as object;
  if (object instanceof ArrayBuffer) {
    return countOnce(object, seen, object.byteLength);
  }
  if (ArrayBuffer.isView(object)) {
    const backingBuffer = object.buffer;
    return countOnce(backingBuffer, seen, backingBuffer.byteLength);
  }
  if (seen.has(object)) return 0;
  seen.add(object);

  if (Array.isArray(object)) {
    let total = 0;
    for (const element of object) total += estimateInto(element, seen, depth + 1);
    return total;
  }

  let total = 0;
  for (const key of Object.keys(object)) {
    total += key.length;
    total += estimateInto((object as Record<string, unknown>)[key], seen, depth + 1);
  }
  return total;
}

function countOnce(buffer: object, seen: Set<object>, bytes: number): number {
  if (seen.has(buffer)) return 0;
  seen.add(buffer);
  return bytes;
}
