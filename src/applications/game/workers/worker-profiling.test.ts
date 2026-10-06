import { describe, expect, test } from "bun:test";
import { BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { DIMENSIONS } from "../profiler/dimensions";
import {
  beginWorkerTask,
  finishWorkerTask,
  type WorkerTaskProfile,
} from "../profiler/worker-recorder";
import { VERTICES_PER_QUAD } from "../vertex-format";
import { calculateOffset } from "../utils";
import { createSurfaceHeightSampler, generateChunk } from "./generation";
import { initializeChunkLight, propagateChunkLight } from "./lighting";
import { createSurroundingsSource, lightChunkRegion, listRegionTransferables } from "./region-lighting";
import { generateMesh, listTransferables } from "./mesh";
import { buildPlantTemplate } from "./plant-voxels";
import {
  SLAB_AXIS_X,
  SURROUNDING_SLAB_DEPTH,
  extractSurroundingSlab,
  lightRegionFromSlabs,
  slabCellCount,
} from "./region-surroundings";

const BLOCKS = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;
const WORLD_SEED = 20240607;
const FULL_LIGHT = 0xff;
const SEA_LEVEL_CHUNK_Y = 3;

function recordTask<Result>(run: () => Result): { result: Result; profile: WorkerTaskProfile } {
  beginWorkerTask(true);
  const result = run();
  const profile = finishWorkerTask();
  if (!profile) throw new Error("profile expected");
  return { result, profile };
}

function nodePaths(profile: WorkerTaskProfile): string[] {
  return profile.callTree.map((node) => node.path);
}

function rootPaths(profile: WorkerTaskProfile): string[] {
  return nodePaths(profile).filter((path) => !path.includes(">"));
}

function callsAt(profile: WorkerTaskProfile, path: string): number {
  return profile.callTree.find((node) => node.path === path)?.calls ?? 0;
}

function unitsOf(profile: WorkerTaskProfile, dimension: string): { [key: string]: number } {
  const units: { [key: string]: number } = {};
  for (const entry of profile.breakdowns[dimension] ?? []) units[entry.key] = entry.units;
  return units;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// Terrain with a stone floor and dirt/grass layers, a water pool, glass, plants, stairs,
// slabs and a glowstone lamp, plus blocks on every chunk edge.
function mixedChunk(): Uint8Array {
  const chunk = new Uint8Array(BLOCKS);
  const place = (x: number, y: number, z: number, block: BlockType) => {
    chunk[calculateOffset(x, y, z)] = block;
  };
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let z = 0; z < CHUNK_LENGTH; z++) {
      place(x, 0, z, BlockType.STONE);
      place(x, 1, z, BlockType.STONE);
      place(x, 2, z, BlockType.DIRT);
      place(x, 3, z, (x + z) % 7 === 0 ? BlockType.COBBLESTONE : BlockType.GRASS);
    }
  }
  for (let x = 8; x < 14; x++) {
    for (let z = 8; z < 14; z++) {
      place(x, 3, z, BlockType.WATER);
      place(x, 2, z, BlockType.DIRT);
    }
  }
  for (let z = 2; z < 6; z++) {
    place(20, 4, z, BlockType.GLASS);
    place(21, 4, z, BlockType.PLANKS_STAIRS_NORTH);
    place(22, 4, z, BlockType.STONE_SLAB);
    place(23, 4, z, BlockType.TALL_GRASS);
  }
  place(25, 4, 25, BlockType.GLOWSTONE);
  place(0, 4, 0, BlockType.COBBLESTONE_STAIRS_EAST);
  place(31, 4, 31, BlockType.STONE);
  return chunk;
}

function lightFor(chunk: Uint8Array) {
  const sky = new Uint8Array(BLOCKS).fill(0xf0);
  const air = new Uint8Array(BLOCKS);
  return initializeChunkLight(chunk, WORLD_SEED, 0, 10, 0, air, sky);
}

function bufferEquals(first: ArrayBuffer, second: ArrayBuffer): boolean {
  return Buffer.compare(Buffer.from(first), Buffer.from(second)) === 0;
}

