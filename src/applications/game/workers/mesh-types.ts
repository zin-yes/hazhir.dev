export interface ChunkFaceBuffers {
  top?: ArrayBuffer;
  bottom?: ArrayBuffer;
  left?: ArrayBuffer;
  right?: ArrayBuffer;
  front?: ArrayBuffer;
  back?: ArrayBuffer;
}

/** All instances of one plant block type in a chunk, one packed uint32 each. */
export interface PlantInstanceBatch {
  blockType: number;
  instances: ArrayBuffer;
}

export interface ChunkMeshResult {
  /** Packed vertices, see vertex-format.ts. Four vertices per quad. */
  opaque: ArrayBuffer;
  transparent: ArrayBuffer;
  plants: PlantInstanceBatch[];
}
