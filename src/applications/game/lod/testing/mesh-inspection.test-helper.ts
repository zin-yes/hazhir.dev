// Decodes LOD tile meshes back into axis-aligned quads in world block coordinates, for geometry assertions.

import { cellSizeOfLevel, tileSizeOfLevel } from "../core/lod-constants";
import type { TileAddress } from "../core/tile-address";
import type { TileMesh } from "../meshing/heightfield-mesher";
import { decodeLodVertex, LOD_VERTEX_WORDS, LodFace, LodMaterial } from "../meshing/lod-vertex-format";

export interface WorldQuad {
  face: LodFace;
  material: LodMaterial;
  color: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export function decodeWorldQuads(mesh: TileMesh, address: TileAddress): WorldQuad[] {
  const cellSize = cellSizeOfLevel(address.level);
  const originX = address.tileX * tileSizeOfLevel(address.level);
  const originZ = address.tileZ * tileSizeOfLevel(address.level);
  const quads: WorldQuad[] = [];
  for (let firstIndex = 0; firstIndex < mesh.indices.length; firstIndex += 6) {
    const cornerVertices = [mesh.indices[firstIndex]!, mesh.indices[firstIndex + 1]!, mesh.indices[firstIndex + 2]!, mesh.indices[firstIndex + 5]!];
    const corners = cornerVertices.map((vertex) =>
      decodeLodVertex(mesh.vertices[vertex * LOD_VERTEX_WORDS]!, mesh.vertices[vertex * LOD_VERTEX_WORDS + 1]!),
    );
    const xs = corners.map((corner) => originX + corner.cellX * cellSize);
    const zs = corners.map((corner) => originZ + corner.cellZ * cellSize);
    const ys = corners.map((corner) => corner.blockY);
    quads.push({
      face: corners[0]!.face,
      material: corners[0]!.material,
      color: corners[0]!.color,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    });
  }
  return quads;
}

/** Whether walls with the given face in the plane x = planeX (or z = planeZ) cover the vertical segment at one point. */
export function isVerticalSegmentCovered(
  quads: readonly WorldQuad[],
  face: LodFace,
  plane: number,
  alongCoordinate: number,
  bottomY: number,
  topY: number,
): boolean {
  const facesAlongX = face === LodFace.PositiveX || face === LodFace.NegativeX;
  const intervals = quads
    .filter((quad) => quad.face === face && quad.material === LodMaterial.Terrain)
    .filter((quad) => (facesAlongX ? quad.minX === plane : quad.minZ === plane))
    .filter((quad) =>
      facesAlongX
        ? quad.minZ <= alongCoordinate && alongCoordinate <= quad.maxZ
        : quad.minX <= alongCoordinate && alongCoordinate <= quad.maxX,
    )
    .map((quad) => [quad.minY, quad.maxY] as const)
    .sort((first, second) => first[0] - second[0]);
  let coveredUpTo = bottomY;
  for (const [intervalBottom, intervalTop] of intervals) {
    if (intervalBottom > coveredUpTo) break;
    coveredUpTo = Math.max(coveredUpTo, intervalTop);
  }
  return coveredUpTo >= topY;
}