describe("generateMesh profiling", () => {
  const chunk = mixedChunk();
  const light = lightFor(chunk).light;
  const meshInputs = () => [chunk.slice().buffer, light.slice().buffer] as const;

  test("records the expected nested call tree with balanced sections", () => {
    const { profile } = recordTask(() => generateMesh(...meshInputs()));
    const paths = nodePaths(profile);

    expect(rootPaths(profile).sort()).toEqual(["faceGeneration", "packResult", "unpackInputs"]);
    for (const expectedPath of [
      "unpackInputs>emptyScan",
      "unpackInputs>fillPaddedBlocks",
      "unpackInputs>fillPaddedLight",
      "unpackInputs>buildRowOccupancy",
      "faceGeneration>greedyMerge",
      "packResult>opaqueBuffer",
      "packResult>transparentBuffer",
      "packResult>plantInstanceBuffers",
    ]) {
      expect(paths).toContain(expectedPath);
    }
    for (const path of paths) {
      const segments = path.split(">");
      expect(new Set(segments).size).toBe(segments.length);
      if (segments.length > 1) expect(paths).toContain(segments.slice(0, -1).join(">"));
    }
    for (const node of profile.callTree) {
      expect(node.selfMs).toBeGreaterThanOrEqual(0);
      expect(node.totalMs).toBeGreaterThanOrEqual(node.selfMs);
    }
  });

  test("work counters add up", () => {
    const { result, profile } = recordTask(() => generateMesh(...meshInputs()));
    const { counters } = profile;
    const emittedQuads =
      (new Uint32Array(result.opaque).length + new Uint32Array(result.transparent).length) /
      (VERTICES_PER_QUAD * 2);

    expect(callsAt(profile, "faceGeneration>greedyMerge")).toBe(1);
    expect(counters.quadsEmitted).toBe(emittedQuads);
    expect(counters.quadsEmitted).toBeLessThan(counters.facesEmitted);
    expect(counters.mergedQuads).toBeGreaterThan(0);
    expect(counters.mergedQuads).toBeLessThan(counters.mergeableFaces);
    expect(counters.stairBlocksVisited).toBe(5);
    expect(counters.plantInstancesEmitted).toBe(4);
    expect(counters.solidBlocksVisited).toBeGreaterThanOrEqual(
      counters.plantInstancesEmitted + counters.stairBlocksVisited,
    );
    expect(counters.translucentBlocksVisited).toBeGreaterThan(0);
  });

  test("faces per block type sum to the faces emitted counter, and merging leaves fewer quads", () => {
    const { result, profile } = recordTask(() => generateMesh(...meshInputs()));
    const facesByBlock = unitsOf(profile, DIMENSIONS.meshBlockFaces);
    const totalFaces = sum(Object.values(facesByBlock));
    const emittedQuads =
      (new Uint32Array(result.opaque).length + new Uint32Array(result.transparent).length) /
      (VERTICES_PER_QUAD * 2);

    expect(totalFaces).toBeGreaterThan(1000);
    expect(totalFaces).toBe(profile.counters.facesEmitted);
    expect(emittedQuads).toBeLessThan(totalFaces);
    for (const blockName of ["STONE", "GRASS", "DIRT", "WATER", "GLASS", "PLANKS_STAIRS_NORTH", "STONE_SLAB"]) {
      expect(facesByBlock[blockName]).toBeGreaterThan(0);
    }
    expect(facesByBlock.TALL_GRASS).toBeUndefined();

    const partUnits = unitsOf(profile, DIMENSIONS.meshPart);
    expect(partUnits.opaque + partUnits.transparent + partUnits.stairs).toBe(emittedQuads);
    expect(partUnits.plants).toBe(profile.counters.plantInstancesEmitted);
  });

  test("a lone stone block emits exactly six stone faces and glass emits its own", () => {
    const loneBlocks = new Uint8Array(BLOCKS);
    loneBlocks[calculateOffset(5, 5, 5)] = BlockType.STONE;
    loneBlocks[calculateOffset(15, 15, 15)] = BlockType.GLASS;
    const lit = new Uint8Array(BLOCKS).fill(FULL_LIGHT);
    const { profile } = recordTask(() => generateMesh(loneBlocks.buffer, lit.buffer));
    const facesByBlock = unitsOf(profile, DIMENSIONS.meshBlockFaces);

    expect(facesByBlock).toEqual({ STONE: 6, GLASS: 6 });
  });

  test("byte and vertex counters describe the returned buffers", () => {
    const { result, profile } = recordTask(() => {
      const mesh = generateMesh(...meshInputs());
      listTransferables(mesh);
      return mesh;
    });
    const { counters } = profile;

    expect(counters.opaqueBytes).toBe(result.opaque.byteLength);
    expect(counters.transparentBytes).toBe(result.transparent.byteLength);
    expect(counters.plantBytes).toBe(sum(result.plants.map((batch) => batch.instances.byteLength)));
    expect(counters.opaqueVertices * 8).toBe(result.opaque.byteLength);
    expect(counters.impliedIndices).toBe(
      ((counters.opaqueVertices + counters.transparentVertices) / VERTICES_PER_QUAD) * 6,
    );
    expect(counters.transferableBuffers).toBe(2 + result.plants.length);
    expect(nodePaths(profile)).toContain("listTransferables");
  });

  test("merge counters account for every recorded face and every merged quad", () => {
    const { profile } = recordTask(() => generateMesh(...meshInputs()));
    const { counters } = profile;
    const recordedByDirection = ["up", "down", "front", "back", "left", "right"].map(
      (direction) => counters[`mergeableFaces.${direction}`] ?? 0,
    );
    const mergedQuadsByDirection = unitsOf(profile, DIMENSIONS.meshFaceDirection);

    expect(sum(recordedByDirection)).toBe(counters.mergeableFaces);
    expect(counters.mergeFacesConsumed).toBe(counters.mergeableFaces);
    expect(sum(Object.values(mergedQuadsByDirection))).toBe(counters.mergedQuads);
    expect(counters.mergedQuads).toBeLessThan(counters.mergeFacesConsumed);
    expect(counters.mergeCellsAbsorbed + counters.mergeRowsAbsorbed).toBeGreaterThan(0);
    expect(callsAt(profile, "faceGeneration>greedyMerge>mergeDirection")).toBe(
      Object.keys(mergedQuadsByDirection).length,
    );
    expect(counters.directFacesEmitted + counters.mergeableFaces).toBe(
      counters.opaqueBulkFaces + counters.generalPathFaces,
    );
  });

  test("vertex attribute bytes and packed quads match the returned buffers", () => {
    const { result, profile } = recordTask(() => generateMesh(...meshInputs()));
    const { counters } = profile;
    const vertexCount = (result.opaque.byteLength + result.transparent.byteLength) / 8;
    const attributeBytes = unitsOf(profile, DIMENSIONS.meshVertexAttribute);

    expect(attributeBytes.position).toBe(vertexCount * 4);
    expect(attributeBytes.surface).toBe(vertexCount * 4);
    expect(counters.quadsPacked + counters.stairQuadsEmitted).toBe(counters.quadsEmitted);
    expect(counters.aoEdgeCellSamples + counters.aoInteriorSamples).toBeGreaterThanOrEqual(
      counters.facesEmitted - counters.stairQuadsEmitted,
    );
    expect(counters.aoUniformFastPathSamples).toBeLessThanOrEqual(counters.aoInteriorSamples);
  });

  test("profiling does not change the mesh bytes", () => {
    const unprofiled = generateMesh(...meshInputs());
    const { result: profiled } = recordTask(() => generateMesh(...meshInputs()));

    expect(bufferEquals(profiled.opaque, unprofiled.opaque)).toBe(true);
    expect(bufferEquals(profiled.transparent, unprofiled.transparent)).toBe(true);
    expect(profiled.plants.length).toBe(unprofiled.plants.length);
    expect(finishWorkerTask()).toBeNull();
  });

  test("a generated terrain chunk with border slabs closes every section", () => {
    const terrainY = Math.floor(createSurfaceHeightSampler(WORLD_SEED)(16, 16) / CHUNK_HEIGHT);
    const terrain = new Uint8Array(generateChunk(WORLD_SEED, 0, terrainY, 0));
    const terrainLight = initializeChunkLight(terrain, WORLD_SEED, 0, terrainY, 0).light;
    const sideSlab = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH).fill(BlockType.STONE);
    const sideLight = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH).fill(0x88);
    const { profile } = recordTask(() =>
      generateMesh(
        terrain.slice().buffer,
        terrainLight.slice().buffer,
        { left: sideSlab.buffer },
        { left: sideLight.buffer },
        WORLD_SEED,
        0,
        terrainY,
        0,
      ),
    );

    expect(rootPaths(profile).sort()).toEqual(["faceGeneration", "packResult", "unpackInputs"]);
    expect(profile.counters.borderSlabsCopied).toBe(2);
    expect(profile.counters.facesEmitted).toBeGreaterThan(500);
    expect(profile.counters.facesEmitted).toBe(sum(Object.values(unitsOf(profile, DIMENSIONS.meshBlockFaces))));
  });

  test("an empty chunk closes its sections and reports the skip", () => {
    const air = new Uint8Array(BLOCKS);
    const { profile } = recordTask(() => generateMesh(air.buffer, air.slice().buffer));

    expect(rootPaths(profile)).toEqual(["unpackInputs"]);
    expect(profile.counters.emptyChunksSkipped).toBe(1);
  });
});

