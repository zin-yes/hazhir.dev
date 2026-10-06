// World target and bloom: the world is drawn into a half float target instead of the canvas (emissive surfaces overshoot white there),
// the part above white is spread into a soft halo through a chain of shrinking targets, and the halo is added over the
// picture on its way to the canvas. Anything that never goes above white (everything but light sources and the sun's
// glints) leaves the bloom empty, so ordinary surfaces stay crisp.

import * as THREE from "three";
import { profiler } from "../profiler";
import { measureGpuPass } from "../profiler/gpu-pass-registry";
import { EMISSIVE_BLOOM_GAIN } from "../sky/surface-lighting";
import { skyLightingUniforms } from "../sky/sky-lighting";
import { DEPTH_BYTES_PER_PIXEL, HALF_FLOAT_RGBA_BYTES_PER_PIXEL, estimateTargetBytes } from "./render-target-memory";

const BLOOM_LEVELS = 5;
/** Profiler names per level, built once so a frame never builds a string. Up passes are named by the level they write into. */
const DOWNSAMPLE_PASS_LABELS = Array.from({ length: BLOOM_LEVELS }, (_, level) => `bloomDown${level}`);
const UPSAMPLE_PASS_LABELS = Array.from({ length: BLOOM_LEVELS - 1 }, (_, level) => `bloomUp${level}`);
const LEVEL_MEMORY_GAUGES = Array.from({ length: BLOOM_LEVELS }, (_, level) => `memory.post.bloomLevel${level}Bytes`);
const COMPOSITE_PASS_LABEL = "bloomComposite";
const BLOOM_STRENGTH = 0.9;
/** Colour above this (display space) feeds the bloom. */
const BLOOM_THRESHOLD = 1.0;

const FULLSCREEN_VERTEX_SHADER = `
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const DOWNSAMPLE_FRAGMENT_SHADER = `
in vec2 vUv;
uniform sampler2D source;
uniform vec2 sourceTexelSize;
uniform float threshold;
uniform float isFirstLevel;

vec3 brightPart(vec3 color) {
  return mix(color, max(color - vec3(threshold), vec3(0.0)), isFirstLevel);
}

void main() {
  vec3 sum = brightPart(texture(source, vUv + sourceTexelSize * vec2(-1.0, -1.0)).rgb)
    + brightPart(texture(source, vUv + sourceTexelSize * vec2(1.0, -1.0)).rgb)
    + brightPart(texture(source, vUv + sourceTexelSize * vec2(-1.0, 1.0)).rgb)
    + brightPart(texture(source, vUv + sourceTexelSize * vec2(1.0, 1.0)).rgb);
  gl_FragColor = vec4(sum * 0.25, 1.0);
}
`;

const UPSAMPLE_FRAGMENT_SHADER = `
in vec2 vUv;
uniform sampler2D source;
uniform vec2 sourceTexelSize;

void main() {
  vec3 sum = texture(source, vUv + sourceTexelSize * vec2(-1.0, 0.0)).rgb
    + texture(source, vUv + sourceTexelSize * vec2(1.0, 0.0)).rgb
    + texture(source, vUv + sourceTexelSize * vec2(0.0, -1.0)).rgb
    + texture(source, vUv + sourceTexelSize * vec2(0.0, 1.0)).rgb
    + 2.0 * texture(source, vUv + sourceTexelSize * vec2(-0.5, -0.5)).rgb
    + 2.0 * texture(source, vUv + sourceTexelSize * vec2(0.5, -0.5)).rgb
    + 2.0 * texture(source, vUv + sourceTexelSize * vec2(-0.5, 0.5)).rgb
    + 2.0 * texture(source, vUv + sourceTexelSize * vec2(0.5, 0.5)).rgb;
  gl_FragColor = vec4(sum / 12.0, 1.0);
}
`;

const COMPOSITE_FRAGMENT_SHADER = `
in vec2 vUv;
uniform sampler2D scene;
uniform sampler2D bloom;
uniform float strength;

