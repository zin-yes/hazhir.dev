// Draws the clouds after the world, so terrain and clouds occlude each other correctly. The world is rendered straight
// to the canvas, so its depth is copied out (framebuffer blit) into depth textures: once after the far terrain pass
// (before that pass clears depth for the real chunks) and once after the real chunks. The cloud shader reads both,
// turns them into distances along the view ray and marches the clouds only up to the nearer one.
// If the blit is not supported the pass turns itself off and the sky dome traces the clouds instead (behind the world).

import * as THREE from "three";
import { CLOUD_GLSL } from "./cloud-glsl";

const FULLSCREEN_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const CLOUD_PASS_FRAGMENT_SHADER = `
varying vec2 vUv;

${CLOUD_GLSL}

uniform sampler2D worldDepth;
uniform sampler2D farTerrainDepth;
uniform float farTerrainDepthValid;
uniform mat4 worldProjectionInverse;
uniform mat4 farTerrainProjectionInverse;
uniform mat4 cameraWorldMatrix;

float distanceFromDepth(float depth, mat4 projectionInverse) {
  vec4 viewPosition = projectionInverse * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return length(viewPosition.xyz / viewPosition.w);
}

void main() {
  vec4 farView = worldProjectionInverse * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 viewDirection = normalize(farView.xyz / farView.w);
  vec3 direction = normalize((cameraWorldMatrix * vec4(viewDirection, 0.0)).xyz);

  float terrainDistance = CLOUD_MAX_DISTANCE;
  float worldDepthValue = texture2D(worldDepth, vUv).r;
  if (worldDepthValue < 1.0) terrainDistance = min(terrainDistance, distanceFromDepth(worldDepthValue, worldProjectionInverse));
  if (farTerrainDepthValid > 0.5) {
    float farDepthValue = texture2D(farTerrainDepth, vUv).r;
    if (farDepthValue < 1.0) terrainDistance = min(terrainDistance, distanceFromDepth(farDepthValue, farTerrainProjectionInverse));
  }

  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec4 clouds = traceClouds(viewerPosition, direction, terrainDistance, jitter);

  vec3 gathered = mix(clouds.rgb, fogColor * (1.0 - clouds.w), fogStrength * 0.45);
  float transmittance = clouds.w * (1.0 - cloudMist);
  gathered = gathered * (1.0 - cloudMist) + mistColor * cloudMist;
  float alpha = 1.0 - transmittance;
  if (alpha < 0.002) discard;

  vec3 straight = gathered / alpha;
  gl_FragColor = vec4(linearToOutputTexel(vec4(straight, 1.0)).rgb * alpha, alpha);
}
`;

/** Browsers differ in how the canvas depth buffer is laid out, and a blit needs the same layout on both sides. */
const DEPTH_LAYOUTS = [
  { type: THREE.UnsignedInt248Type, format: THREE.DepthStencilFormat, hasStencil: true },
  { type: THREE.UnsignedIntType, format: THREE.DepthFormat, hasStencil: false },
] as const;

class DepthCopy {
  private layoutIndex = 0;
  private depthTexture: THREE.DepthTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private width = 0;
  private height = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly gl: WebGL2RenderingContext,
  ) {}

  get texture(): THREE.DepthTexture | null {
    return this.depthTexture;
  }

  /** Copies the canvas depth buffer; returns false when the copy is not possible. */
  capture(width: number, height: number): boolean {
    while (this.layoutIndex < DEPTH_LAYOUTS.length) {
      if (this.blitInto(width, height)) return true;
      this.dispose();
      this.layoutIndex++;
    }
    return false;
  }

  private blitInto(width: number, height: number): boolean {
    if (!this.ensureSize(width, height) || this.framebuffer === null) return false;
    const { gl } = this;
    const state = this.renderer.state;
    gl.getError();
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    state.bindFramebuffer(gl.FRAMEBUFFER, null);
    return gl.getError() === gl.NO_ERROR;
  }

  dispose(): void {
    this.depthTexture?.dispose();
    this.depthTexture = null;
    if (this.framebuffer !== null) this.gl.deleteFramebuffer(this.framebuffer);
    this.framebuffer = null;
  }

  private ensureSize(width: number, height: number): boolean {
    if (this.depthTexture !== null && this.width === width && this.height === height) return true;
    this.dispose();
    const layout = DEPTH_LAYOUTS[this.layoutIndex]!;
    const depthTexture = new THREE.DepthTexture(width, height, layout.type);
    depthTexture.format = layout.format;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    depthTexture.generateMipmaps = false;
    depthTexture.needsUpdate = true;
    this.renderer.initTexture(depthTexture);
    const webglTexture = (this.renderer.properties.get(depthTexture) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (!webglTexture) return false;

    const { gl } = this;
    const state = this.renderer.state;
    const framebuffer = gl.createFramebuffer();
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.DRAW_FRAMEBUFFER,
      layout.hasStencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      webglTexture,
      0,
    );
    gl.drawBuffers([gl.NONE]);
    state.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.depthTexture = depthTexture;
    this.framebuffer = framebuffer;
    this.width = width;
    this.height = height;
    return true;
  }
}