describe("lighting profiling", () => {
  test("initializeChunkLight records stages, light sources and emitters", () => {
    const chunk = mixedChunk();
    const { profile } = recordTask(() =>
      initializeChunkLight(chunk, WORLD_SEED, 0, 10, 0, new Uint8Array(BLOCKS)),
    );

    expect(rootPaths(profile).sort()).toEqual([
      "allocateLightMap",
      "blockLightScan",
      "frontierQueue",
      "queueToTypedArray",
      "sunlightColumns",
    ]);
    expect(profile.counters.columnsExposed).toBe(CHUNK_WIDTH * CHUNK_LENGTH);
    expect(profile.counters.lightSourcesFound).toBe(1);
    expect(unitsOf(profile, DIMENSIONS.lightKind)["emitter.GLOWSTONE"]).toBe(1);
    expect(profile.counters.queueBytes).toBe(profile.counters.queueLength * 4);
    expect(profile.counters.frontierCellsQueued + profile.counters.lightSourcesFound).toBe(
      profile.counters.queueLength,
    );
  });

  test("initializeChunkLight without chunks above reads the chunk alone and never samples terrain", () => {
    const chunk = mixedChunk();
    const { profile } = recordTask(() => initializeChunkLight(chunk, WORLD_SEED, 0, SEA_LEVEL_CHUNK_Y, 0));

    expect(nodePaths(profile).some((path) => path.includes("createSurfaceHeightSampler"))).toBe(false);
    expect(profile.counters.columnsExposed).toBe(CHUNK_WIDTH * CHUNK_LENGTH);
    expect(profile.counters.skyLitCells).toBeGreaterThan(CHUNK_WIDTH * CHUNK_LENGTH);
  });

  test("a chunk of one solid block is lit without scanning it", () => {
    const stone = new Uint8Array(BLOCKS).fill(BlockType.STONE);
    const { result, profile } = recordTask(() => initializeChunkLight(stone, WORLD_SEED, 0, 0, 0));

    expect(profile.counters.uniformChunksSkipped).toBe(1);
    expect(result.isFullySunlit).toBe(true);
    expect(result.queue.length).toBe(0);
    expect(callsAt(profile, "sunlightColumns")).toBe(0);
  });

  test("propagateChunkLight records the flood, border exchange and neighbor updates", () => {
    const chunk = new Uint8Array(BLOCKS);
    chunk[calculateOffset(CHUNK_WIDTH - 1, 5, 5)] = BlockType.GLOWSTONE;
    chunk[calculateOffset(0, 5, 5)] = BlockType.GLOWSTONE;
    const initialized = initializeChunkLight(chunk, WORLD_SEED, 0, 10, 0, new Uint8Array(BLOCKS), new Uint8Array(BLOCKS));
    const neighborChunk = new Uint8Array(BLOCKS);
    const neighborLight = new Uint8Array(BLOCKS);
    const { result, profile } = recordTask(() =>
      propagateChunkLight(
        chunk,
        initialized.light,
        { "1,0,0": neighborChunk, "-1,0,0": neighborChunk },
        { "1,0,0": neighborLight, "-1,0,0": neighborLight },
        initialized.queue,
      ),
    );

    expect(rootPaths(profile).sort()).toEqual([
      "bfsFlood",
      "bindNeighborSlots",
      "buildNeighborUpdates",
      "seedFromNeighborBorders",
      "seedFromQueue",
    ]);
    expect(callsAt(profile, "seedFromNeighborBorders>seedFromFace")).toBe(2);
    expect(Object.keys(result.neighborLightUpdates).sort()).toEqual(["-1,0,0", "1,0,0"]);
    expect(profile.counters.neighborBordersUpdated).toBe(2);
    expect(profile.counters.neighborLightBytesReturned).toBe(2 * BLOCKS);
    expect(profile.counters.neighborChunksLoaded).toBe(2);
    expect(profile.counters.lightValuesChanged).toBeGreaterThan(100);
    expect(profile.counters.bfsDeadNodesSkipped).toBeLessThanOrEqual(profile.counters.bfsNodesVisited);
    expect(unitsOf(profile, DIMENSIONS.lightKind).flood).toBe(profile.counters.bfsNodesVisited);
  });

  test("border seeding counters split by direction and by light channel", () => {
    const chunk = new Uint8Array(BLOCKS);
    const neighborLight = new Uint8Array(BLOCKS);
    const neighborChunk = new Uint8Array(BLOCKS);
    neighborLight.fill(0xf0);
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) neighborLight[calculateOffset(0, y, z)] = 0x0c;
    }
    chunk[calculateOffset(CHUNK_WIDTH - 1, 5, 5)] = BlockType.STONE;
    const initialized = initializeChunkLight(chunk, WORLD_SEED, 0, SEA_LEVEL_CHUNK_Y, 0);
    const { profile } = recordTask(() =>
      propagateChunkLight(
        chunk,
        initialized.light,
        { "1,0,0": neighborChunk, "0,1,0": neighborChunk },
        { "1,0,0": neighborLight, "0,1,0": neighborLight },
        initialized.queue,
      ),
    );
    const { counters } = profile;
    const directionNames = ["positiveX", "negativeX", "positiveY", "negativeY", "positiveZ", "negativeZ"];
    const examinedByDirection = directionNames.map((name) => counters[`borderCellsExamined.${name}`] ?? 0);
    const seededByDirection = directionNames.map((name) => counters[`borderCellsSeeded.${name}`] ?? 0);

    expect(sum(examinedByDirection)).toBe(counters.borderCellsExamined);
    expect(sum(seededByDirection)).toBe(counters.borderCellsSeeded);
    expect(examinedByDirection[0]).toBe(CHUNK_HEIGHT * CHUNK_LENGTH - 1);
    expect(counters.borderCellsOpaque).toBe(1);
    expect(seededByDirection[0]).toBeGreaterThan(0);
    expect(unitsOf(profile, DIMENSIONS.lightChannel).block).toBeGreaterThan(0);
  });

  test("propagateChunkLight on a mixed chunk gives the same light with and without profiling", () => {
    const chunk = mixedChunk();
    const first = lightFor(chunk);
    const second = lightFor(chunk);
    const plain = propagateChunkLight(chunk, first.light, {}, {}, first.queue);
    const { result: profiled, profile } = recordTask(() =>
      propagateChunkLight(chunk, second.light, {}, {}, second.queue),
    );

    expect(bufferEquals(profiled.centerLight.buffer as ArrayBuffer, plain.centerLight.buffer as ArrayBuffer)).toBe(true);
    expect(rootPaths(profile)).toContain("bfsFlood");
    expect(profile.counters.bfsNodesVisited).toBeGreaterThan(0);
  });
});

