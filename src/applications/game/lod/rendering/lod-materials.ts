// The two LOD materials (opaque terrain, translucent water) share one set of scene uniforms (fog, dissolve band,
// coverage texture); only the per-tile cross-fade value is set per draw, from the tile mesh's onBeforeRender.

import * as THREE from "three";
import { LOD_FRAGMENT_SHADER, LOD_VERTEX_SHADER } from "./lod-shaders";

/** Same translucency the main shader gives water. */
const WATER_ALPHA = 0.7;
export const COVERAGE_TEXTURE_SIZE = 64;

export interface LodSceneUniforms {
  coverageTexture: { value: THREE.DataTexture };
  coverageCenterChunk: { value: THREE.Vector2 };
  coverageSize: { value: number };
  /** Output-space (sRGB) colour the far terrain fades towards. */
  hazeColor: { value: THREE.Vector3 };
  hazeStart: { value: number };
  hazeEnd: { value: number };
  dissolveStart: { value: number };
  dissolveEnd: { value: number };
}

export interface LodMaterials {
  readonly terrain: THREE.ShaderMaterial;
  readonly water: THREE.ShaderMaterial;
  readonly sceneUniforms: LodSceneUniforms;
  readonly coverageTexels: Uint8Array;
  dispose(): void;
}

export function srgbHexToVector(hex: number): THREE.Vector3 {
  return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

export function createLodMaterials(fogColorHex: number): LodMaterials {
  const coverageTexels = new Uint8Array(COVERAGE_TEXTURE_SIZE * COVERAGE_TEXTURE_SIZE);
  const coverageTexture = new THREE.DataTexture(coverageTexels, COVERAGE_TEXTURE_SIZE, COVERAGE_TEXTURE_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  coverageTexture.magFilter = THREE.NearestFilter;
  coverageTexture.minFilter = THREE.NearestFilter;
  coverageTexture.wrapS = THREE.RepeatWrapping;
  coverageTexture.wrapT = THREE.RepeatWrapping;
  coverageTexture.generateMipmaps = false;
  coverageTexture.needsUpdate = true;

  const sceneUniforms: LodSceneUniforms = {
    coverageTexture: { value: coverageTexture },
    coverageCenterChunk: { value: new THREE.Vector2() },
    coverageSize: { value: COVERAGE_TEXTURE_SIZE },
    hazeColor: { value: srgbHexToVector(fogColorHex) },
    hazeStart: { value: 1e9 },
    hazeEnd: { value: 2e9 },
    dissolveStart: { value: 1e9 },
    dissolveEnd: { value: 2e9 },
  };
  const createMaterial = (isWater: boolean) =>
    new THREE.ShaderMaterial({
      name: isWater ? "lod-water" : "lod-terrain",
      uniforms: { ...sceneUniforms, tileFade: { value: 1 }, surfaceAlpha: { value: isWater ? WATER_ALPHA : 1 } },
      vertexShader: LOD_VERTEX_SHADER,
      fragmentShader: LOD_FRAGMENT_SHADER,
      transparent: isWater,
      depthWrite: !isWater,
      blending: THREE.NormalBlending,
      blendSrcAlpha: THREE.OneFactor,
    });
  const terrain = createMaterial(false);
  const water = createMaterial(true);
  return {
    terrain,
    water,
    sceneUniforms,
    coverageTexels,
    dispose() {
      terrain.dispose();
      water.dispose();
      coverageTexture.dispose();
    },
  };
}
