import * as THREE from "three";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "./config";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";
import {
  INDICES_PER_QUAD,
  VERTICES_PER_QUAD,
  WORDS_PER_VERTEX,
} from "./vertex-format";
import {
  beginWorkerTask,
  finishWorkerTask,
  isWorkerProfiling,
} from "./profiler/worker-recorder";
import {
  buildPlantBillboardTemplate,
  buildPlantTemplate,
} from "./workers/plant-voxels";

const PACKED_VERTEX_ATTRIBUTE = "packedVertex";
const PLANT_INSTANCE_ATTRIBUTE = "instanceData";
export const SHARED_ATTRIBUTE_NAME = "shared";
const INITIAL_SHARED_QUAD_CAPACITY = 4096;
const BYTES_PER_INDEX = 4;

const PLANT_TEMPLATE_SCOPE = "main.chunk.buildGeometry.plantTemplate";
const QUAD_GEOMETRY_SCOPE = "main.chunk.buildGeometry.quadGeometry";
const QUAD_INDEX_SCOPE = "main.chunk.buildGeometry.quadGeometry.sharedIndex";
const QUAD_DRAW_RANGE_SCOPE = "main.chunk.buildGeometry.quadGeometry.drawRange";
const QUAD_BOUNDING_SCOPE = "main.chunk.buildGeometry.quadGeometry.boundingSphere";
const SURFACE_ATTRIBUTE_SCOPE = "main.chunk.buildGeometry.surface.attribute";
const PLANT_ATTRIBUTE_SCOPE = "main.chunk.buildGeometry.plants.attributes";
const PLANT_TEMPLATE_UPLOAD_SCOPE = "main.chunk.buildGeometry.plantTemplate.attribute";
const RELEASE_DETACH_SCOPE = "main.chunk.dispose.releaseGeometry.detachShared";
const RELEASE_DISPOSE_SCOPE = "main.chunk.dispose.releaseGeometry.dispose";
const ATTRIBUTE_BYTES_PREFIX = "bytes.geometry.attribute.";
const FREED_BYTES_COUNTER = "game.geometry.releasedAttributeBytes";
const PACKED_VERTEX_BYTES_METER = `${ATTRIBUTE_BYTES_PREFIX}${PACKED_VERTEX_ATTRIBUTE}`;
const PLANT_INSTANCE_BYTES_METER = `${ATTRIBUTE_BYTES_PREFIX}${PLANT_INSTANCE_ATTRIBUTE}`;
const PLANT_TEMPLATE_BYTES_METER = `${ATTRIBUTE_BYTES_PREFIX}plantTemplateVertex`;
const INDEX_BYTES_METER = `${ATTRIBUTE_BYTES_PREFIX}index`;
const TEMPLATE_SCOPE_PREFIX = `${PLANT_TEMPLATE_SCOPE}.`;
const TEMPLATE_COUNTER_PREFIX = "game.geometry.";

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
    profiler.addCounter("game.geometry.sharedIndexReused");
    return sharedQuadIndex;
  }
  const growToken = profiler.begin("main.chunk.buildGeometry.growSharedIndex");
  let capacity = sharedQuadIndex
    ? sharedQuadIndex.count / INDICES_PER_QUAD
    : INITIAL_SHARED_QUAD_CAPACITY;
  while (capacity < quadCount) capacity *= 2;

  const indices = new Uint32Array(capacity * INDICES_PER_QUAD);
  const fillToken = profiler.begin("main.chunk.buildGeometry.growSharedIndex.fill");
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
  profiler.end(fillToken);
  sharedQuadIndex = new THREE.BufferAttribute(indices, 1);
  sharedQuadIndex.name = SHARED_ATTRIBUTE_NAME;
  profiler.addCounter("game.geometry.sharedIndexGrowths");
  profiler.addCounter("game.geometry.sharedIndexQuadsWritten", capacity, "units");
  profiler.recordBytes("bytes.geometry.sharedQuadIndex", indices.byteLength);
  profiler.sampleGauge("memory.geometry.sharedIndexBytes", indices.byteLength, "bytes");
  profiler.sampleGauge("memory.geometry.sharedIndexQuadCapacity", capacity);
  profiler.end(growToken);
  return sharedQuadIndex;
}

