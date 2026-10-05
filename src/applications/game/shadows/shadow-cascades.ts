// Pure math for cascaded sun shadows: where each cascade ends along the view, and the light-space box that covers its
// slice of the view frustum. Each box is a sphere fitted around the slice (so it does not change size as the camera
// turns) and snapped to whole shadow texels (so edges do not shimmer as the camera moves).

export type Vector3Tuple = [number, number, number];

export interface CascadeBox {
  /** Centre of the box in world space, snapped to the shadow texel grid in the light's plane. */
  center: Vector3Tuple;
  /** Half the width of the square the shadow map covers, in blocks. */
  halfExtent: number;
  /** Blocks of world covered by one shadow texel. */
  texelWorldSize: number;
}

/** View distances (blocks) where each cascade ends, growing geometrically so near shadows get the sharpest map. */
export function cascadeEndDistances(firstEnd: number, lastEnd: number, cascadeCount: number): number[] {
  if (cascadeCount === 1) return [lastEnd];
  return Array.from({ length: cascadeCount }, (_, index) => firstEnd * (lastEnd / firstEnd) ** (index / (cascadeCount - 1)));
}

function dot(first: Vector3Tuple, second: Vector3Tuple): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function cross(first: Vector3Tuple, second: Vector3Tuple): Vector3Tuple {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function normalized(vector: Vector3Tuple): Vector3Tuple {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/** Two unit vectors that span the plane perpendicular to the light. */
export function lightPlaneAxes(lightDirection: Vector3Tuple): { right: Vector3Tuple; up: Vector3Tuple } {
  const reference: Vector3Tuple = Math.abs(lightDirection[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const right = normalized(cross(reference, lightDirection));
  const up = cross(lightDirection, right);
  return { right, up };
}

export interface FrustumSlice {
  cameraPosition: Vector3Tuple;
  cameraForward: Vector3Tuple;
  verticalFieldOfViewRadians: number;
  aspect: number;
  nearDistance: number;
  farDistance: number;
}

/** Bounding sphere of the view frustum between two distances. */
export function frustumSliceSphere(slice: FrustumSlice): { center: Vector3Tuple; radius: number } {
  const tangentY = Math.tan(slice.verticalFieldOfViewRadians / 2);
  const tangentX = tangentY * slice.aspect;
  const { nearDistance, farDistance } = slice;
  const farCornerDistanceSquared = farDistance * farDistance * (1 + tangentX * tangentX + tangentY * tangentY);
  const nearCornerDistanceSquared = nearDistance * nearDistance * (1 + tangentX * tangentX + tangentY * tangentY);
  const centerDistance = (farCornerDistanceSquared - nearCornerDistanceSquared) / (2 * (farDistance - nearDistance));
  const clampedCenterDistance = Math.min(centerDistance, farDistance);
  const center: Vector3Tuple = [
    slice.cameraPosition[0] + slice.cameraForward[0] * clampedCenterDistance,
    slice.cameraPosition[1] + slice.cameraForward[1] * clampedCenterDistance,
    slice.cameraPosition[2] + slice.cameraForward[2] * clampedCenterDistance,
  ];
  const radius = Math.sqrt(
    Math.max(
      farDistance * farDistance * (1 + tangentX * tangentX + tangentY * tangentY) -
        2 * clampedCenterDistance * farDistance +
        clampedCenterDistance * clampedCenterDistance,
      0,
    ),
  );
  return { center, radius };
}

export function fitCascadeBox(slice: FrustumSlice, lightDirection: Vector3Tuple, shadowMapSize: number): CascadeBox {
  const sphere = frustumSliceSphere(slice);
  const halfExtent = Math.ceil(sphere.radius);
  const texelWorldSize = (2 * halfExtent) / shadowMapSize;
  const { right, up } = lightPlaneAxes(lightDirection);
  const rightCoordinate = Math.floor(dot(sphere.center, right) / texelWorldSize) * texelWorldSize;
  const upCoordinate = Math.floor(dot(sphere.center, up) / texelWorldSize) * texelWorldSize;
  const alongLight = dot(sphere.center, lightDirection);
  const center: Vector3Tuple = [
    right[0] * rightCoordinate + up[0] * upCoordinate + lightDirection[0] * alongLight,
    right[1] * rightCoordinate + up[1] * upCoordinate + lightDirection[1] * alongLight,
    right[2] * rightCoordinate + up[2] * upCoordinate + lightDirection[2] * alongLight,
  ];
  return { center, halfExtent, texelWorldSize };
}
