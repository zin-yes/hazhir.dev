import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { BiomeManager, obfuscateSeed } from "./biome-manager";
import { getFiddledDistance, linearCongruentialNextBigInt } from "./linear-congruential-generator";
import { createSeededRandom } from "./terralith-biome-source.node";

const suiteStart = performance.now();
const LONG_MIN = BigInt("-9223372036854775808");
const LONG_MAX = BigInt("9223372036854775807");

function nodeObfuscateSeed(seed: bigint): bigint {
  const seedBytes = Buffer.alloc(8);
  seedBytes.writeBigInt64LE(BigInt.asIntN(64, seed));
  return createHash("sha256").update(seedBytes).digest().readBigInt64LE(0);
}

// Straight BigInt transcription of BiomeManager.getFiddledDistance / getBiome, used as the oracle for the int32-halves code.
function bigIntFiddle(value: bigint): number {
  const floorModulo = ((value >> BigInt(24)) % BigInt(1024) + BigInt(1024)) % BigInt(1024);
  return (Number(floorModulo) / 1024 - 0.5) * 0.9;
}

function bigIntFiddledDistance(seed: bigint, x: number, y: number, z: number, xNoise: number, yNoise: number, zNoise: number): number {
  let state = linearCongruentialNextBigInt(seed, BigInt(x));
  state = linearCongruentialNextBigInt(state, BigInt(y));
  state = linearCongruentialNextBigInt(state, BigInt(z));
  state = linearCongruentialNextBigInt(state, BigInt(x));
  state = linearCongruentialNextBigInt(state, BigInt(y));
  state = linearCongruentialNextBigInt(state, BigInt(z));
  const xFiddle = bigIntFiddle(state);
  state = linearCongruentialNextBigInt(state, seed);
  const yFiddle = bigIntFiddle(state);
  state = linearCongruentialNextBigInt(state, seed);
  const zFiddle = bigIntFiddle(state);
  return (zNoise + zFiddle) ** 2 + (yNoise + yFiddle) ** 2 + (xNoise + xFiddle) ** 2;
}

function bigIntBiomeCell(worldSeed: bigint, blockX: number, blockY: number, blockZ: number): [number, number, number] {
  const zoomSeed = nodeObfuscateSeed(worldSeed);
  const shifted = [blockX - 2, blockY - 2, blockZ - 2];
  const base = shifted.map((value) => value >> 2);
  const fraction = shifted.map((value) => (value & 3) / 4);
  let bestCandidate = 0;
  let bestDistance = Infinity;
  for (let candidate = 0; candidate < 8; candidate++) {
    const stepX = (candidate & 4) !== 0;
    const stepY = (candidate & 2) !== 0;
    const stepZ = (candidate & 1) !== 0;
    const distance = bigIntFiddledDistance(
      zoomSeed,
      base[0] + (stepX ? 1 : 0),
      base[1] + (stepY ? 1 : 0),
      base[2] + (stepZ ? 1 : 0),
      stepX ? fraction[0] - 1 : fraction[0],
      stepY ? fraction[1] - 1 : fraction[1],
      stepZ ? fraction[2] - 1 : fraction[2],
    );
    if (bestDistance > distance) {
      bestDistance = distance;
      bestCandidate = candidate;
    }
  }
  return [base[0] + ((bestCandidate & 4) !== 0 ? 1 : 0), base[1] + ((bestCandidate & 2) !== 0 ? 1 : 0), base[2] + ((bestCandidate & 1) !== 0 ? 1 : 0)];
}

const cellName = (quartX: number, quartY: number, quartZ: number) => `${quartX},${quartY},${quartZ}`;

describe("obfuscateSeed", () => {
  test("matches SHA-256 of the little-endian seed bytes (node:crypto) for edge and real seeds", () => {
    for (const seed of [BigInt(0), BigInt(1), BigInt(1337), BigInt(-1), BigInt(-1337), LONG_MIN, LONG_MAX, BigInt("1234567890123456789")]) {
      expect(obfuscateSeed(seed)).toBe(nodeObfuscateSeed(seed));
    }
  });
});

describe("fiddled distance (int32-halves arithmetic)", () => {
  test("equals the BigInt transcription on random seeds and signed cell coordinates", () => {
    const random = createSeededRandom(5);
    for (let sampleIndex = 0; sampleIndex < 3000; sampleIndex++) {
      const seed = BigInt.asIntN(64, (BigInt(Math.floor(random() * 4294967296)) << BigInt(32)) | BigInt(Math.floor(random() * 4294967296)));
      const unsignedSeed = BigInt.asUintN(64, seed);
      const cellX = Math.floor((random() - 0.5) * 2 ** 26);
      const cellY = Math.floor((random() - 0.5) * 200);
      const cellZ = Math.floor((random() - 0.5) * 2 ** 26);
      const [xNoise, yNoise, zNoise] = [random() - 1, random(), random() - 0.5];
      const expected = bigIntFiddledDistance(seed, cellX, cellY, cellZ, xNoise, yNoise, zNoise);
      const actual = getFiddledDistance(
        Number(unsignedSeed >> BigInt(32)) | 0,
        Number(unsignedSeed & BigInt(0xffffffff)) | 0,
        cellX,
        cellY,
        cellZ,
        xNoise,
        yNoise,
        zNoise,
      );
      expect(actual).toBe(expected);
    }
  });
});

