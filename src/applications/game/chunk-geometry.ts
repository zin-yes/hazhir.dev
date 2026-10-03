import * as THREE from "three";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "./config";
import {
  INDICES_PER_QUAD,
  VERTICES_PER_QUAD,
  WORDS_PER_VERTEX,
} from "./vertex-format";
import {
  buildPlantBillboardTemplate,
  buildPlantTemplate,
} from "./workers/plant-voxels";

const PACKED_VERTEX_ATTRIBUTE = "packedVertex";
const PLANT_INSTANCE_ATTRIBUTE = "instanceData";
export const SHARED_ATTRIBUTE_NAME = "shared";
const INITIAL_SHARED_QUAD_CAPACITY = 4096;

// The mesh sits at the chunk corner, so one sphere around the chunk's middle bounds every chunk.
const CHUNK_BOUNDING_SPHERE = new THREE.Sphere(
  new THREE.Vector3(CHUNK_WIDTH / 2, CHUNK_HEIGHT / 2, CHUNK_LENGTH / 2),
  Math.hypot(CHUNK_WIDTH, CHUNK_HEIGHT, CHUNK_LENGTH) / 2 + 1,
);

let sharedQuadIndex: THREE.BufferAttribute | null = null;

/**
 * Every quad is split as (0 1 2) (2 1 3), so one index buffer serves all chunk
 * meshes and plant templates. It grows by doubling when a mesh needs more quads.
 */
function getSharedQuadIndex(quadCount: number): THREE.BufferAttribute {
  if (
    sharedQuadIndex &&
    sharedQuadIndex.count >= quadCount * INDICES_PER_QUAD
  ) {
    return sharedQuadIndex;
  }
  let capacity = sharedQuadIndex
    ? sharedQuadIndex.count / INDICES_PER_QUAD
    : INITIAL_SHARED_QUAD_CAPACITY;
  while (capacity < quadCount) capacity *= 2;

  const indices = new Uint32Array(capacity * INDICES_PER_QUAD);
  for (let quad = 0; quad < capacity; quad++) {
    const firstVertex = quad * VERTICES_PER_QUAD;
    const firstIndex = quad * INDICES_PER_QUAD;
    indices[firstIndex] = firstVertex;
    indices[firstIndex + 1] = firstVertex + 1;
    indices[firstIndex + 2] = firstVertex + 2;
    indices[firstIndex + 3] = firstVertex + 2;
    indices[firstIndex + 4] = firstVertex + 1;
    indices[firstIndex + 5] = firstVertex + 3;
  }
  sharedQuadIndex = new THREE.BufferAttribute(indices, 1);
  sharedQuadIndex.name = SHARED_ATTRIBUTE_NAME;
  return sharedQuadIndex;
}

function createQuadGeometry<GeometryType extends THREE.BufferGeometry>(
  geometry: GeometryType,
  quadCount: number,
): GeometryType {
  geometry.setIndex(getSharedQuadIndex(quadCount));
  geometry.setDrawRange(0, quadCount * INDICES_PER_QUAD);
  geometry.boundingSphere = CHUNK_BOUNDING_SPHERE.clone();
  return geometry;
}

/** Geometry for a chunk's opaque or transparent surface, or null when it has no faces. */
export function createChunkSurfaceGeometry(
  vertexBuffer: ArrayBuffer,
): THREE.BufferGeometry | null {
  const words = new Uint32Array(vertexBuffer);
  if (words.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    PACKED_VERTEX_ATTRIBUTE,
    new THREE.BufferAttribute(words, WORDS_PER_VERTEX),
  );
  return createQuadGeometry(
    geometry,
    words.length / WORDS_PER_VERTEX / VERTICES_PER_QUAD,
  );
}

interface PlantTemplateAttribute {
  attribute: THREE.BufferAttribute;
  quadCount: number;
}

export type PlantDetail = "voxel" | "billboard";

const plantTemplates = new Map<string, PlantTemplateAttribute>();

function getPlantTemplate(
  blockType: number,
  detail: PlantDetail,
): PlantTemplateAttribute {
  const key = `${blockType}:${detail}`;
  let template = plantTemplates.get(key);
  if (!template) {
    const built =
      detail === "voxel"
        ? buildPlantTemplate(blockType)
        : buildPlantBillboardTemplate(blockType);
    const attribute = new THREE.BufferAttribute(
      new Uint32Array(built.vertexBuffer),
      WORDS_PER_VERTEX,
    );
    attribute.name = SHARED_ATTRIBUTE_NAME;
    template = { attribute, quadCount: built.quadCount };
    plantTemplates.set(key, template);
  }
  return template;
}

/** One draw for every plant of a type in a chunk: a shared template, one uint32 per plant. */
export function createPlantInstanceGeometry(
  blockType: number,
  instanceBuffer: ArrayBuffer,
  detail: PlantDetail = "voxel",
): THREE.InstancedBufferGeometry | null {
  const instanceWords = new Uint32Array(instanceBuffer);
  const template = getPlantTemplate(blockType, detail);
  if (instanceWords.length === 0 || template.quadCount === 0) return null;

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(PACKED_VERTEX_ATTRIBUTE, template.attribute);
  geometry.setAttribute(
    PLANT_INSTANCE_ATTRIBUTE,
    new THREE.InstancedBufferAttribute(instanceWords, 1),
  );
  geometry.instanceCount = instanceWords.length;
  return createQuadGeometry(geometry, template.quadCount);
}

export function plantTemplateVertexCount(blockType: number): number {
  return getPlantTemplate(blockType, "voxel").quadCount * VERTICES_PER_QUAD;
}

/**
 * Frees the GPU buffers owned by one chunk's geometry. Buffers shared with other
 * chunks are detached first so disposing the geometry cannot delete them.
 */
export function releaseChunkGeometry(geometry: THREE.BufferGeometry) {
  for (const name of Object.keys(geometry.attributes)) {
    if (geometry.attributes[name].name === SHARED_ATTRIBUTE_NAME)
      geometry.deleteAttribute(name);
  }
  if (geometry.index === sharedQuadIndex) geometry.setIndex(null);
  geometry.dispose();
}
