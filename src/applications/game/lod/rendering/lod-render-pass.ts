// The LOD draws in its own pass before the main scene: same view, its own near and far planes, then the depth buffer
// is cleared so real chunks always land on top. With far terrain in a separate depth range, the main camera keeps its
// near plane and depth precision, and the LOD camera can push its near plane out to the nearest visible LOD geometry
// (usually just past the real chunks), which keeps a 24-bit depth buffer under a quarter block of error at 16 km.
// The sky has to draw in this pass (first), because after the depth clear it would cover the LOD.

import * as THREE from "three";

const BACKGROUND_RENDER_ORDER = -1_000_000;

export class LodRenderPass {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera();
  private adoptedBackground: { object: THREE.Object3D; previousParent: THREE.Object3D | null; previousRenderOrder: number } | null = null;

  constructor() {
    this.scene.name = "lod";
  }

  /** Moves the sky (or any backdrop) into this pass, drawn before every tile. */
  adoptBackground(object: THREE.Object3D): void {
    this.releaseBackground();
    this.adoptedBackground = { object, previousParent: object.parent, previousRenderOrder: object.renderOrder };
    object.renderOrder = BACKGROUND_RENDER_ORDER;
    this.scene.add(object);
  }

  releaseBackground(): void {
    if (this.adoptedBackground === null) return;
    const { object, previousParent, previousRenderOrder } = this.adoptedBackground;
    object.renderOrder = previousRenderOrder;
    if (previousParent !== null) previousParent.add(object);
    else this.scene.remove(object);
    this.adoptedBackground = null;
  }

  /** Renders the LOD scene from the view camera's pose with the given clip planes, then clears depth. */
  render(renderer: THREE.WebGLRenderer, viewCamera: THREE.PerspectiveCamera, nearPlane: number, farPlane: number): void {
    viewCamera.updateMatrixWorld();
    this.camera.fov = viewCamera.fov;
    this.camera.aspect = viewCamera.aspect;
    this.camera.zoom = viewCamera.zoom;
    this.camera.near = nearPlane;
    this.camera.far = farPlane;
    this.camera.updateProjectionMatrix();
    viewCamera.matrixWorld.decompose(this.camera.position, this.camera.quaternion, this.camera.scale);
    this.camera.updateMatrixWorld(true);
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.render(this.scene, this.camera);
      renderer.clearDepth();
    } finally {
      renderer.autoClear = previousAutoClear;
    }
  }
}
