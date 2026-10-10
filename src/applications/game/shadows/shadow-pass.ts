// Renders the cascaded sun/moon shadow maps. The opaque chunk surfaces are mirrored into their own small scene (sharing
// the chunk geometry, wearing a depth-only material) so a shadow draw never walks the whole game scene, and drawn from
// an orthographic camera looking along the light. A cascade is redrawn only when its snapped box moved, the light turned
// noticeably, or the set of chunk meshes changed, far cascades less often than near ones, and at most a few cascades
// per frame, so a standing player under a slowly moving sun pays for almost nothing.

import * as THREE from "three";
import { profiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";
import { measureGpuPass } from "../profiler/gpu-pass-registry";
import { DEPTH_BYTES_PER_PIXEL, RED_BYTE_BYTES_PER_PIXEL, estimateTargetBytes } from "../post/render-target-memory";
import type { ShadowQuality } from "../settings/game-settings";
import { skyLightingUniforms } from "../sky/sky-lighting";
import { cascadeEndDistances, fitCascadeBox, lightPlaneAxes, type CascadeBox, type Vector3Tuple } from "./shadow-cascades";
import { FADE_FRACTION, MAX_CASCADES, shadowUniforms } from "./shadow-glsl";
import { decideCascadeRedraw, isRedrawDecision, type CascadeDrawRecord, type CascadeRedrawDecision } from "./shadow-redraw-decision";
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

/** Per cascade: the GPU pass label, which doubles as the key of its breakdown row. Built once, never per frame. */
const CASCADE_PASS_LABELS = Array.from({ length: MAX_CASCADES }, (_, cascade) => `shadowCascade${cascade}`);
const REDRAW_DECISION_COUNTERS: Record<CascadeRedrawDecision, string> = {
  firstDraw: "game.shadow.cascade.decision.firstDraw",
  boxMoved: "game.shadow.cascade.decision.boxMoved",
  lightTurned: "game.shadow.cascade.decision.lightTurned",
  casterSetChanged: "game.shadow.cascade.decision.casterSetChanged",
  throttledMoving: "game.shadow.cascade.decision.throttledMoving",
  throttledCasterChange: "game.shadow.cascade.decision.throttledCasterChange",
  upToDate: "game.shadow.cascade.decision.upToDate",
};
const SHADOW_MAP_BYTES_GAUGE_BY_QUALITY: Record<Exclude<ShadowQuality, "off">, string> = {
  low: "memory.shadowMaps.lowBytes",
  high: "memory.shadowMaps.highBytes",
};
/** One colour byte plus a 32 bit depth texel per shadow map pixel. */
const SHADOW_MAP_BYTES_PER_PIXEL = RED_BYTE_BYTES_PER_PIXEL + DEPTH_BYTES_PER_PIXEL;
const PLACEHOLDER_TARGET_SIZE = 4;

function countGeometryTriangles(geometry: THREE.BufferGeometry): number {
  const indexCount = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  return Math.floor(Math.min(indexCount, geometry.drawRange.count) / 3);
}

export class ShadowPass {
  private readonly lightCamera = new THREE.OrthographicCamera();
  private readonly casterScene = new THREE.Scene();
  private readonly casterMeshes = new Map<string, THREE.Mesh>();
  private readonly casterTriangleCounts = new Map<string, number>();
  private casterTriangleTotal = 0;
  private readonly depthMaterial: THREE.ShaderMaterial;
  private readonly unusedTarget: THREE.WebGLRenderTarget;
  private targets: THREE.WebGLRenderTarget[] = [];
  private draws: (CascadeDrawRecord | null)[] = [];
  private casterRevision = 0;
  private quality: ShadowQuality = "off";
  private readonly textureUniform: { value: THREE.Texture | null } = { value: null };
  private readonly edgeExpansionUniform = { value: 0 };

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const initToken = profiler.begin("main.shadow.init");
    try {
      this.casterScene.matrixAutoUpdate = false;
      this.depthMaterial = new THREE.ShaderMaterial({
        name: "shadow-depth",
        uniforms: { Texture: this.textureUniform, edgeExpansionBlocks: this.edgeExpansionUniform },
        vertexShader: SHADOW_DEPTH_VERTEX_SHADER,
        fragmentShader: SHADOW_DEPTH_FRAGMENT_SHADER,
        colorWrite: false,
      });
      this.unusedTarget = this.createTarget(PLACEHOLDER_TARGET_SIZE);
      this.clearDepthOf(this.unusedTarget);
      this.useUnusedMaps();
    } finally {
      profiler.end(initToken);
    }
  }

  /** Mirrors a chunk's opaque mesh into the shadow scene; the geometry stays owned by the chunk. */
  addChunkCaster(chunkName: string, geometry: THREE.BufferGeometry, chunkMesh: THREE.Mesh): void {
    const scopeToken = profiler.begin("main.shadow.addChunkCaster");
    try {
      if (this.casterMeshes.has(chunkName)) {
        profiler.addCounter("game.shadow.casters.replaced");
        this.removeChunkCaster(chunkName);
      }
      const casterMesh = new THREE.Mesh(geometry, this.depthMaterial);
      casterMesh.matrixAutoUpdate = false;
      casterMesh.matrixWorldAutoUpdate = false;
      casterMesh.matrix.copy(chunkMesh.matrix);
      casterMesh.matrixWorld.copy(chunkMesh.matrixWorld);
      this.casterScene.add(casterMesh);
      this.casterMeshes.set(chunkName, casterMesh);
      const triangleCount = countGeometryTriangles(geometry);
      this.casterTriangleCounts.set(chunkName, triangleCount);
      this.casterTriangleTotal += triangleCount;
      this.casterRevision++;
      profiler.addCounter("game.shadow.casters.added");
      profiler.addCounter("game.shadow.casters.addedTriangles", triangleCount);
    } finally {
      profiler.end(scopeToken);
    }
  }

  removeChunkCaster(chunkName: string): void {
    const scopeToken = profiler.begin("main.shadow.removeChunkCaster");
    try {
      const casterMesh = this.casterMeshes.get(chunkName);
      if (!casterMesh) {
        profiler.addCounter("game.shadow.casters.removeMissed");
        return;
      }
      casterMesh.removeFromParent();
      this.casterMeshes.delete(chunkName);
      this.casterTriangleTotal -= this.casterTriangleCounts.get(chunkName) ?? 0;
      this.casterTriangleCounts.delete(chunkName);
      this.casterRevision++;
      profiler.addCounter("game.shadow.casters.removed");
    } finally {
      profiler.end(scopeToken);
    }
  }

  setBlockTextures(textureArray: THREE.Texture): void {
    this.textureUniform.value = textureArray;
    profiler.addCounter("game.shadow.blockTexturesSet");
  }

  setQuality(quality: ShadowQuality): void {
    if (quality === this.quality) return;
    const scopeToken = profiler.begin("main.shadow.setQuality");
    try {
      this.quality = quality;
      profiler.addCounter("game.shadow.qualityChanges");
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
      profiler.addCounter("game.shadow.targetsCreated", preset.cascadeCount);
      profiler.recordBytes("bytes.shadow.mapsAllocated", this.shadowMapBytes());
    } finally {
      profiler.end(scopeToken);
    }
  }

  /**
   * Redraws whatever cascades are stale for the camera's current view and the sky's current light. The maps follow
   * `focusPosition` (the eyes without their walking sway) so the shadow edges do not shimmer with every step.
   */
  update(camera: THREE.PerspectiveCamera, focusPosition: THREE.Vector3 = camera.position): void {
    const preset = this.quality === "off" ? null : SHADOW_PRESETS[this.quality];
    const direct = skyLightingUniforms.skyDirectColor.value;
    const directLuminance = 0.2126 * direct.x + 0.7152 * direct.y + 0.0722 * direct.z;
    if (profiler.enabled) this.sampleGauges(directLuminance);
    if (!preset || !this.textureUniform.value || directLuminance < MIN_VISIBLE_LIGHT_LUMINANCE) {
      shadowUniforms.shadowCascadeCount.value = 0;
      if (profiler.enabled) this.countSkippedUpdate(preset !== null, directLuminance);
      return;
    }
    profiler.addCounter("game.shadow.update.ran");

    const light = skyLightingUniforms.skyLightDirection.value;
    const lightTuple: Vector3Tuple = [light.x, light.y, light.z];
    const ends = cascadeEndDistances(preset.firstEnd, preset.lastEnd, preset.cascadeCount);
    const staleCascades: { cascade: number; box: CascadeBox; lastDrawnAtMs: number }[] = [];
    const nowMs = performance.now();

    const fitToken = profiler.begin("main.shadow.fitAndDecide");
    try {
      const forward = camera.getWorldDirection(new THREE.Vector3());
      const tangentY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const tangentX = tangentY * camera.aspect;
      const cornerStretch = Math.sqrt(1 + tangentX * tangentX + tangentY * tangentY);
      for (let cascade = 0; cascade < preset.cascadeCount; cascade++) {
        const sliceNear = cascade === 0 ? camera.near : ends[cascade - 1]! / cornerStretch;
        const box = fitCascadeBox(
          {
            cameraPosition: [focusPosition.x, focusPosition.y, focusPosition.z],
            cameraForward: [forward.x, forward.y, forward.z],
            verticalFieldOfViewRadians: THREE.MathUtils.degToRad(camera.fov),
            aspect: camera.aspect,
            nearDistance: sliceNear,
            farDistance: ends[cascade]!,
          },
          lightTuple,
          preset.mapSize,
        );
        const decision = this.decideRedraw(cascade, box, light, nowMs);
        profiler.addCounter("game.shadow.cascade.fitted");
        profiler.addCounter(REDRAW_DECISION_COUNTERS[decision]);
        if (isRedrawDecision(decision)) {
          staleCascades.push({ cascade, box, lastDrawnAtMs: this.draws[cascade]?.drawnAtMs ?? -1 });
        }
      }
      staleCascades.sort((first, second) => first.lastDrawnAtMs - second.lastDrawnAtMs);
    } finally {
      profiler.end(fitToken);
    }

    const cascadesToDraw = staleCascades.slice(0, MAX_CASCADE_DRAWS_PER_FRAME);
    for (const { cascade, box } of cascadesToDraw) {
      this.drawCascade(cascade, box.center, box.halfExtent, box.texelWorldSize, lightTuple, light, nowMs);
    }
    if (profiler.enabled) {
      profiler.addCounter("game.shadow.cascade.drawn", cascadesToDraw.length);
      profiler.addCounter("game.shadow.cascade.skipped", preset.cascadeCount - cascadesToDraw.length);
      profiler.addCounter("game.shadow.cascade.skippedMaxDrawsPerFrame", staleCascades.length - cascadesToDraw.length);
      profiler.addCounter(
        cascadesToDraw.length > 0 ? "game.shadow.frames.withDraws" : "game.shadow.frames.withoutDraws",
      );
    }

    const publishToken = profiler.begin("main.shadow.publishUniforms");
    try {
      const lastEnd = ends[ends.length - 1]!;
      const allEnds = [...ends];
      while (allEnds.length < MAX_CASCADES) allEnds.push(lastEnd);
      shadowUniforms.shadowCascadeEnds.value.set(allEnds[0]!, allEnds[1]!, allEnds[2]!);
      shadowUniforms.shadowFadeStart.value = lastEnd * (1 - FADE_FRACTION);
      shadowUniforms.shadowCascadeCount.value = this.draws.every((draw) => draw !== null) ? preset.cascadeCount : 0;
    } finally {
      profiler.end(publishToken);
    }
  }

  dispose(): void {
    const scopeToken = profiler.begin("main.shadow.dispose");
    try {
      this.releaseTargets();
      this.unusedTarget.dispose();
      this.depthMaterial.dispose();
    } finally {
      profiler.end(scopeToken);
    }
  }

  private decideRedraw(cascade: number, box: CascadeBox, light: THREE.Vector3, nowMs: number): CascadeRedrawDecision {
    return decideCascadeRedraw({
      previous: this.draws[cascade] ?? null,
      box,
      light,
      casterRevision: this.casterRevision,
      nowMs,
      minMovingRedrawIntervalMs: MIN_MOVING_REDRAW_INTERVAL_MS[cascade] ?? 0,
      casterChangeRedrawIntervalMs: CASTER_CHANGE_REDRAW_INTERVAL_MS,
      lightTurnRedrawCosine: LIGHT_TURN_REDRAW_COSINE,
    });
  }

  private countSkippedUpdate(hasQuality: boolean, directLuminance: number): void {
    if (!hasQuality) profiler.addCounter("game.shadow.update.skippedQualityOff");
    else if (!this.textureUniform.value) profiler.addCounter("game.shadow.update.skippedNoBlockTextures");
    else if (directLuminance < MIN_VISIBLE_LIGHT_LUMINANCE) profiler.addCounter("game.shadow.update.skippedLightTooDim");
  }

  private sampleGauges(directLuminance: number): void {
    profiler.sampleGauge("game.shadow.casterMeshes", this.casterMeshes.size);
    profiler.sampleGauge("game.shadow.casterTriangles", this.casterTriangleTotal, "triangles");
    profiler.sampleGauge("game.shadow.directLightLuminance", directLuminance);
    const mapBytes = this.shadowMapBytes();
    profiler.sampleGauge("memory.shadowMaps.totalBytes", mapBytes, "bytes");
    if (this.quality !== "off") profiler.sampleGauge(SHADOW_MAP_BYTES_GAUGE_BY_QUALITY[this.quality], mapBytes, "bytes");
  }

  /** Bytes held by the cascade maps of the current quality plus the placeholder map used while shadows are off. */
  private shadowMapBytes(): number {
    const placeholderBytes = estimateTargetBytes(PLACEHOLDER_TARGET_SIZE, PLACEHOLDER_TARGET_SIZE, SHADOW_MAP_BYTES_PER_PIXEL);
    if (this.quality === "off") return placeholderBytes;
    const preset = SHADOW_PRESETS[this.quality];
    return placeholderBytes + preset.cascadeCount * estimateTargetBytes(preset.mapSize, preset.mapSize, SHADOW_MAP_BYTES_PER_PIXEL);
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
    const passLabel = CASCADE_PASS_LABELS[cascade]!;
    const scopeToken = profiler.begin("main.shadow.drawCascade", DIMENSIONS.shadowCascade, passLabel);
    try {
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
      if (profiler.enabled) {
        measureGpuPass(passLabel, () => this.renderCasters(target, camera));
        profiler.addCounter("game.shadow.cascade.casterMeshesDrawn", this.casterMeshes.size);
      } else {
        this.renderCasters(target, camera);
      }

      const matrix = shadowUniforms.shadowMatrices.value[cascade]!;
      matrix.makeTranslation(0.5, 0.5, 0.5).multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5));
      matrix.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
      shadowUniforms.shadowTexelWorldSizes.value.setComponent(cascade, texelWorldSize);
      (cascade === 0 ? shadowUniforms.shadowMap0 : cascade === 1 ? shadowUniforms.shadowMap1 : shadowUniforms.shadowMap2).value =
        target.depthTexture;
      this.draws[cascade] = { center, halfExtent, light: light.clone(), casterRevision: this.casterRevision, drawnAtMs: nowMs };
    } finally {
      profiler.end(scopeToken);
    }
  }

  private renderCasters(target: THREE.WebGLRenderTarget, camera: THREE.OrthographicCamera): void {
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.clear(false, true, false);
    this.renderer.render(this.casterScene, camera);
    this.renderer.setRenderTarget(previousTarget);
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
    profiler.addCounter("game.shadow.targetsReleased", this.targets.length);
    for (const target of this.targets) {
      target.depthTexture?.dispose();
      target.dispose();
    }
    this.targets = [];
  }
}
