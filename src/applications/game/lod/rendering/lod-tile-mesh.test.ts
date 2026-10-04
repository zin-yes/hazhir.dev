import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { tileSizeOfLevel } from "../core/lod-constants";
import { unpackTileSurface } from "../data/packed-tile-surface";
import { decodeLodVertex, LOD_VERTEX_WORDS, LodFace } from "../meshing/lod-vertex-format";
import { buildLodTile } from "../worker/lod-tile-builder";
import { createLodMaterials } from "./lod-materials";
import { createLodTileMesh } from "./lod-tile-mesh";

const SEED = 99;

function worldVertices(mesh: THREE.Mesh): THREE.Vector3[] {
  const words = mesh.geometry.getAttribute("packedVertex").array as Uint32Array;
  const vertices: THREE.Vector3[] = [];
  for (let vertex = 0; vertex < words.length / LOD_VERTEX_WORDS; vertex++) {
    const decoded = decodeLodVertex(words[vertex * 2]!, words[vertex * 2 + 1]!);
    vertices.push(new THREE.Vector3(decoded.cellX, decoded.blockY, decoded.cellZ).applyMatrix4(mesh.matrixWorld));
  }
  return vertices;
}

describe("LOD tile mesh", () => {
  test("the bounding sphere used for frustum culling encloses every vertex, skirts included", () => {
    const startedAt = performance.now();
    const materials = createLodMaterials(0xffffff);
    for (const address of [{ level: 0, tileX: 4, tileZ: -2 }, { level: 3, tileX: -1, tileZ: 2 }, { level: 7, tileX: 0, tileZ: 0 }]) {
      const tileMesh = createLodTileMesh(address, buildLodTile({ seed: SEED, address }), materials);
      tileMesh.mesh.updateMatrixWorld(true);
      const sphere = tileMesh.mesh.geometry.boundingSphere!.clone().applyMatrix4(tileMesh.mesh.matrixWorld);
      const vertices = worldVertices(tileMesh.mesh);
      expect(vertices.length).toBeGreaterThan(100);
      for (const vertex of vertices) expect(sphere.distanceToPoint(vertex)).toBeLessThanOrEqual(1e-6);
      tileMesh.dispose();
    }
    materials.dispose();
    console.log(`bounding sphere check: ${(performance.now() - startedAt).toFixed(1)} ms`);
  });

  test("a level-0 tile lines up with the real chunk mesh of the same column (blocks span x - 0.5 .. x + 0.5)", () => {
    const materials = createLodMaterials(0xffffff);
    const address = { level: 0, tileX: 2, tileZ: 3 };
    const built = buildLodTile({ seed: SEED, address });
    const surface = unpackTileSurface(built.packedSurface);
    const tileMesh = createLodTileMesh(address, built, materials);
    tileMesh.mesh.updateMatrixWorld(true);
    const words = tileMesh.mesh.geometry.getAttribute("packedVertex").array as Uint32Array;
    const realChunkMeshOrigin = new THREE.Vector3(address.tileX * 32 - 0.5, -0.5, address.tileZ * 32 - 0.5);
    let checkedTops = 0;
    for (let vertex = 0; vertex < words.length / 2; vertex += 4) {
      const decoded = decodeLodVertex(words[vertex * 2]!, words[vertex * 2 + 1]!);
      if (decoded.face !== LodFace.Up) continue;
      const world = new THREE.Vector3(decoded.cellX, decoded.blockY, decoded.cellZ).applyMatrix4(tileMesh.mesh.matrixWorld);
      expect(world.x).toBe(realChunkMeshOrigin.x + decoded.cellX);
      expect(world.z).toBe(realChunkMeshOrigin.z + decoded.cellZ);
      const cellHeight = surface.heights[decoded.cellX + decoded.cellZ * 32]!;
      const cellWater = surface.waterLevels[decoded.cellX + decoded.cellZ * 32]!;
      expect([cellHeight - 0.5, cellWater - 0.5]).toContain(world.y);
      checkedTops++;
    }
    expect(checkedTops).toBeGreaterThan(20);
    expect(tileSizeOfLevel(0)).toBe(32);
    tileMesh.dispose();
    materials.dispose();
  });
});