describe("region lighting profiling", () => {
  test("neighbor lookups, routed updates and merges add up for a region with a lit surrounding", () => {
    const glowAtBothSides = new Uint8Array(BLOCKS);
    glowAtBothSides[calculateOffset(CHUNK_WIDTH - 1, 5, 8)] = BlockType.GLOWSTONE;
    glowAtBothSides[calculateOffset(0, 5, 8)] = BlockType.GLOWSTONE;
    const upperChunk = new Uint8Array(BLOCKS);
    const eastChunk = new Uint8Array(BLOCKS);
    const westBlocks = new Uint8Array(BLOCKS);
    const westLight = initializeChunkLight(westBlocks, WORLD_SEED, -1, SEA_LEVEL_CHUNK_Y, 0).light;
    const surroundings = createSurroundingsSource([
      { chunkX: -1, chunkY: SEA_LEVEL_CHUNK_Y, chunkZ: 0, blocks: westBlocks, light: westLight },
    ]);
    const { result, profile } = recordTask(() => {
      const lit = lightChunkRegion(
        [
          { chunkX: 0, chunkY: SEA_LEVEL_CHUNK_Y, chunkZ: 0, blocks: glowAtBothSides },
          { chunkX: 0, chunkY: SEA_LEVEL_CHUNK_Y + 1, chunkZ: 0, blocks: upperChunk },
          { chunkX: 1, chunkY: SEA_LEVEL_CHUNK_Y, chunkZ: 0, blocks: eastChunk },
        ],
        surroundings,
      );
      listRegionTransferables(lit);
      return lit;
    });
    const { counters } = profile;

    expect(counters.regionNeighborsInRegion).toBe(4);
    expect(counters.regionNeighborsInSurroundings).toBe(1);
    expect(counters.regionNeighborsInRegion + counters.regionNeighborsInSurroundings + counters.regionNeighborsMissing).toBe(18);
    expect(counters.regionColumnsAboveInRegion).toBe(1);
    expect(counters.regionColumnsNothingAbove).toBe(2);
    expect(counters.regionUpdatesRoutedToRegion).toBeGreaterThan(0);
    expect(counters.regionUpdatesRoutedToSurroundings).toBeGreaterThan(0);
    expect(counters.regionLightUpdatesMerged).toBe(
      counters.regionUpdatesRoutedToRegion + counters.regionUpdatesRoutedToSurroundings - result.surroundingUpdates.length,
    );
    expect(counters.regionResultChunkBytes + counters.regionResultSurroundingBytes).toBe(
      (result.chunkLights.length + result.surroundingUpdates.length) * BLOCKS,
    );
    expect(callsAt(profile, "propagateRegionChunks>gatherNeighbors")).toBe(3);
    expect(callsAt(profile, "mergeRegionUpdates>mergeRegionChunks")).toBe(1);
  });
});

