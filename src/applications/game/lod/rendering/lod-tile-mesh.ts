// GPU side of one tile: the worker's vertex and index buffers wrapped in a BufferGeometry (terrain group, then water
// group), placed at the tile origin and scaled by the cell size, with a bounding sphere that encloses the skirts so
// frustum culling never drops a visible tile. Each mesh carries its cross-fade value into the shared materials.

import * as THREE from "three";
import { BLOCK_RENDER_OFFSET, cellSizeOfLevel, TILE_CELLS, tileSizeOfLevel } from "../core/lod-constants";
import type { TileAddress } from "../core/tile-address";
import type { LodMaterials } from "./lod-materials";

export const PACKED_VERTEX_ATTRIBUTE = "packedVertex";

export interface TileGeometryBuffers {
  vertices: Uint32Array;
  indices: Uint16Array;
  terrainIndexCount: number;
  waterIndexCount: number;
  minY: number;
  maxY: number;
}

export interface LodTileMesh {
  readonly mesh: THREE.Mesh;
  readonly geometryBytes: number;
  /** 1 = fully shown; 0..1 = fading in; -1..0 = fading out (see the fragment shader). */
  fade: number;
  dispose(): void;
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
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  geometry.addGroup(0, buffers.terrainIndexCount, 0);
  if (buffers.waterIndexCount > 0) geometry.addGroup(buffers.terrainIndexCount, buffers.waterIndexCount, 1);
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
    geometryBytes: buffers.vertices.byteLength + buffers.indices.byteLength,
    fade: 1,
    dispose() {
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
