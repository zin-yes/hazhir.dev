import * as THREE from "three";
import { SHARED_ATTRIBUTE_NAME } from "../chunk-geometry";
import { profiler } from "./index";

export interface SceneMemoryInputs {
  chunkByteLengths: number[];
  lightByteLengths: number[];
  /** One entry per chunk mesh: the byte length of each of its attribute arrays. */
  meshAttributeByteLengths: number[][];
  /** Number of edited blocks per modified chunk. */
  modifiedBlockCounts: number[];
  textureArrayBytes: number;
}

export interface SceneMemoryGauge {
  value: number;
  unit: "bytes" | "count";
}

const CHUNK_MESH_NAME_PATTERN = /^-?\d+,-?\d+,-?\d+(_transparent|_plant_\d+)?$/;

function sum(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function computeSceneMemoryGauges(
  inputs: SceneMemoryInputs,
): Record<string, SceneMemoryGauge> {
  return {
    "memory.chunkDataBytes": { value: sum(inputs.chunkByteLengths), unit: "bytes" },
    "memory.lightDataBytes": { value: sum(inputs.lightByteLengths), unit: "bytes" },
    "memory.geometryBytes": {
      value: sum(inputs.meshAttributeByteLengths.map(sum)),
      unit: "bytes",
    },
    "memory.chunkCount": { value: inputs.chunkByteLengths.length, unit: "count" },
    "memory.meshObjects": { value: inputs.meshAttributeByteLengths.length, unit: "count" },
    "memory.modifiedBlocks": { value: sum(inputs.modifiedBlockCounts), unit: "count" },
    "memory.textureArrayBytes": { value: inputs.textureArrayBytes, unit: "bytes" },
  };
}

export function collectMeshAttributeByteLengths(scene: THREE.Scene): number[][] {
  const meshes: number[][] = [];
  for (const object of scene.children) {
    if (!(object instanceof THREE.Mesh) || !CHUNK_MESH_NAME_PATTERN.test(object.name)) {
      continue;
    }
    const byteLengths: number[] = [];
    const geometry = object.geometry as THREE.BufferGeometry;
    // Plant templates and the quad index are shared by every chunk, so they are not a per-mesh cost.
    for (const attribute of Object.values(geometry.attributes)) {
      if (attribute.name === SHARED_ATTRIBUTE_NAME) continue;
      byteLengths.push((attribute.array as ArrayBufferView).byteLength);
    }
    meshes.push(byteLengths);
  }
  return meshes;
}

export interface SceneMemorySources {
  getScene: () => THREE.Scene;
  getChunks: () => { [chunkName: string]: Uint8Array };
  getLightChunks: () => { [chunkName: string]: Uint8Array };
  getModifiedChunks: () => Map<string, Map<number, number>>;
  getTextureArrayBytes: () => number;
}

/** Publishes the memory gauges once; register it with profiler.addSampler. */
export function sampleSceneMemory(sources: SceneMemorySources) {
  if (!profiler.enabled) return;
  const gauges = computeSceneMemoryGauges({
    chunkByteLengths: Object.values(sources.getChunks()).map((chunk) => chunk.byteLength),
    lightByteLengths: Object.values(sources.getLightChunks()).map((light) => light.byteLength),
    meshAttributeByteLengths: collectMeshAttributeByteLengths(sources.getScene()),
    modifiedBlockCounts: Array.from(sources.getModifiedChunks().values()).map(
      (edits) => edits.size,
    ),
    textureArrayBytes: sources.getTextureArrayBytes(),
  });
  for (const [name, gauge] of Object.entries(gauges)) {
    profiler.sampleGauge(name, gauge.value, gauge.unit);
  }
}