void main() {
  gl_FragColor = vec4(texture(scene, vUv).rgb + texture(bloom, vUv).rgb * strength, 1.0);
}
`;

function createFullscreenMaterial(
  name: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  additive: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms,
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: additive ? THREE.CustomBlending : THREE.NoBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
}

function createFullscreenScene(material: THREE.ShaderMaterial): THREE.Scene {
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  const mesh = new THREE.Mesh(triangle, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return scene;
}

/** The same 24 bit depth plus 8 bit stencil layout the cloud pass copies depth into, which a framebuffer blit requires. */
function createDepthStencilTexture(width: number, height: number): THREE.DepthTexture {
  const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedInt248Type);
  depthTexture.format = THREE.DepthStencilFormat;
  return depthTexture;
}

function estimateColorTargetBytes(width: number, height: number, withDepth: boolean): number {
  return estimateTargetBytes(width, height, HALF_FLOAT_RGBA_BYTES_PER_PIXEL + (withDepth ? DEPTH_BYTES_PER_PIXEL : 0));
}

function createTarget(width: number, height: number, withDepth: boolean): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: withDepth,
    stencilBuffer: withDepth,
    ...(withDepth ? { depthTexture: createDepthStencilTexture(width, height) } : {}),
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  return target;
}

export class BloomPass {
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private levelTargets: THREE.WebGLRenderTarget[] = [];
  private sceneTargetBytes = 0;
  private levelTargetBytes: number[] = [];
  private isBloomEnabled = false;
  private isOffscreenRequired = false;
  private readonly size = new THREE.Vector2();
  private readonly camera = new THREE.Camera();
  private readonly downsampleUniforms = {
    source: { value: null as THREE.Texture | null },
    sourceTexelSize: { value: new THREE.Vector2() },
    threshold: { value: BLOOM_THRESHOLD },
    isFirstLevel: { value: 1 },
  };
  private readonly upsampleUniforms = {
    source: { value: null as THREE.Texture | null },
    sourceTexelSize: { value: new THREE.Vector2() },
  };
  private readonly compositeUniforms = {
    scene: { value: null as THREE.Texture | null },
    bloom: { value: null as THREE.Texture | null },
    strength: { value: BLOOM_STRENGTH },
  };
  private readonly downsampleMaterial = createFullscreenMaterial("bloom-downsample", DOWNSAMPLE_FRAGMENT_SHADER, this.downsampleUniforms, false);
  private readonly upsampleMaterial = createFullscreenMaterial("bloom-upsample", UPSAMPLE_FRAGMENT_SHADER, this.upsampleUniforms, true);
  private readonly compositeMaterial = createFullscreenMaterial("bloom-composite", COMPOSITE_FRAGMENT_SHADER, this.compositeUniforms, false);
  private readonly downsampleScene = createFullscreenScene(this.downsampleMaterial);
  private readonly upsampleScene = createFullscreenScene(this.upsampleMaterial);
  private readonly compositeScene = createFullscreenScene(this.compositeMaterial);

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /** True while the world is drawn into the offscreen target (bloom, or another effect that reads the finished world). */
  get isOffscreen(): boolean {
    return this.isBloomEnabled || this.isOffscreenRequired;
  }

  get worldTarget(): THREE.WebGLRenderTarget | null {
    return this.isOffscreen ? this.sceneTarget : null;
  }

  setBloomEnabled(isEnabled: boolean): void {
    if (isEnabled === this.isBloomEnabled) return;
    profiler.addCounter("game.post.bloom.enabledChanges");
    this.isBloomEnabled = isEnabled;
    skyLightingUniforms.skyEmissiveGain.value = isEnabled ? EMISSIVE_BLOOM_GAIN : 1;
    this.releaseTargets();
  }

  /** Effects that sample the finished opaque world (water reflections) need it in an offscreen target. */
  setOffscreenRequired(isRequired: boolean): void {
    if (isRequired === this.isOffscreenRequired) return;
    profiler.addCounter("game.post.offscreenRequiredChanges");
    this.isOffscreenRequired = isRequired;
    this.releaseTargets();
  }

  /** Points the renderer at the offscreen scene target (sized to the canvas); call before drawing the world. */
  beginFrame(): void {
    const scopeToken = profiler.begin("main.post.bloom.beginFrame");
    try {
      this.countFrameMode();
      if (!this.isOffscreen) {
        if (profiler.enabled) profiler.sampleGauge("memory.post.totalBytes", 0, "bytes");
        return;
      }
      this.renderer.getDrawingBufferSize(this.size);
      const width = Math.max(1, Math.floor(this.size.x));
      const height = Math.max(1, Math.floor(this.size.y));
      if (!this.sceneTarget || this.sceneTarget.width !== width || this.sceneTarget.height !== height) {
        this.createTargets(width, height);
      }
      if (profiler.enabled) this.sampleMemoryGauges();
      this.renderer.setRenderTarget(this.sceneTarget);
    } finally {
      profiler.end(scopeToken);
    }
  }

  /** Spreads the glow and writes the finished picture to the canvas; call after the whole world is drawn. */
  endFrame(): void {
    if (!this.isOffscreen || !this.sceneTarget) {
      profiler.addCounter("game.post.bloom.endFrameSkipped");
      return;
    }
    const scopeToken = profiler.begin("main.post.bloom.endFrame");
    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    try {
      if (this.levelTargets.length > 0) this.spreadGlow();
      this.compositeUniforms.scene.value = this.sceneTarget.texture;
      this.compositeUniforms.bloom.value = this.levelTargets[0]?.texture ?? this.sceneTarget.texture;
      this.compositeUniforms.strength.value = this.levelTargets.length > 0 ? BLOOM_STRENGTH : 0;
      if (profiler.enabled) {
        measureGpuPass(COMPOSITE_PASS_LABEL, () => this.renderFullscreen(null, this.compositeScene));
      } else {
        this.renderFullscreen(null, this.compositeScene);
      }
      profiler.addCounter("game.post.bloom.composites");
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderer.autoClear = previousAutoClear;
      profiler.end(scopeToken);
    }
  }

  private countFrameMode(): void {
    if (!profiler.enabled) return;
    profiler.addCounter(this.isBloomEnabled ? "game.post.bloom.frames.enabled" : "game.post.bloom.frames.disabled");
    if (!this.isOffscreen) profiler.addCounter("game.post.frames.drawnToCanvas");
    else if (!this.isBloomEnabled) profiler.addCounter("game.post.frames.offscreenWithoutBloom");
    else profiler.addCounter("game.post.frames.offscreenWithBloom");
  }

  private createTargets(width: number, height: number): void {
    const scopeToken = profiler.begin("main.post.bloom.createTargets");
    try {
      profiler.addCounter(this.sceneTarget ? "game.post.bloom.targetResizes" : "game.post.bloom.targetCreates");
      this.releaseTargets();
      this.sceneTarget = createTarget(width, height, true);
      this.sceneTargetBytes = estimateColorTargetBytes(width, height, true);
      if (this.isBloomEnabled) {
        const levelSizes = Array.from({ length: BLOOM_LEVELS }, (_, level) => ({
          levelWidth: Math.max(1, width >> (level + 1)),
          levelHeight: Math.max(1, height >> (level + 1)),
        }));
        this.levelTargets = levelSizes.map(({ levelWidth, levelHeight }) => createTarget(levelWidth, levelHeight, false));
        this.levelTargetBytes = levelSizes.map(({ levelWidth, levelHeight }) => estimateColorTargetBytes(levelWidth, levelHeight, false));
      }
      profiler.addCounter("game.post.bloom.targetsCreated", 1 + this.levelTargets.length);
      profiler.recordBytes("bytes.post.bloomTargetsAllocated", this.sceneTargetBytes + this.totalLevelBytes());
    } finally {
      profiler.end(scopeToken);
    }
  }

  private totalLevelBytes(): number {
    return this.levelTargetBytes.reduce((total, bytes) => total + bytes, 0);
  }

  private sampleMemoryGauges(): void {
    profiler.sampleGauge("memory.post.sceneTargetBytes", this.sceneTargetBytes, "bytes");
    this.levelTargetBytes.forEach((bytes, level) => profiler.sampleGauge(LEVEL_MEMORY_GAUGES[level]!, bytes, "bytes"));
    const levelBytes = this.totalLevelBytes();
    profiler.sampleGauge("memory.post.bloomLevelsBytes", levelBytes, "bytes");
    profiler.sampleGauge("memory.post.totalBytes", this.sceneTargetBytes + levelBytes, "bytes");
    profiler.sampleGauge("game.post.sceneTargetPixels", (this.sceneTarget?.width ?? 0) * (this.sceneTarget?.height ?? 0), "pixels");
  }

  private renderFullscreen(target: THREE.WebGLRenderTarget | null, scene: THREE.Scene): void {
    this.renderer.setRenderTarget(target);
    this.renderer.render(scene, this.camera);
  }

  private spreadGlow(): void {
    if (!this.sceneTarget) return;
    const scopeToken = profiler.begin("main.post.bloom.spreadGlow");
    try {
      let source: THREE.WebGLRenderTarget = this.sceneTarget;
      this.levelTargets.forEach((levelTarget, level) => {
        this.downsampleUniforms.source.value = source.texture;
        this.downsampleUniforms.sourceTexelSize.value.set(0.5 / source.width, 0.5 / source.height);
        this.downsampleUniforms.isFirstLevel.value = level === 0 ? 1 : 0;
        if (profiler.enabled) {
          measureGpuPass(DOWNSAMPLE_PASS_LABELS[level]!, () => this.renderFullscreen(levelTarget, this.downsampleScene));
        } else {
          this.renderFullscreen(levelTarget, this.downsampleScene);
        }
        source = levelTarget;
      });
      for (let level = BLOOM_LEVELS - 1; level > 0; level--) {
        const smaller = this.levelTargets[level]!;
        const larger = this.levelTargets[level - 1]!;
        this.upsampleUniforms.source.value = smaller.texture;
        this.upsampleUniforms.sourceTexelSize.value.set(0.5 / smaller.width, 0.5 / smaller.height);
        if (profiler.enabled) {
          measureGpuPass(UPSAMPLE_PASS_LABELS[level - 1]!, () => this.renderFullscreen(larger, this.upsampleScene));
        } else {
          this.renderFullscreen(larger, this.upsampleScene);
        }
      }
      profiler.addCounter("game.post.bloom.glowSpreads");
    } finally {
      profiler.end(scopeToken);
    }
  }

  dispose(): void {
    this.releaseTargets();
    for (const material of [this.downsampleMaterial, this.upsampleMaterial, this.compositeMaterial]) material.dispose();
    for (const scene of [this.downsampleScene, this.upsampleScene, this.compositeScene]) {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    }
  }

  private releaseTargets(): void {
    const releasedCount = (this.sceneTarget ? 1 : 0) + this.levelTargets.length;
    if (releasedCount > 0) profiler.addCounter("game.post.bloom.targetsReleased", releasedCount);
    this.sceneTarget?.dispose();
    this.sceneTarget = null;
    this.sceneTargetBytes = 0;
    for (const target of this.levelTargets) target.dispose();
    this.levelTargets = [];
    this.levelTargetBytes = [];
  }
}
