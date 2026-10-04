// Headless LOD benchmark (Bun):
//   bun src/applications/game/lod/benchmark/lod-benchmark.ts [--seed 1337] [--radius-chunks 256] [--workers 3] [--skip-accuracy]
// 1. Cost of one tile per level (worldgen sampling, meshing, vertices, bytes), in-process and warmed up.
// 2. Time to first horizon and to full detail for the radius, with real Bun workers running the LOD worker entry.
// 3. Memory: cache bytes per tile and in total once the radius is fully detailed.
// 4. Accuracy against the real generator (base terrain with aquifers, surface rules and carvers; no trees): height
//    error at the cell's sample point and at a random block inside the cell, and top block agreement, per level.

import * as THREE from "three";
import { BlockType } from "../../blocks";
import { toGameBlockOrAir } from "../../worldgen/engine/blocks/lenient-block-map";
import { GAME_Y_OFFSET } from "../../worldgen/constants";
import { getFullWorld } from "../../worldgen/overworld-world";
import { cellSizeOfLevel, TILE_CELLS, tileSizeOfLevel } from "../core/lod-constants";
import { unpackTileSurface } from "../data/packed-tile-surface";
import { cellIndexOf } from "../data/tile-surface";
import { createLodManager } from "../manager/lod-manager";
import { buildLodTile } from "../worker/lod-tile-builder";

interface BenchmarkArguments {
  seed: number;
  radiusChunks: number;
  workers: number;
  skipAccuracy: boolean;
}

function parseArguments(): BenchmarkArguments {
  const argumentList = process.argv.slice(2);
  const valueOf = (flag: string, fallback: number) => {
    const index = argumentList.indexOf(flag);
    return index === -1 ? fallback : Number(argumentList[index + 1]);
  };
  return {
    seed: valueOf("--seed", 1337),
    radiusChunks: valueOf("--radius-chunks", 256),
    workers: valueOf("--workers", 3),
    skipAccuracy: argumentList.includes("--skip-accuracy"),
  };
}

function createRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

const formatMilliseconds = (value: number) => value.toFixed(1);
const formatKilobytes = (bytes: number) => (bytes / 1024).toFixed(1);

function benchmarkTilesPerLevel(seed: number) {
  const random = createRandom(seed);
  buildLodTile({ seed, address: { level: 4, tileX: 50, tileZ: 50 } });
  console.log("\n## Tile cost per level (in-process, warmed up, cold tiles without hints)\n");
  console.log("| level | cell (blocks) | tiles | sample ms | mesh+pack ms | vertices | geometry KB | packed surface KB |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (let level = 0; level <= 8; level++) {
    const tileCount = 6;
    let sampleMilliseconds = 0;
    let meshMilliseconds = 0;
    let vertices = 0;
    let geometryBytes = 0;
    let packedBytes = 0;
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
      const spread = Math.max(1, Math.floor(20000 / tileSizeOfLevel(level)));
      const address = { level, tileX: Math.floor((random() - 0.5) * spread), tileZ: Math.floor((random() - 0.5) * spread) };
      const result = buildLodTile({ seed, address });
      sampleMilliseconds += result.sampleMilliseconds;
      meshMilliseconds += result.meshMilliseconds;
      vertices += result.vertices.length / 2;
      geometryBytes += result.vertices.byteLength + result.indices.byteLength;
      packedBytes += result.packedSurface.byteLength;
    }
    console.log(
      `| ${level} | ${cellSizeOfLevel(level)} | ${tileCount} | ${formatMilliseconds(sampleMilliseconds / tileCount)} | ${formatMilliseconds(meshMilliseconds / tileCount)} | ${Math.round(vertices / tileCount)} | ${formatKilobytes(geometryBytes / tileCount)} | ${formatKilobytes(packedBytes / tileCount)} |`,
    );
  }
}

