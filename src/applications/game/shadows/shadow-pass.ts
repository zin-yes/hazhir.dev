// Renders the cascaded sun/moon shadow maps. The opaque chunk surfaces are mirrored into their own small scene (sharing
// the chunk geometry, wearing a depth-only material) so a shadow draw never walks the whole game scene, and drawn from
// an orthographic camera looking along the light. A cascade is redrawn only when its snapped box moved, the light turned
// noticeably, or the set of chunk meshes changed, far cascades less often than near ones, and at most a few cascades
// per frame, so a standing player under a slowly moving sun pays for almost nothing.

import * as THREE from "three";
import type { ShadowQuality } from "../settings/game-settings";
import { skyLightingUniforms } from "../sky/sky-lighting";
import { cascadeEndDistances, fitCascadeBox, lightPlaneAxes, type CascadeBox, type Vector3Tuple } from "./shadow-cascades";
import { FADE_FRACTION, MAX_CASCADES, shadowUniforms } from "./shadow-glsl";
import { SHADOW_DEPTH_FRAGMENT_SHADER, SHADOW_DEPTH_VERTEX_SHADER } from "./shadow-shaders";

interface ShadowPreset {
  cascadeCount: number;
  mapSize: number;
  firstEnd: number;
  lastEnd: number;
}

export const SHADOW_PRESETS: Record<Exclude<ShadowQuality, "off">, ShadowPreset> = {
  low: { cascadeCount: 2, mapSize: 1024, firstEnd: 24, lastEnd: 64 },
  high: { cascadeCount: 3, mapSize: 2048, firstEnd: 18, lastEnd: 110 },
};

/** How far above the cascade centre the light camera sits: taller than the tallest build, so every caster is in front of it. */
const CASTER_HEIGHT_ALLOWANCE_BLOCKS = 420;
/** The light has to turn this much (cosine of the angle) before the maps are redrawn. */
const LIGHT_TURN_REDRAW_COSINE = Math.cos((0.25 * Math.PI) / 180);
const MAX_CASCADE_DRAWS_PER_FRAME = 2;
/** While chunks stream in or out the casters change every frame; the maps catch up at most this often. */
const CASTER_CHANGE_REDRAW_INTERVAL_MS = 250;
/** While the camera moves, a cascade is redrawn at most this often (far cascades change least and cost most). */
const MIN_MOVING_REDRAW_INTERVAL_MS = [0, 80, 200];
/** Below this direct light strength (around sunset and sunrise, under thick overcast) shadows are invisible. */
const MIN_VISIBLE_LIGHT_LUMINANCE = 0.01;
const EDGE_EXPANSION_TEXELS = 0.35;

interface CascadeDraw {
  center: Vector3Tuple;
  halfExtent: number;
  light: THREE.Vector3;
  casterRevision: number;
  drawnAtMs: number;
}