describe("region slab input profiling", () => {
  test("slab counters tell uniform parts from copied ones and add up to the bytes received", () => {
    const litNeighborBlocks = mixedChunk();
    const litNeighborLight = lightFor(litNeighborBlocks).light;
    const partialExtent = { axis: SLAB_AXIS_X, firstLayer: 0, layerCount: SURROUNDING_SLAB_DEPTH };
    const partialSlab = extractSurroundingSlab(-1, SEA_LEVEL_CHUNK_Y, 0, litNeighborBlocks, litNeighborLight, -1, partialExtent);
    const uniformStoneBlocks = new Uint8Array(BLOCKS).fill(BlockType.STONE);
    const uniformSlab = extractSurroundingSlab(
      0,
      SEA_LEVEL_CHUNK_Y - 1,
      0,
      uniformStoneBlocks,
      new Uint8Array(BLOCKS),
      BlockType.STONE,
      { axis: SLAB_AXIS_X, firstLayer: 0, layerCount: CHUNK_WIDTH },
    );
    const { profile } = recordTask(() =>
      lightRegionFromSlabs(
        [
          { chunkX: 0, chunkY: SEA_LEVEL_CHUNK_Y, chunkZ: 0, blocks: mixedChunk(), uniformBlock: -1 },
          { chunkX: 0, chunkY: SEA_LEVEL_CHUNK_Y + 1, chunkZ: 0, blocks: null, uniformBlock: BlockType.AIR },
        ],
        [partialSlab, uniformSlab],
      ),
    );
    const { counters } = profile;

    expect(partialSlab.blocks).not.toBeNull();
    expect(counters.regionInputChunks).toBe(2);
    expect(counters.regionInputUniformChunks).toBe(1);
    expect(counters.regionInputFilledBytes).toBe(BLOCKS);
    expect(counters.slabsReceived).toBe(2);
    expect(counters.slabsWholeChunk).toBe(1);
    expect(counters.slabsPartial).toBe(1);
    expect(counters.slabsUniformBlocks).toBe(1);
    expect(counters.slabBlockBytesReceived).toBe(slabCellCount(partialExtent));
    expect(counters.slabCellsUnpacked).toBe(slabCellCount(partialExtent) + BLOCKS);
    expect(callsAt(profile, "rebuildSurroundings>unpackSlabBlocks")).toBe(2);
    expect(rootPaths(profile)).toContain("propagateRegionChunks");
  });
});

