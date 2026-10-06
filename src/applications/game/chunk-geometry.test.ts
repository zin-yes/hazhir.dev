import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BlockType } from "./blocks";
import {
  createChunkSurfaceGeometry,
  createPlantInstanceGeometry,
  plantTemplateVertexCount,
  releaseChunkGeometry,
} from "./chunk-geometry";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";
import { VERTICES_PER_QUAD, WORDS_PER_VERTEX } from "./vertex-format";

const GRASS_PLANT_COUNT = 40;

function counterTotal(name: string): number {
  return profiler.snapshot().counters.find((counter) => counter.name === name)?.total ?? 0;
}

function breakdownUnits(dimension: string, key: string): number {
  const summary = profiler.snapshot().breakdowns.find((candidate) => candidate.dimension === dimension);
  return summary?.entries.find((entry) => entry.key === key)?.units ?? 0;
}

describe("chunk geometry profiling", () => {
  beforeEach(() => {
    profiler.setEnabled(true);
    profiler.reset("chunk-geometry-test");
  });
  afterEach(() => profiler.setEnabled(false));

  test("a plant template is built once, and its sections reach the profiler", () => {
    const instances = new Uint32Array(GRASS_PLANT_COUNT).map((_, index) => index + 1);
    createPlantInstanceGeometry(BlockType.TALL_GRASS, instances.buffer.slice(0) as ArrayBuffer, "billboard");
    const missesAfterFirst = counterTotal("game.geometry.plantTemplateMisses");
    createPlantInstanceGeometry(BlockType.TALL_GRASS, instances.buffer.slice(0) as ArrayBuffer, "billboard");

    expect(missesAfterFirst).toBe(1);
    expect(counterTotal("game.geometry.plantTemplateMisses")).toBe(1);
    expect(counterTotal("game.geometry.plantTemplateHits")).toBe(1);
    expect(counterTotal("game.geometry.plantBillboardQuads")).toBe(counterTotal("game.geometry.plantTemplateQuadsBuilt"));
    expect(counterTotal("game.geometry.plantInstancesCreated")).toBe(2 * GRASS_PLANT_COUNT);
    expect(breakdownUnits(DIMENSIONS.geometryAttribute, "instanceData")).toBe(2 * GRASS_PLANT_COUNT * 4);
  });

  test("voxel plant templates report their voxel cells", () => {
    const quadCount = plantTemplateVertexCount(BlockType.TALL_GRASS) / VERTICES_PER_QUAD;

    expect(quadCount).toBeGreaterThan(50);
    expect(counterTotal("game.geometry.plantVoxelCells")).toBeGreaterThan(20);
    expect(counterTotal("game.geometry.plantTemplateQuadsBuilt")).toBe(quadCount);
  });

  test("releasing a plant geometry frees only the buffers it owns", () => {
    const instances = new Uint32Array(GRASS_PLANT_COUNT).map((_, index) => index + 1);
    const geometry = createPlantInstanceGeometry(BlockType.TALL_GRASS, instances.buffer.slice(0) as ArrayBuffer);
    if (!geometry) throw new Error("plant geometry expected");
    releaseChunkGeometry(geometry);

    expect(counterTotal("game.geometry.releasedAttributeBytes")).toBe(GRASS_PLANT_COUNT * 4);
    expect(counterTotal("game.geometry.sharedAttributesDetached")).toBe(1);
  });

  test("surface geometry counts its vertices and packed bytes", () => {
    const quadCount = 300;
    const words = new Uint32Array(quadCount * VERTICES_PER_QUAD * WORDS_PER_VERTEX).fill(7);
    const geometry = createChunkSurfaceGeometry(words.buffer as ArrayBuffer);
    if (!geometry) throw new Error("surface geometry expected");

    expect(counterTotal("game.geometry.surfaceVertices")).toBe(quadCount * VERTICES_PER_QUAD);
    expect(breakdownUnits(DIMENSIONS.geometryAttribute, "packedVertex")).toBe(words.byteLength);
    expect(counterTotal("game.geometry.indicesDrawn")).toBe(quadCount * 6);
  });
});
