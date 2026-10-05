// A copy of the opaque world (colour and depth) taken just before the water is drawn, so the water shader can read
// what lies behind and above it: refraction, depth tint, shoreline foam and screen space reflections. The water cannot
// read the target it draws into, hence the copy (framebuffer blits, which keep the exact half float colour and the
// 24 bit depth).

import * as THREE from "three";

export const worldSnapshotUniforms = {
  worldSnapshotColor: { value: null as THREE.Texture | null },
  worldSnapshotDepth: { value: null as THREE.Texture | null },
  /** 0 until a snapshot exists; the water shader then falls back to its plain look. */
  worldSnapshotEnabled: { value: 0 },
  worldSnapshotViewProjection: { value: new THREE.Matrix4() },
  worldSnapshotNearFar: { value: new THREE.Vector2(0.1, 10000) },
  worldSnapshotResolution: { value: new THREE.Vector2(1, 1) },
};

export class WorldSnapshot {
  private colorTarget: THREE.WebGLRenderTarget | null = null;
  private depthTarget: THREE.WebGLRenderTarget | null = null;
  private readonly gl: WebGL2RenderingContext;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
  }

  /** Copies `source` (the world target, fully drawn but for the water) and publishes it to the water shaders. */
  capture(source: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera): boolean {
    const sourceFramebuffer = this.framebufferOf(source);
    if (!sourceFramebuffer) return this.disable();
    this.ensureTargets(source.width, source.height);
    const colorFramebuffer = this.colorTarget && this.framebufferOf(this.colorTarget);
    const depthFramebuffer = this.depthTarget && this.framebufferOf(this.depthTarget);
    if (!colorFramebuffer || !depthFramebuffer) return this.disable();

    const { gl } = this;
    const state = this.renderer.state;
    gl.getError();
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFramebuffer);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, colorFramebuffer);
    gl.blitFramebuffer(0, 0, source.width, source.height, 0, 0, source.width, source.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, depthFramebuffer);
    gl.blitFramebuffer(0, 0, source.width, source.height, 0, 0, source.width, source.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    state.bindFramebuffer(gl.FRAMEBUFFER, sourceFramebuffer);
    if (gl.getError() !== gl.NO_ERROR) return this.disable();

    camera.updateMatrixWorld();
    worldSnapshotUniforms.worldSnapshotViewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    worldSnapshotUniforms.worldSnapshotNearFar.value.set(camera.near, camera.far);
    worldSnapshotUniforms.worldSnapshotResolution.value.set(source.width, source.height);
    worldSnapshotUniforms.worldSnapshotColor.value = this.colorTarget!.texture;
    worldSnapshotUniforms.worldSnapshotDepth.value = this.depthTarget!.depthTexture;
    worldSnapshotUniforms.worldSnapshotEnabled.value = 1;
    return true;
  }

  release(): void {
    worldSnapshotUniforms.worldSnapshotEnabled.value = 0;
    this.colorTarget?.dispose();
    this.depthTarget?.depthTexture?.dispose();
    this.depthTarget?.dispose();
    this.colorTarget = null;
    this.depthTarget = null;
  }

  dispose(): void {
    this.release();
  }

  private disable(): boolean {
    worldSnapshotUniforms.worldSnapshotEnabled.value = 0;
    return false;
  }

  private framebufferOf(target: THREE.WebGLRenderTarget): WebGLFramebuffer | null {
    this.renderer.initRenderTarget(target);
    const properties = this.renderer.properties.get(target) as { __webglFramebuffer?: WebGLFramebuffer };
    return properties.__webglFramebuffer ?? null;
  }

  private ensureTargets(width: number, height: number): void {
    if (this.colorTarget && this.colorTarget.width === width && this.colorTarget.height === height) return;
    this.release();
    this.colorTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedInt248Type);
    depthTexture.format = THREE.DepthStencilFormat;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: true,
      depthTexture,
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      generateMipmaps: false,
    });
    worldSnapshotUniforms.worldSnapshotColor.value = this.colorTarget.texture;
    worldSnapshotUniforms.worldSnapshotDepth.value = depthTexture;
  }
}