describe("plant template profiling", () => {
  test("voxel plant templates record their build steps and close on the no-mask path", () => {
    const { result: template, profile } = recordTask(() => {
      buildPlantTemplate(BlockType.STONE);
      return buildPlantTemplate(BlockType.TALL_GRASS);
    });

    expect(rootPaths(profile)).toEqual(["buildPlantTemplate"]);
    expect(callsAt(profile, "buildPlantTemplate")).toBe(2);
    expect(callsAt(profile, "buildPlantTemplate>buildVoxelCells")).toBe(1);
    expect(callsAt(profile, "buildPlantTemplate>emitVoxelFaces")).toBe(1);
    expect(profile.counters.plantTemplateQuads).toBe(template.quadCount);
    expect(profile.counters.plantTemplateQuads).toBeGreaterThan(50);
    expect(profile.counters.plantVoxelCells).toBeGreaterThan(20);
    expect(profile.counters.plantTemplateHiddenFaces + profile.counters.plantTemplateQuads).toBe(
      profile.counters.plantTemplateFacesTested,
    );
    expect(profile.counters.plantTemplateFacesTested).toBe(profile.counters.plantVoxelCells * 6);
    expect(profile.breakdowns[DIMENSIONS.meshPart].map((entry) => entry.key)).toContain(
      "plantTemplate.TALL_GRASS",
    );
  });
});
