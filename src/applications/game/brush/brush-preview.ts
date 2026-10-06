// The ghost sphere that shows where the brush lands: one mesh and one geometry for the whole session, moved and scaled
// per frame, never rebuilt.

import * as THREE from "three";
import { profiler } from "../profiler";

const PAINT_COLOR = 0xb6f24a;
const ERASE_COLOR = 0xff6b6b;

export class BrushPreview extends THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial> {
  private isShowingErase = false;

  constructor() {
    const createToken = profiler.begin("main.brush.createPreview");
    super(
      new THREE.IcosahedronGeometry(1, 3),
      new THREE.MeshBasicMaterial({ color: PAINT_COLOR, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    profiler.end(createToken);
    profiler.addCounter("game.brush.previewsCreated");
    profiler.sampleGauge("game.brush.previewVertices", this.geometry.attributes.position?.count ?? 0);
    this.name = "brushPreview";
    this.visible = false;
    this.renderOrder = 10;
    this.frustumCulled = false;
  }

  show(center: { x: number; y: number; z: number }, radius: number, isErasing: boolean): void {
    profiler.addCounter(this.visible ? "game.brush.previewMoves" : "game.brush.previewAppearances");
    if (isErasing !== this.isShowingErase) profiler.addCounter("game.brush.previewColorSwitches");
    this.isShowingErase = isErasing;
    profiler.sampleGauge("game.brush.previewRadius", radius, "blocks");
    this.position.set(center.x, center.y, center.z);
    // Cells within the radius of the center block count, so the visible shell sits half a block further out.
    this.scale.setScalar(radius + 0.5);
    this.material.color.setHex(isErasing ? ERASE_COLOR : PAINT_COLOR);
    this.visible = true;
  }

  hide(): void {
    if (this.visible) profiler.addCounter("game.brush.previewHidden");
    this.visible = false;
  }

  dispose(): void {
    profiler.addCounter("game.brush.previewsDisposed");
    this.geometry.dispose();
    this.material.dispose();
  }
}
