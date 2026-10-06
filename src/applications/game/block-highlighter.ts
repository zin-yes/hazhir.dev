import * as THREE from "three";
import { profiler } from "./profiler";

export class BlockHighlighter extends THREE.LineSegments {
  constructor() {
    const createToken = profiler.begin("main.highlighter.create");
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(geometry);
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 2,
    });

    super(edges, material);

    profiler.end(createToken);
    profiler.addCounter("game.highlighter.created");
    profiler.sampleGauge("game.highlighter.edgeVertices", edges.attributes.position?.count ?? 0);
    this.scale.set(1.002, 1.002, 1.002);
    this.visible = false;
    this.name = "indicator";
  }
}
