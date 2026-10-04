// GPU side of one tile: the worker's vertex buffer wrapped in a BufferGeometry that shares one quad index buffer with
// every other tile (terrain group, then water group), placed at the tile origin and scaled by the cell size, with a
// bounding sphere that encloses the skirts so frustum culling never drops a visible tile. Each mesh carries its
// cross-fade value into the shared materials.

import * as THREE from "three";
import { BLOCK_RENDER_OFFSET, cellSizeOfLevel, TILE_CELLS, tileSizeOfLevel } from "../core/lod-constants";
import type { TileAddress } from "../core/tile-address";
import { MAXIMUM_TILE_QUADS, VERTICES_PER_QUAD } from "../meshing/heightfield-mesher";
import type { LodMaterials } from "./lod-materials";

export const PACKED_VERTEX_ATTRIBUTE = "packedVertex";
const INDICES_PER_QUAD = 6;

export interface TileGeometryBuffers {
  vertices: Uint32Array;
  terrainQuadCount: number;
  waterQuadCount: number;
  minY: number;
  maxY: number;
}

export interface LodTileMesh {
  readonly mesh: THREE.Mesh;
  readonly geometryBytes: number;
  /** Entering: 0..1, the fraction of pixels drawn (1 = fully shown). Leaving: -1 - progress, so -1 is still fully shown and -2 gone. */
  fade: number;
  dispose(): void;
}

let sharedQuadIndex: THREE.BufferAttribute | null = null;

/** Two triangles per quad (0 1 2, 0 2 3), enough for the largest possible tile; uploaded once for all tiles. */
function quadIndex(): THREE.BufferAttribute {
  if (sharedQuadIndex === null) {
    const indices = new Uint16Array(MAXIMUM_TILE_QUADS * INDICES_PER_QUAD);
    for (let quad = 0; quad < MAXIMUM_TILE_QUADS; quad++) {
      const firstVertex = quad * VERTICES_PER_QUAD;
      indices.set([firstVertex, firstVertex + 1, firstVertex + 2, firstVertex, firstVertex + 2, firstVertex + 3], quad * INDICES_PER_QUAD);
    }
    sharedQuadIndex = new THREE.BufferAttribute(indices, 1);
  }
  return sharedQuadIndex;
}

export function boundingSphereOfTile(address: TileAddress, minY: number, maxY: number): THREE.Sphere {
  const cellSize = cellSizeOfLevel(address.level);
  const halfCells = TILE_CELLS / 2;
  const halfHeightInBlocks = (maxY - minY) / 2;
  const localRadius = Math.sqrt(2 * halfCells * halfCells + (halfHeightInBlocks / cellSize) ** 2);
  return new THREE.Sphere(new THREE.Vector3(halfCells, (minY + maxY) / 2, halfCells), localRadius);
}

export function createLodTileMesh(address: TileAddress, buffers: TileGeometryBuffers, materials: LodMaterials): LodTileMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(PACKED_VERTEX_ATTRIBUTE, new THREE.BufferAttribute(buffers.vertices, 2));
  geometry.setIndex(quadIndex());
  geometry.addGroup(0, buffers.terrainQuadCount * INDICES_PER_QUAD, 0);
  if (buffers.waterQuadCount > 0) {
    geometry.addGroup(buffers.terrainQuadCount * INDICES_PER_QUAD, buffers.waterQuadCount * INDICES_PER_QUAD, 1);
  }
  geometry.boundingSphere = boundingSphereOfTile(address, buffers.minY, buffers.maxY);

  const mesh = new THREE.Mesh(geometry, [materials.terrain, materials.water]);
  const cellSize = cellSizeOfLevel(address.level);
  const tileSize = tileSizeOfLevel(address.level);
  mesh.position.set(address.tileX * tileSize - BLOCK_RENDER_OFFSET, -BLOCK_RENDER_OFFSET, address.tileZ * tileSize - BLOCK_RENDER_OFFSET);
  mesh.scale.set(cellSize, 1, cellSize);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.name = `lod ${address.level}/${address.tileX}/${address.tileZ}`;

  const tileMesh: LodTileMesh = {
    mesh,
    geometryBytes: buffers.vertices.byteLength,
    fade: 1,
    dispose() {
      // Disposing a geometry also deletes its index buffer on the GPU, which every other tile still uses.
      geometry.setIndex(null);
      geometry.dispose();
    },
  };
  mesh.onBeforeRender = (_renderer, _scene, _camera, _geometry, material) => {
    const shaderMaterial = material as THREE.ShaderMaterial;
    shaderMaterial.uniforms.tileFade!.value = tileMesh.fade;
    shaderMaterial.uniformsNeedUpdate = true;
  };
  return tileMesh;
}
