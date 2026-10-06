import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";

export type Vector3Tuple = [number, number, number];

export interface VoxelRayHit {
  cell: Vector3Tuple;
  /** Unit axis vector of the block face the ray entered through. */
  faceNormal: Vector3Tuple;
  point: Vector3Tuple;
  distance: number;
}

type RayOutcome = "hit" | "miss" | "startedInside";

const RAY_OUTCOME_COUNTERS: { [outcome in RayOutcome]: string } = {
  hit: "game.ray.hits",
  miss: "game.ray.misses",
  startedInside: "game.ray.startedInsideBlock",
};

/**
 * Walks the blocks along a ray one cell boundary at a time. Block cells are
 * centered on whole numbers, so their boundaries sit at k + 0.5. Returns the
 * first block for which isSolid is true, or null within maxDistance.
 */
export function castVoxelRay(
  origin: Vector3Tuple,
  direction: Vector3Tuple,
  isSolid: (x: number, y: number, z: number) => boolean,
  maxDistance: number,
  onStep?: () => void,
): VoxelRayHit | null {
  const cell = origin.map(Math.round) as Vector3Tuple;
  const step = direction.map(Math.sign) as Vector3Tuple;
  const distanceBetweenBoundaries = direction.map((component) =>
    component === 0 ? Infinity : Math.abs(1 / component),
  );
  const distanceToNextBoundary = direction.map((component, axis) =>
    component === 0
      ? Infinity
      : (cell[axis] + step[axis] * 0.5 - origin[axis]) / component,
  );
  const faceNormal: Vector3Tuple = [0, 0, 0];
  let distance = 0;
  let cellsExamined = 0;
  let stepsAlongX = 0;
  let stepsAlongY = 0;
  let stepsAlongZ = 0;

  while (distance <= maxDistance) {
    onStep?.();
    cellsExamined++;
    if (isSolid(cell[0], cell[1], cell[2])) {
      const startedInsideBlock =
        faceNormal[0] === 0 && faceNormal[1] === 0 && faceNormal[2] === 0;
      if (profiler.enabled) {
        recordRayCast(
          startedInsideBlock ? "startedInside" : "hit",
          cellsExamined,
          distance,
          maxDistance,
          stepsAlongX,
          stepsAlongY,
          stepsAlongZ,
        );
      }
      if (startedInsideBlock) {
        // The ray starts inside the block: report the face opposite the dominant look axis.
        const dominantAxis = [0, 1, 2].reduce(
          (best, axis) =>
            Math.abs(direction[axis]) > Math.abs(direction[best]) ? axis : best,
          0,
        );
        faceNormal[dominantAxis] = -step[dominantAxis] || 1;
      }
      return {
        cell,
        faceNormal,
        point: origin.map(
          (value, axis) => value + direction[axis] * distance,
        ) as Vector3Tuple,
        distance,
      };
    }

    let axis = 0;
    if (distanceToNextBoundary[1] < distanceToNextBoundary[axis]) axis = 1;
    if (distanceToNextBoundary[2] < distanceToNextBoundary[axis]) axis = 2;
    distance = distanceToNextBoundary[axis];
    distanceToNextBoundary[axis] += distanceBetweenBoundaries[axis];
    cell[axis] += step[axis];
    faceNormal[0] = faceNormal[1] = faceNormal[2] = 0;
    faceNormal[axis] = -step[axis];
    if (axis === 0) stepsAlongX++;
    else if (axis === 1) stepsAlongY++;
    else stepsAlongZ++;
  }
  if (profiler.enabled) {
    recordRayCast("miss", cellsExamined, distance, maxDistance, stepsAlongX, stepsAlongY, stepsAlongZ);
  }
  return null;
}

function recordRayCast(
  outcome: RayOutcome,
  cellsExamined: number,
  distance: number,
  maxDistance: number,
  stepsAlongX: number,
  stepsAlongY: number,
  stepsAlongZ: number,
) {
  profiler.addCounter("game.ray.casts");
  profiler.addCounter(RAY_OUTCOME_COUNTERS[outcome]);
  profiler.addCounter("game.ray.cellsExamined", cellsExamined);
  profiler.addCounter("game.ray.stepsAlongX", stepsAlongX);
  profiler.addCounter("game.ray.stepsAlongY", stepsAlongY);
  profiler.addCounter("game.ray.stepsAlongZ", stepsAlongZ);
  profiler.sampleGauge("game.ray.cellsPerCast", cellsExamined);
  profiler.sampleGauge("game.ray.maxDistanceRequested", maxDistance, "blocks");
  if (outcome !== "miss") profiler.sampleGauge("game.ray.hitDistance", distance, "blocks");
  profiler.recordBreakdown(DIMENSIONS.rayOutcome, outcome, { units: cellsExamined, calls: 1 });
}
