/**
 * Mesher microbenchmark on real generated terrain.
 *
 *   bun src/applications/game/workers/mesh.bench.ts [--isolated]
 *
 * With --isolated no neighbor slabs are passed, which is how chunks are meshed
 * while their neighbors are still loading.
 *
 * Chunk blocks and light are generated on the first run and cached in the OS
 * temp directory (never in the repo), so later runs only measure meshing.
 * Delete the cache file to regenerate after worldgen or lighting changes.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { extractBorderSlab } from "../chunk-borders";
import { WORDS_PER_VERTEX, VERTICES_PER_QUAD } from "../vertex-format";
import { generateChunkBlocks } from "../worldgen/chunk-generator";
import { initializeChunkLight, propagateChunkLight } from "./lighting";
import { generateMesh } from "./mesh";
import type { ChunkFaceBuffers } from "./mesh-types";

const SEED = 2024;
const BLOCKS_PER_CHUNK = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;
const CACHE_PATH = join(tmpdir(), `voxel-mesh-bench-seed${SEED}-v1.bin`);
const WARMUP_ITERATIONS = 5;
const MEASURED_ITERATIONS = 30;

const COLUMN_OFFSETS: Array<[number, number]> = [
  [0, 0], [7, -3], [-9, 4], [15, 15], [-20, -12], [30, 5], [-4, 22], [12, -25],
];
const CHUNK_Y_LEVELS = [1, 2, 3];

type ChunkCoordinate = [number, number, number];

interface BenchChunk {
  coordinate: ChunkCoordinate;
  blocks: Uint8Array;
  light: Uint8Array;
  borders: ChunkFaceBuffers;
  borderLights: ChunkFaceBuffers;
}

function coordinateKey([chunkX, chunkY, chunkZ]: ChunkCoordinate) {
  return `${chunkX},${chunkY},${chunkZ}`;
}

function buildBenchChunks(): BenchChunk[] {
  const blocksByKey = new Map<string, Uint8Array>();
  const blocksAt = (coordinate: ChunkCoordinate) => {
    const key = coordinateKey(coordinate);
    let blocks = blocksByKey.get(key);
    if (!blocks) {
      blocks = generateChunkBlocks(SEED, ...coordinate);
      blocksByKey.set(key, blocks);
    }
    return blocks;
  };
  const initialLightByKey = new Map<string, Uint8Array>();
  const initialLightAt = (coordinate: ChunkCoordinate) => {
    const key = coordinateKey(coordinate);
    let light = initialLightByKey.get(key);
    if (!light) {
      const [chunkX, chunkY, chunkZ] = coordinate;
      light = initializeChunkLight(
        blocksAt(coordinate), SEED, chunkX, chunkY, chunkZ,
        blocksAt([chunkX, chunkY + 1, chunkZ]),
      ).light;
      initialLightByKey.set(key, light);
    }
    return light;
  };

  const neighborSteps: Array<{ step: ChunkCoordinate; borderFace: keyof ChunkFaceBuffers; slabFace: keyof ChunkFaceBuffers }> = [
    { step: [-1, 0, 0], borderFace: "left", slabFace: "left" },
    { step: [1, 0, 0], borderFace: "right", slabFace: "right" },
    { step: [0, 1, 0], borderFace: "top", slabFace: "top" },
    { step: [0, -1, 0], borderFace: "bottom", slabFace: "bottom" },
    { step: [0, 0, 1], borderFace: "front", slabFace: "front" },
    { step: [0, 0, -1], borderFace: "back", slabFace: "back" },
  ];

  const benchChunks: BenchChunk[] = [];
  for (const [columnX, columnZ] of COLUMN_OFFSETS) {
    for (const chunkY of CHUNK_Y_LEVELS) {
      const coordinate: ChunkCoordinate = [columnX, chunkY, columnZ];
      const blocks = blocksAt(coordinate);
      if (!blocks.some((block) => block !== BlockType.AIR)) continue;

      const borders: ChunkFaceBuffers = {};
      const borderLights: ChunkFaceBuffers = {};
      const neighborBlocks: { [key: string]: Uint8Array } = {};
      const neighborLights: { [key: string]: Uint8Array } = {};
      for (const { step, borderFace, slabFace } of neighborSteps) {
        const neighborCoordinate: ChunkCoordinate = [
          columnX + step[0], chunkY + step[1], columnZ + step[2],
        ];
        const neighbor = blocksAt(neighborCoordinate);
        const neighborLight = initialLightAt(neighborCoordinate);
        borders[borderFace] = extractBorderSlab(neighbor, slabFace);
        borderLights[borderFace] = extractBorderSlab(neighborLight, slabFace);
        neighborBlocks[step.join(",")] = neighbor;
        neighborLights[step.join(",")] = neighborLight;
      }
      const initialized = initializeChunkLight(
        blocks, SEED, columnX, chunkY, columnZ, blocksAt([columnX, chunkY + 1, columnZ]),
      );
      const light = propagateChunkLight(
        blocks, initialized.light, neighborBlocks, neighborLights, initialized.queue,
      ).centerLight;
      benchChunks.push({ coordinate, blocks, light, borders, borderLights });
    }
  }
  return benchChunks;
}

const SLAB_FACES: Array<keyof ChunkFaceBuffers> = ["top", "bottom", "left", "right", "front", "back"];

function serializeChunks(chunks: BenchChunk[]): Buffer {
  const parts: Buffer[] = [];
  const header = chunks.map((chunk) => ({
    coordinate: chunk.coordinate,
    borderFaces: SLAB_FACES.filter((face) => chunk.borders[face]),
    slabByteLengths: SLAB_FACES.map((face) => chunk.borders[face]?.byteLength ?? 0),
  }));
  const headerBuffer = Buffer.from(JSON.stringify(header));
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32LE(headerBuffer.length);
  parts.push(headerLength, headerBuffer);
  for (const chunk of chunks) {
    parts.push(Buffer.from(chunk.blocks), Buffer.from(chunk.light));
    for (const face of SLAB_FACES) {
      if (chunk.borders[face]) parts.push(Buffer.from(chunk.borders[face]!));
      if (chunk.borderLights[face]) parts.push(Buffer.from(chunk.borderLights[face]!));
    }
  }
  return Buffer.concat(parts);
}

function deserializeChunks(file: Buffer): BenchChunk[] {
  const headerLength = file.readUInt32LE(0);
  const header = JSON.parse(file.subarray(4, 4 + headerLength).toString()) as Array<{
    coordinate: ChunkCoordinate;
    borderFaces: Array<keyof ChunkFaceBuffers>;
    slabByteLengths: number[];
  }>;
  let cursor = 4 + headerLength;
  const take = (length: number) => {
    const copy = new Uint8Array(file.subarray(cursor, cursor + length));
    cursor += length;
    return copy;
  };
  return header.map((entry) => {
    const blocks = take(BLOCKS_PER_CHUNK);
    const light = take(BLOCKS_PER_CHUNK);
    const borders: ChunkFaceBuffers = {};
    const borderLights: ChunkFaceBuffers = {};
    SLAB_FACES.forEach((face, faceIndex) => {
      if (!entry.borderFaces.includes(face)) return;
      const slabLength = entry.slabByteLengths[faceIndex];
      borders[face] = take(slabLength).buffer as ArrayBuffer;
      borderLights[face] = take(slabLength).buffer as ArrayBuffer;
    });
    return { coordinate: entry.coordinate, blocks, light, borders, borderLights };
  });
}

function loadBenchChunks(): BenchChunk[] {
  if (existsSync(CACHE_PATH)) return deserializeChunks(readFileSync(CACHE_PATH));
  console.log("generating fixture chunks (first run only)...");
  const chunks = buildBenchChunks();
  writeFileSync(CACHE_PATH, serializeChunks(chunks));
  return chunks;
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

const isIsolated = process.argv.includes("--isolated");

function meshOnce(chunk: BenchChunk) {
  return generateMesh(
    chunk.blocks.buffer as ArrayBuffer,
    chunk.light.buffer as ArrayBuffer,
    isIsolated ? {} : chunk.borders,
    isIsolated ? {} : chunk.borderLights,
    SEED,
    ...chunk.coordinate,
  );
}

const chunks = loadBenchChunks();
const rows: string[] = [];
let totalMedianMs = 0;
let totalQuads = 0;
let totalBytes = 0;
let totalPlantInstances = 0;

for (const chunk of chunks) {
  for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration++) meshOnce(chunk);
  const durations: number[] = [];
  let result = meshOnce(chunk);
  for (let iteration = 0; iteration < MEASURED_ITERATIONS; iteration++) {
    const startedAtMs = performance.now();
    result = meshOnce(chunk);
    durations.push(performance.now() - startedAtMs);
  }
  const opaqueQuads = result.opaque.byteLength / 4 / WORDS_PER_VERTEX / VERTICES_PER_QUAD;
  const transparentQuads = result.transparent.byteLength / 4 / WORDS_PER_VERTEX / VERTICES_PER_QUAD;
  const plantInstances = result.plants.reduce((sum, batch) => sum + batch.instances.byteLength / 4, 0);
  const bytes = result.opaque.byteLength + result.transparent.byteLength;
  const medianMs = median(durations);
  totalMedianMs += medianMs;
  totalQuads += opaqueQuads + transparentQuads;
  totalBytes += bytes;
  totalPlantInstances += plantInstances;
  rows.push(
    `${chunk.coordinate.join(",").padEnd(10)} ${medianMs.toFixed(3).padStart(8)} ms  ` +
      `opaque ${String(opaqueQuads).padStart(5)} q  transparent ${String(transparentQuads).padStart(5)} q  ` +
      `${String(bytes).padStart(7)} B  plants ${plantInstances}`,
  );
}

console.log(rows.join("\n"));
console.log(
  `\n${chunks.length} chunks | mean ${(totalMedianMs / chunks.length).toFixed(3)} ms/chunk | ` +
    `total ${totalMedianMs.toFixed(1)} ms | ${totalQuads} quads (${(totalQuads / chunks.length).toFixed(0)}/chunk) | ` +
    `${totalBytes} vertex bytes | ${totalPlantInstances} plant instances`,
);
