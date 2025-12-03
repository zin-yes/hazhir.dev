import * as THREE from "three";

export class BlockHighlighter extends THREE.LineSegments {
  constructor() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(geometry);
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 2,
    });

    super(edges, material);

    this.scale.set(1.002, 1.002, 1.002);
    this.visible = false;
    this.name = "indicator";
  }
}