async function benchmarkHorizon(parsed: BenchmarkArguments) {
  const manager = createLodManager({
    seed: parsed.seed,
    workerFactory: () => new Worker(new URL("../worker/lod-worker.ts", import.meta.url).href),
    workerCount: parsed.workers,
    renderDistanceChunks: parsed.radiusChunks,
    fadeMilliseconds: 0,
  });
  const camera = new THREE.PerspectiveCamera(85, 16 / 9, 0.1, 10000);
  camera.position.set(8, 130, 8);
  camera.lookAt(8, 110, -1000);
  const startedAt = performance.now();
  const timeoutMilliseconds = 10 * 60 * 1000;
  while (performance.now() - startedAt < timeoutMilliseconds) {
    manager.update(camera, 1080);
    const stats = manager.getStats();
    if (stats.fullDetailMilliseconds !== undefined && stats.buildsInFlight === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  const stats = manager.getStats();
  console.log(`\n## Loading a ${parsed.radiusChunks}-chunk radius (${parsed.radiusChunks * 32} blocks) with ${parsed.workers} Bun workers\n`);
  console.log(`- first horizon (whole radius drawn, coarse): ${formatMilliseconds(stats.firstHorizonMilliseconds ?? Number.NaN)} ms (includes worker start-up)`);
  console.log(`- full detail (every selected tile at its level): ${formatMilliseconds(stats.fullDetailMilliseconds ?? Number.NaN)} ms`);
  console.log(`- tiles: ${stats.selectedTiles} selected, ${stats.drawnTiles} drawn, ${stats.builtTiles} built, ${stats.cachedTiles} cached`);
  console.log(`- cache: ${(stats.cacheBytes / 1024 / 1024).toFixed(1)} MB (${formatKilobytes(stats.cacheBytes / Math.max(1, stats.cachedTiles))} KB per tile), budget ${(stats.cacheBudgetBytes / 1024 / 1024).toFixed(0)} MB`);
  console.log(`- near plane ${stats.nearPlane.toFixed(2)}, far plane ${stats.farPlane.toFixed(0)}`);
  console.log("\n| level | tiles built | mean sample ms | mean mesh ms | mean vertices | mean geometry KB |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const [level, levelStats] of Object.entries(stats.buildsByLevel)) {
    console.log(
      `| ${level} | ${levelStats.tiles} | ${formatMilliseconds(levelStats.totalSampleMilliseconds / levelStats.tiles)} | ${formatMilliseconds(levelStats.totalMeshMilliseconds / levelStats.tiles)} | ${Math.round(levelStats.totalVertices / levelStats.tiles)} | ${formatKilobytes(levelStats.totalGeometryBytes / levelStats.tiles)} |`,
    );
  }
  manager.dispose();
}

function benchmarkAccuracy(seed: number) {
  const world = getFullWorld(seed);
  const random = createRandom(seed + 7);
  const realSurfaceAt = (blockX: number, blockZ: number) => {
    const topFace = world.generator.surfaceHeight(blockX, blockZ, "OCEAN_FLOOR_WG");
    const column = world.generator.generateBaseColumn(blockX >> 4, blockZ >> 4);
    const block = toGameBlockOrAir(column.palette.stateOf(column.getId(blockX & 15, topFace - 1, blockZ & 15))).gameBlock;
    return { height: topFace + GAME_Y_OFFSET, block };
  };
  console.log("\n## Accuracy against the real generator (base terrain: aquifers, surface rules, carvers; no trees)\n");
  console.log("Snow and sea ice come from the freeze_top_layer feature, which the base terrain lacks, so cells the LOD covers with them are counted apart.\n");
  console.log("| level | cells | height error at sample point (mean / p90 / max) | error vs a random block in the cell (mean / p90) | same top block | snow or ice cells |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  const percentile = (values: number[], fraction: number) => [...values].sort((first, second) => first - second)[Math.floor((values.length - 1) * fraction)]!;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  for (let level = 0; level <= 8; level++) {
    const sampleErrors: number[] = [];
    const cellErrors: number[] = [];
    let sameBlock = 0;
    let compared = 0;
    let coverCells = 0;
    for (let tileIndex = 0; tileIndex < 3; tileIndex++) {
      const spread = Math.max(1, Math.floor(16000 / tileSizeOfLevel(level)));
      const address = { level, tileX: Math.floor((random() - 0.5) * spread), tileZ: Math.floor((random() - 0.5) * spread) };
      const surface = unpackTileSurface(buildLodTile({ seed, address }).packedSurface);
      const cellSize = cellSizeOfLevel(level);
      for (let sample = 0; sample < 12; sample++) {
        const cellX = Math.floor(random() * TILE_CELLS);
        const cellZ = Math.floor(random() * TILE_CELLS);
        const index = cellIndexOf(cellX, cellZ);
        const originX = address.tileX * tileSizeOfLevel(level) + cellX * cellSize;
        const originZ = address.tileZ * tileSizeOfLevel(level) + cellZ * cellSize;
        const offset = Math.floor(cellSize / 2);
        const atSamplePoint = realSurfaceAt(originX + offset, originZ + offset);
        const atRandomBlock = realSurfaceAt(originX + Math.floor(random() * cellSize), originZ + Math.floor(random() * cellSize));
        const lodHeight = surface.heights[index]!;
        const lodBlock = surface.topBlocks[index]! as BlockType;
        const isSeaIce = lodBlock === BlockType.ICE;
        if (!isSeaIce) sampleErrors.push(Math.abs(lodHeight - atSamplePoint.height));
        if (!isSeaIce) cellErrors.push(Math.abs(lodHeight - atRandomBlock.height));
        if (lodBlock === BlockType.SNOW_LAYER || isSeaIce) {
          coverCells++;
          continue;
        }
        if (atSamplePoint.block === lodBlock) sameBlock++;
        compared++;
      }
    }
    console.log(
      `| ${level} | ${compared + coverCells} | ${mean(sampleErrors).toFixed(2)} / ${percentile(sampleErrors, 0.9)} / ${Math.max(...sampleErrors)} | ${mean(cellErrors).toFixed(2)} / ${percentile(cellErrors, 0.9)} | ${compared === 0 ? "n/a" : `${((sameBlock / compared) * 100).toFixed(0)}%`} | ${coverCells} |`,
    );
  }
}

const parsed = parseArguments();
console.log(`# LOD benchmark (seed ${parsed.seed})`);
benchmarkTilesPerLevel(parsed.seed);
await benchmarkHorizon(parsed);
if (!parsed.skipAccuracy) benchmarkAccuracy(parsed.seed);
process.exit(0);