function createQuadGeometry<GeometryType extends THREE.BufferGeometry>(
  geometry: GeometryType,
  quadCount: number,
): GeometryType {
  const quadGeometryToken = profiler.begin(QUAD_GEOMETRY_SCOPE);
  const indexToken = profiler.begin(QUAD_INDEX_SCOPE);
  geometry.setIndex(getSharedQuadIndex(quadCount));
  profiler.end(indexToken);
  const drawRangeToken = profiler.begin(QUAD_DRAW_RANGE_SCOPE);
  geometry.setDrawRange(0, quadCount * INDICES_PER_QUAD);
  profiler.end(drawRangeToken);
  const boundingToken = profiler.begin(QUAD_BOUNDING_SCOPE);
  geometry.boundingSphere = CHUNK_BOUNDING_SPHERE.clone();
  profiler.end(boundingToken);
  profiler.end(quadGeometryToken);
  profiler.addCounter("game.geometry.quadsIndexed", quadCount, "units");
  profiler.addCounter("game.geometry.indicesDrawn", quadCount * INDICES_PER_QUAD, "units");
  profiler.recordBytes(INDEX_BYTES_METER, quadCount * INDICES_PER_QUAD * BYTES_PER_INDEX);
  return geometry;
}

/** Geometry for a chunk's opaque or transparent surface, or null when it has no faces. */
export function createChunkSurfaceGeometry(
  vertexBuffer: ArrayBuffer,
): THREE.BufferGeometry | null {
  const words = new Uint32Array(vertexBuffer);
  if (words.length === 0) return null;
  const scopeToken = profiler.begin(
    "main.chunk.buildGeometry.surface",
    DIMENSIONS.simulationSystem,
    "geometry.surface",
  );
  try {
    const attributeToken = profiler.begin(SURFACE_ATTRIBUTE_SCOPE);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      PACKED_VERTEX_ATTRIBUTE,
      new THREE.BufferAttribute(words, WORDS_PER_VERTEX),
    );
    profiler.end(attributeToken);
    const vertexCount = words.length / WORDS_PER_VERTEX;
    profiler.addCounter("game.geometry.surfaceCreated");
    profiler.addCounter("game.geometry.surfaceVertices", vertexCount, "units");
    profiler.recordBytes(PACKED_VERTEX_BYTES_METER, words.byteLength);
    profiler.recordBreakdown(DIMENSIONS.geometryAttribute, PACKED_VERTEX_ATTRIBUTE, {
      units: words.byteLength,
    });
    return createQuadGeometry(geometry, vertexCount / VERTICES_PER_QUAD);
  } finally {
    profiler.end(scopeToken);
  }
}

interface PlantTemplateAttribute {
  attribute: THREE.BufferAttribute;
  quadCount: number;
}

export type PlantDetail = "voxel" | "billboard";

const plantTemplates = new Map<string, PlantTemplateAttribute>();
let plantTemplateCacheBytes = 0;

/**
 * Builds a plant template on the main thread, and carries the template
 * builder's own worker-style sections and counters into the main profiler
 * as sub-scopes of the plant template scope. Templates are built once per
 * block and detail, so the extra work only happens while profiling.
 */
function buildTemplateRecordingSections(blockType: number, detail: PlantDetail) {
  const isRecording = profiler.enabled && !isWorkerProfiling();
  beginWorkerTask(isRecording);
  const built =
    detail === "voxel"
      ? buildPlantTemplate(blockType)
      : buildPlantBillboardTemplate(blockType);
  const taskProfile = finishWorkerTask();
  if (taskProfile) {
    for (const [sectionName, selfMs] of Object.entries(taskProfile.sectionSelfMs)) {
      if (sectionName === "buildPlantTemplate" || sectionName === "buildPlantBillboardTemplate") continue;
      profiler.recordMainThreadTimer(TEMPLATE_SCOPE_PREFIX + sectionName, selfMs);
    }
    for (const [counterName, amount] of Object.entries(taskProfile.counters)) {
      profiler.addCounter(TEMPLATE_COUNTER_PREFIX + counterName, amount, "units");
    }
  }
  return built;
}