export class CloudPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly worldDepthCopy: DepthCopy;
  private readonly farTerrainDepthCopy: DepthCopy;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();
  private farTerrainCapturedThisFrame = false;
  private isUsable = true;

  /** `skyUniforms` are the sky dome's uniform objects, shared so both always see the same sky. */
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    skyUniforms: Record<string, THREE.IUniform>,
  ) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.worldDepthCopy = new DepthCopy(renderer, this.gl);
    this.farTerrainDepthCopy = new DepthCopy(renderer, this.gl);
    this.material = new THREE.ShaderMaterial({
      name: "cloud-pass",
      uniforms: {
        ...skyUniforms,
        worldDepth: { value: null },
        farTerrainDepth: { value: null },
        farTerrainDepthValid: { value: 0 },
        worldProjectionInverse: { value: new THREE.Matrix4() },
        farTerrainProjectionInverse: { value: new THREE.Matrix4() },
        cameraWorldMatrix: { value: new THREE.Matrix4() },
      },
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: CLOUD_PASS_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    triangle.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const mesh = new THREE.Mesh(triangle, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** True while the pass draws the clouds; false means the sky dome must trace them. */
  get isActive(): boolean {
    return this.isUsable;
  }

  /** Call right after the far terrain was drawn and before its depth is cleared. */
  captureFarTerrainDepth(farTerrainCamera: THREE.PerspectiveCamera): void {
    if (!this.isUsable) return;
    this.renderer.getDrawingBufferSize(this.size);
    if (!this.farTerrainDepthCopy.capture(this.size.x, this.size.y)) {
      this.disable();
      return;
    }
    this.material.uniforms.farTerrainProjectionInverse!.value.copy(farTerrainCamera.projectionMatrixInverse);
    this.farTerrainCapturedThisFrame = true;
  }

  /** Call after the whole world is drawn: copies the real chunks' depth and draws the clouds over the canvas. */
  render(camera: THREE.PerspectiveCamera): void {
    if (!this.isUsable) return;
    this.renderer.getDrawingBufferSize(this.size);
    if (!this.worldDepthCopy.capture(this.size.x, this.size.y)) {
      this.disable();
      return;
    }
    camera.updateMatrixWorld();
    const uniforms = this.material.uniforms;
    uniforms.worldDepth!.value = this.worldDepthCopy.texture;
    uniforms.farTerrainDepth!.value = this.farTerrainDepthCopy.texture;
    uniforms.farTerrainDepthValid!.value = this.farTerrainCapturedThisFrame ? 1 : 0;
    uniforms.worldProjectionInverse!.value.copy(camera.projectionMatrixInverse);
    uniforms.cameraWorldMatrix!.value.copy(camera.matrixWorld);
    this.farTerrainCapturedThisFrame = false;

    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    try {
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.renderer.autoClear = previousAutoClear;
    }
  }

  onDisabled?: () => void;

  dispose(): void {
    this.worldDepthCopy.dispose();
    this.farTerrainDepthCopy.dispose();
    this.material.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  }

  private disable(): void {
    this.isUsable = false;
    console.warn("Cloud pass disabled: the depth copy is not supported here, clouds fall back to the sky dome");
    this.onDisabled?.();
  }
}
