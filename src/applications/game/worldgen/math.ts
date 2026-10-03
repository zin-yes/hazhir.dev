// Small numeric helpers shared by the terrain, climate and vegetation code.

export function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** Works for descending edges too (edgeStart > edgeEnd). */
export function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const amount = clamp((value - edgeStart) / (edgeEnd - edgeStart), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export type SplineNode = readonly [position: number, value: number];

/** Piecewise curve with eased segments, so slope is zero at every node. */
export function sampleSpline(nodes: readonly SplineNode[], position: number): number {
  if (position <= nodes[0][0]) return nodes[0][1];
  const lastNode = nodes[nodes.length - 1];
  if (position >= lastNode[0]) return lastNode[1];
  let segmentIndex = 1;
  while (nodes[segmentIndex][0] < position) segmentIndex++;
  const [startPosition, startValue] = nodes[segmentIndex - 1];
  const [endPosition, endValue] = nodes[segmentIndex];
  const amount = (position - startPosition) / (endPosition - startPosition);
  return lerp(startValue, endValue, amount * amount * (3 - 2 * amount));
}

/** Deterministic hash of an integer lattice point to [0, 1). */
export function hashToUnit(x: number, z: number, seed: number): number {
  let hash =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(z | 0, 0x165667b1) ^
    Math.imul(seed | 0, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0, 1); cheap clustering mask for plant patches. */
export function smoothValueNoise(x: number, z: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  const fractionX = x - cellX;
  const fractionZ = z - cellZ;
  const easedX = fractionX * fractionX * (3 - 2 * fractionX);
  const easedZ = fractionZ * fractionZ * (3 - 2 * fractionZ);
  const northWest = hashToUnit(cellX, cellZ, seed);
  const northEast = hashToUnit(cellX + 1, cellZ, seed);
  const southWest = hashToUnit(cellX, cellZ + 1, seed);
  const southEast = hashToUnit(cellX + 1, cellZ + 1, seed);
  return lerp(lerp(northWest, northEast, easedX), lerp(southWest, southEast, easedX), easedZ);
}