export class ShadowPass {
  private readonly lightCamera = new THREE.OrthographicCamera();
  private readonly casterScene = new THREE.Scene();
  private readonly casterMeshes = new Map<string, THREE.Mesh>();
  private readonly depthMaterial: THREE.ShaderMaterial;
  private readonly unusedTarget: THREE.WebGLRenderTarget;
  private targets: THREE.WebGLRenderTarget[] = [];
  private draws: (CascadeDraw | null)[] = [];
  private casterRevision = 0;
  private quality: ShadowQuality = "off";
  private readonly textureUniform: { value: THREE.Texture | null } = { value: null };
  private readonly edgeExpansionUniform = { value: 0 };

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.casterScene.matrixAutoUpdate = false;
    this.depthMaterial = new THREE.ShaderMaterial({
      name: "shadow-depth",
      uniforms: { Texture: this.textureUniform, edgeExpansionBlocks: this.edgeExpansionUniform },
      vertexShader: SHADOW_DEPTH_VERTEX_SHADER,
      fragmentShader: SHADOW_DEPTH_FRAGMENT_SHADER,
      colorWrite: false,
    });
    this.unusedTarget = this.createTarget(4);
    this.clearDepthOf(this.unusedTarget);
    this.useUnusedMaps();
  }

  /** Mirrors a chunk's opaque mesh into the shadow scene; the geometry stays owned by the chunk. */
  addChunkCaster(chunkName: string, geometry: THREE.BufferGeometry, chunkMesh: THREE.Mesh): void {
    this.removeChunkCaster(chunkName);
    const casterMesh = new THREE.Mesh(geometry, this.depthMaterial);
    casterMesh.matrixAutoUpdate = false;
    casterMesh.matrixWorldAutoUpdate = false;
    casterMesh.matrix.copy(chunkMesh.matrix);
    casterMesh.matrixWorld.copy(chunkMesh.matrixWorld);
    this.casterScene.add(casterMesh);
    this.casterMeshes.set(chunkName, casterMesh);
    this.casterRevision++;
  }

  removeChunkCaster(chunkName: string): void {
    const casterMesh = this.casterMeshes.get(chunkName);
    if (!casterMesh) return;
    casterMesh.removeFromParent();
    this.casterMeshes.delete(chunkName);
    this.casterRevision++;
  }

  setBlockTextures(textureArray: THREE.Texture): void {
    this.textureUniform.value = textureArray;
  }

  setQuality(quality: ShadowQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.releaseTargets();
    this.draws = [];
    if (quality === "off") {
      shadowUniforms.shadowCascadeCount.value = 0;
      this.useUnusedMaps();
      return;
    }
    const preset = SHADOW_PRESETS[quality];
    this.targets = Array.from({ length: preset.cascadeCount }, () => this.createTarget(preset.mapSize));
    this.draws = this.targets.map(() => null);
    shadowUniforms.shadowMapTexelSize.value = 1 / preset.mapSize;
    this.useUnusedMaps();
  }

  /** Redraws whatever cascades are stale for the camera's current view and the sky's current light. */
  update(camera: THREE.PerspectiveCamera): void {
    const preset = this.quality === "off" ? null : SHADOW_PRESETS[this.quality];
    const direct = skyLightingUniforms.skyDirectColor.value;
    const directLuminance = 0.2126 * direct.x + 0.7152 * direct.y + 0.0722 * direct.z;
    if (!preset || !this.textureUniform.value || directLuminance < MIN_VISIBLE_LIGHT_LUMINANCE) {
      shadowUniforms.shadowCascadeCount.value = 0;
      return;
    }

    const light = skyLightingUniforms.skyLightDirection.value;
    const lightTuple: Vector3Tuple = [light.x, light.y, light.z];
    const ends = cascadeEndDistances(preset.firstEnd, preset.lastEnd, preset.cascadeCount);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const tangentY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tangentX = tangentY * camera.aspect;
    const cornerStretch = Math.sqrt(1 + tangentX * tangentX + tangentY * tangentY);

    const nowMs = performance.now();
    const staleCascades: { cascade: number; box: CascadeBox; lastDrawnAtMs: number }[] = [];
    for (let cascade = 0; cascade < preset.cascadeCount; cascade++) {
      const sliceNear = cascade === 0 ? camera.near : ends[cascade - 1]! / cornerStretch;
      const box = fitCascadeBox(
        {
          cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
          cameraForward: [forward.x, forward.y, forward.z],
          verticalFieldOfViewRadians: THREE.MathUtils.degToRad(camera.fov),
          aspect: camera.aspect,
          nearDistance: sliceNear,
          farDistance: ends[cascade]!,
        },
        lightTuple,
        preset.mapSize,
      );
      if (this.needsDraw(cascade, box, light, nowMs)) {
        staleCascades.push({ cascade, box, lastDrawnAtMs: this.draws[cascade]?.drawnAtMs ?? -1 });
      }
    }
    staleCascades.sort((first, second) => first.lastDrawnAtMs - second.lastDrawnAtMs);
    for (const { cascade, box } of staleCascades.slice(0, MAX_CASCADE_DRAWS_PER_FRAME)) {
      this.drawCascade(cascade, box.center, box.halfExtent, box.texelWorldSize, lightTuple, light, nowMs);
    }

    const lastEnd = ends[ends.length - 1]!;
    const allEnds = [...ends];
    while (allEnds.length < MAX_CASCADES) allEnds.push(lastEnd);
    shadowUniforms.shadowCascadeEnds.value.set(allEnds[0]!, allEnds[1]!, allEnds[2]!);
    shadowUniforms.shadowFadeStart.value = lastEnd * (1 - FADE_FRACTION);
    shadowUniforms.shadowCascadeCount.value = this.draws.every((draw) => draw !== null) ? preset.cascadeCount : 0;
  }

  dispose(): void {
    this.releaseTargets();
    this.unusedTarget.dispose();
    this.depthMaterial.dispose();
  }

  private needsDraw(cascade: number, box: CascadeBox, light: THREE.Vector3, nowMs: number): boolean {
    const previous = this.draws[cascade];
    if (!previous) return true;
    const viewChanged =
      previous.halfExtent !== box.halfExtent ||
      previous.center[0] !== box.center[0] ||
      previous.center[1] !== box.center[1] ||
      previous.center[2] !== box.center[2] ||
      previous.light.dot(light) < LIGHT_TURN_REDRAW_COSINE;
    if (viewChanged) return nowMs - previous.drawnAtMs >= (MIN_MOVING_REDRAW_INTERVAL_MS[cascade] ?? 0);
    return previous.casterRevision !== this.casterRevision && nowMs - previous.drawnAtMs >= CASTER_CHANGE_REDRAW_INTERVAL_MS;
  }

  private drawCascade(
    cascade: number,
    center: Vector3Tuple,
    halfExtent: number,
    texelWorldSize: number,
    lightTuple: Vector3Tuple,
    light: THREE.Vector3,
    nowMs: number,
  ): void {
    const { up } = lightPlaneAxes(lightTuple);
    const distanceBehind = halfExtent + CASTER_HEIGHT_ALLOWANCE_BLOCKS;
    const camera = this.lightCamera;
    camera.position.set(
      center[0] + light.x * distanceBehind,
      center[1] + light.y * distanceBehind,
      center[2] + light.z * distanceBehind,
    );
    camera.up.set(up[0], up[1], up[2]);
    camera.lookAt(center[0], center[1], center[2]);
    camera.left = -halfExtent;
    camera.right = halfExtent;
    camera.top = halfExtent;
    camera.bottom = -halfExtent;
    camera.near = 0;
    camera.far = distanceBehind + halfExtent;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    this.edgeExpansionUniform.value = texelWorldSize * EDGE_EXPANSION_TEXELS;
    const target = this.targets[cascade]!;
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.clear(false, true, false);
    this.renderer.render(this.casterScene, camera);
    this.renderer.setRenderTarget(previousTarget);

    const matrix = shadowUniforms.shadowMatrices.value[cascade]!;
    matrix.makeTranslation(0.5, 0.5, 0.5).multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5));
    matrix.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    shadowUniforms.shadowTexelWorldSizes.value.setComponent(cascade, texelWorldSize);
    (cascade === 0 ? shadowUniforms.shadowMap0 : cascade === 1 ? shadowUniforms.shadowMap1 : shadowUniforms.shadowMap2).value =
      target.depthTexture;
    this.draws[cascade] = { center, halfExtent, light: light.clone(), casterRevision: this.casterRevision, drawnAtMs: nowMs };
  }

  private createTarget(size: number): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    depthTexture.compareFunction = THREE.LessEqualCompare;
    depthTexture.minFilter = THREE.LinearFilter;
    depthTexture.magFilter = THREE.LinearFilter;
    return new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: true,
      depthTexture,
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      generateMipmaps: false,
    });
  }

  private clearDepthOf(target: THREE.WebGLRenderTarget): void {
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.clear(false, true, false);
    this.renderer.setRenderTarget(previousTarget);
  }

  private useUnusedMaps(): void {
    const unusedDepth = this.unusedTarget.depthTexture;
    shadowUniforms.shadowMap0.value = unusedDepth;
    shadowUniforms.shadowMap1.value = unusedDepth;
    shadowUniforms.shadowMap2.value = unusedDepth;
  }

  private releaseTargets(): void {
    for (const target of this.targets) {
      target.depthTexture?.dispose();
      target.dispose();
    }
    this.targets = [];
  }
}