describe("BiomeManager", () => {
  const worldSeed = BigInt(1337);

  test("returns exactly the cell chosen by the BigInt oracle, including negative coordinates and other seeds", () => {
    const random = createSeededRandom(11);
    for (const seed of [worldSeed, BigInt(-42), LONG_MIN]) {
      const manager = new BiomeManager(cellName, seed);
      for (let sampleIndex = 0; sampleIndex < 1500; sampleIndex++) {
        const blockX = Math.floor((random() - 0.5) * 20000);
        const blockY = Math.floor(random() * 384) - 64;
        const blockZ = Math.floor((random() - 0.5) * 20000);
        expect(manager.getBiome(blockX, blockY, blockZ)).toBe(cellName(...bigIntBiomeCell(seed, blockX, blockY, blockZ)));
      }
    }
  });

  test("is deterministic and only ever picks one of the 8 surrounding quart cells", () => {
    const manager = new BiomeManager(cellName, worldSeed);
    const random = createSeededRandom(3);
    for (let sampleIndex = 0; sampleIndex < 2000; sampleIndex++) {
      const blockX = Math.floor((random() - 0.5) * 4000);
      const blockY = Math.floor(random() * 384) - 64;
      const blockZ = Math.floor((random() - 0.5) * 4000);
      const first = manager.getBiome(blockX, blockY, blockZ);
      expect(manager.getBiome(blockX, blockY, blockZ)).toBe(first);
      const [pickedX, pickedY, pickedZ] = first.split(",").map(Number);
      const baseX = (blockX - 2) >> 2;
      const baseY = (blockY - 2) >> 2;
      const baseZ = (blockZ - 2) >> 2;
      expect([baseX, baseX + 1]).toContain(pickedX);
      expect([baseY, baseY + 1]).toContain(pickedY);
      expect([baseZ, baseZ + 1]).toContain(pickedZ);
    }
  });

  test("zoom is neither identity nor arbitrary: at quart centres the own cell usually, but not always, wins", () => {
    const manager = new BiomeManager(cellName, worldSeed);
    let ownCellWins = 0;
    const sampleCount = 4000;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const quartX = (sampleIndex % 63) - 31;
      const quartY = (Math.floor(sampleIndex / 63) % 20) - 10;
      const quartZ = Math.floor(sampleIndex / 1260) * 7 - 11;
      // Block (4q + 2) has zero fractional offset inside quart cell q, the most favourable case for the own cell.
      if (manager.getBiome(quartX * 4 + 2, quartY * 4 + 2, quartZ * 4 + 2) === cellName(quartX, quartY, quartZ)) ownCellWins++;
    }
    const winRate = ownCellWins / sampleCount;
    console.log(`[biome-source] own quart cell wins at its centre block ${(winRate * 100).toFixed(1)}% of ${sampleCount} samples`);
    expect(winRate).toBeGreaterThan(0.7);
    expect(winRate).toBeLessThan(1);
  });

  test("different world seeds fiddle differently", () => {
    const managerA = new BiomeManager(cellName, worldSeed);
    const managerB = new BiomeManager(cellName, BigInt(1338));
    let differing = 0;
    for (let blockX = 0; blockX < 64; blockX++) for (let blockZ = 0; blockZ < 64; blockZ++) if (managerA.getBiome(blockX, 70, blockZ) !== managerB.getBiome(blockX, 70, blockZ)) differing++;
    expect(differing).toBeGreaterThan(100);
  });

  test("throughput and suite wall clock", () => {
    const manager = new BiomeManager(cellName, worldSeed);
    const lookupCount = 200000;
    const start = performance.now();
    for (let lookupIndex = 0; lookupIndex < lookupCount; lookupIndex++) manager.getBiome(lookupIndex & 1023, 64 + (lookupIndex & 63), (lookupIndex >> 3) & 1023);
    const seconds = (performance.now() - start) / 1000;
    console.log(`[biome-source] BiomeManager.getBiome: ${(lookupCount / seconds).toFixed(0)} lookups/s (cell-name raw source included)`);
    console.log(`[biome-source] biome-manager suite wall clock: ${(performance.now() - suiteStart).toFixed(0)} ms`);
  });
});