function getPlantTemplate(
  blockType: number,
  detail: PlantDetail,
): PlantTemplateAttribute {
  const key = `${blockType}:${detail}`;
  let template = plantTemplates.get(key);
  if (template) {
    profiler.addCounter("game.geometry.plantTemplateHits");
    return template;
  }
  profiler.addCounter("game.geometry.plantTemplateMisses");
  const templateToken = profiler.begin(PLANT_TEMPLATE_SCOPE);
  const built = buildTemplateRecordingSections(blockType, detail);
  profiler.end(templateToken);
  const attributeToken = profiler.begin(PLANT_TEMPLATE_UPLOAD_SCOPE);
  const attribute = new THREE.BufferAttribute(
    new Uint32Array(built.vertexBuffer),
    WORDS_PER_VERTEX,
  );
  attribute.name = SHARED_ATTRIBUTE_NAME;
  profiler.end(attributeToken);
  template = { attribute, quadCount: built.quadCount };
  plantTemplates.set(key, template);
  if (profiler.enabled) {
    plantTemplateCacheBytes += built.vertexBuffer.byteLength;
    profiler.addCounter("game.geometry.plantTemplateQuadsBuilt", built.quadCount, "units");
    profiler.recordBytes(PLANT_TEMPLATE_BYTES_METER, built.vertexBuffer.byteLength);
    profiler.sampleGauge("memory.geometry.plantTemplateEntries", plantTemplates.size);
    profiler.sampleGauge("memory.geometry.plantTemplateBytes", plantTemplateCacheBytes, "bytes");
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

  const scopeToken = profiler.begin(
    "main.chunk.buildGeometry.plants",
    DIMENSIONS.simulationSystem,
    "geometry.plants",
  );
  try {
    const attributeToken = profiler.begin(PLANT_ATTRIBUTE_SCOPE);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(PACKED_VERTEX_ATTRIBUTE, template.attribute);
    geometry.setAttribute(
      PLANT_INSTANCE_ATTRIBUTE,
      new THREE.InstancedBufferAttribute(instanceWords, 1),
    );
    geometry.instanceCount = instanceWords.length;
    profiler.end(attributeToken);
    profiler.addCounter("game.geometry.plantInstancesCreated", instanceWords.length);
    profiler.addCounter("game.geometry.plantGeometriesCreated");
    profiler.recordBytes(PLANT_INSTANCE_BYTES_METER, instanceWords.byteLength);
    profiler.recordBreakdown(DIMENSIONS.geometryAttribute, PLANT_INSTANCE_ATTRIBUTE, {
      units: instanceWords.byteLength,
    });
    return createQuadGeometry(geometry, template.quadCount);
  } finally {
    profiler.end(scopeToken);
  }
}

export function plantTemplateVertexCount(blockType: number): number {
  return getPlantTemplate(blockType, "voxel").quadCount * VERTICES_PER_QUAD;
}

/**
 * Frees the GPU buffers owned by one chunk's geometry. Buffers shared with other
 * chunks are detached first so disposing the geometry cannot delete them.
 */
export function releaseChunkGeometry(geometry: THREE.BufferGeometry) {
  const scopeToken = profiler.begin("main.chunk.dispose.releaseGeometry");
  const detachToken = profiler.begin(RELEASE_DETACH_SCOPE);
  let sharedAttributesDetached = 0;
  let ownedAttributeBytes = 0;
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.attributes[name];
    if (attribute.name === SHARED_ATTRIBUTE_NAME) {
      geometry.deleteAttribute(name);
      sharedAttributesDetached++;
    } else if (profiler.enabled) {
      ownedAttributeBytes += attribute.array.byteLength;
    }
  }
  if (geometry.index === sharedQuadIndex) geometry.setIndex(null);
  profiler.end(detachToken);
  const disposeToken = profiler.begin(RELEASE_DISPOSE_SCOPE);
  geometry.dispose();
  profiler.end(disposeToken);
  profiler.addCounter("game.geometry.released");
  profiler.addCounter("game.geometry.sharedAttributesDetached", sharedAttributesDetached, "units");
  profiler.addCounter(FREED_BYTES_COUNTER, ownedAttributeBytes, "bytes");
  profiler.end(scopeToken);
}
