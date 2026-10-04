// Scans a coarse grid of the overworld's biome map and picks well-separated representative game columns per biome.

import { CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { possibleBiomesOfDimension } from "../engine/features";
import { getTerrainOnlyGenerator } from "../overworld-world";
import { loadTerralithRegistries } from "../terralith/load-terralith-registries";

export interface BiomeLocatorOptions {
  seed: number;
  /** Half-width of the scanned square, in blocks around the origin. */
  radiusBlocks?: number;
  stepBlocks?: number;
  /** Minecraft y the biome map is sampled at (a surface-level slice of the 3D biome map). */
  sampleMinecraftY?: number;
  representativesPerBiome?: number;
  /** Minimum distance between two representatives of one biome; relaxed when the biome is too small for it. */
  minimumSeparationBlocks?: number;
}

export interface BiomeRepresentative {
  blockX: number;
  blockZ: number;
  gameChunkX: number;
  gameChunkZ: number;
  /** Neighbouring samples (of 4) inside the same biome; higher means a more interior spot. */
  interiorNeighbours: number;
}

export interface BiomeCoverage {
  biome: string;
  sampleCount: number;
  coverageShare: number;
  representatives: BiomeRepresentative[];
}

export interface BiomeLocatorResult {
  seed: number;
  totalSamples: number;
  /** Biomes that occur in the scan, most common first. */
  biomes: BiomeCoverage[];
  /** Biomes the dimension can place that the scan never sampled. */
  missingBiomes: string[];
}

const DEFAULT_RADIUS_BLOCKS = 8000;
const DEFAULT_STEP_BLOCKS = 64;
const DEFAULT_SAMPLE_MINECRAFT_Y = 70;
const DEFAULT_REPRESENTATIVES_PER_BIOME = 3;
const DEFAULT_MINIMUM_SEPARATION_BLOCKS = 512;
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function locateBiomes(options: BiomeLocatorOptions): BiomeLocatorResult {
  const radiusBlocks = options.radiusBlocks ?? DEFAULT_RADIUS_BLOCKS;
  const stepBlocks = options.stepBlocks ?? DEFAULT_STEP_BLOCKS;
  const sampleY = options.sampleMinecraftY ?? DEFAULT_SAMPLE_MINECRAFT_Y;
  const representativesPerBiome = options.representativesPerBiome ?? DEFAULT_REPRESENTATIVES_PER_BIOME;
  const minimumSeparationBlocks = options.minimumSeparationBlocks ?? DEFAULT_MINIMUM_SEPARATION_BLOCKS;
  const generator = getTerrainOnlyGenerator(options.seed);

  const cellsPerSide = Math.max(1, Math.floor((radiusBlocks * 2) / stepBlocks));
  const blockCoordinateOf = (cellIndex: number) => -radiusBlocks + cellIndex * stepBlocks + stepBlocks / 2;

  const biomeNames: string[] = [];
  const biomeIndexByName = new Map<string, number>();
  const biomeIndexPerCell = new Int32Array(cellsPerSide * cellsPerSide);
  for (let cellX = 0; cellX < cellsPerSide; cellX++) {
    for (let cellZ = 0; cellZ < cellsPerSide; cellZ++) {
      const biomeName = generator.biomeAt(blockCoordinateOf(cellX), sampleY, blockCoordinateOf(cellZ));
      let biomeIndex = biomeIndexByName.get(biomeName);
      if (biomeIndex === undefined) {
        biomeIndex = biomeNames.length;
        biomeNames.push(biomeName);
        biomeIndexByName.set(biomeName, biomeIndex);
      }
      biomeIndexPerCell[cellX * cellsPerSide + cellZ] = biomeIndex;
    }
  }

  const candidatesByBiome: BiomeRepresentative[][] = biomeNames.map(() => []);
  const sampleCounts = new Int32Array(biomeNames.length);
  for (let cellX = 0; cellX < cellsPerSide; cellX++) {
    for (let cellZ = 0; cellZ < cellsPerSide; cellZ++) {
      const biomeIndex = biomeIndexPerCell[cellX * cellsPerSide + cellZ]!;
      sampleCounts[biomeIndex]!++;
      let interiorNeighbours = 0;
      for (const [offsetX, offsetZ] of NEIGHBOUR_OFFSETS) {
        const neighbourX = cellX + offsetX;
        const neighbourZ = cellZ + offsetZ;
        const isInsideScan = neighbourX >= 0 && neighbourX < cellsPerSide && neighbourZ >= 0 && neighbourZ < cellsPerSide;
        if (isInsideScan && biomeIndexPerCell[neighbourX * cellsPerSide + neighbourZ] === biomeIndex) interiorNeighbours++;
      }
      const blockX = blockCoordinateOf(cellX);
      const blockZ = blockCoordinateOf(cellZ);
      candidatesByBiome[biomeIndex]!.push({
        blockX,
        blockZ,
        gameChunkX: Math.floor(blockX / CHUNK_WIDTH),
        gameChunkZ: Math.floor(blockZ / CHUNK_LENGTH),
        interiorNeighbours,
      });
    }
  }

  const totalSamples = cellsPerSide * cellsPerSide;
  const biomes = biomeNames
    .map<BiomeCoverage>((biome, biomeIndex) => ({
      biome,
      sampleCount: sampleCounts[biomeIndex]!,
      coverageShare: sampleCounts[biomeIndex]! / totalSamples,
      representatives: chooseSeparatedRepresentatives(
        candidatesByBiome[biomeIndex]!,
        representativesPerBiome,
        minimumSeparationBlocks,
        stepBlocks,
      ),
    }))
    .sort((left, right) => right.sampleCount - left.sampleCount || left.biome.localeCompare(right.biome));

  const foundBiomes = new Set(biomeNames);
  const { overworldDimension } = loadTerralithRegistries();
  const missingBiomes = possibleBiomesOfDimension(overworldDimension)
    .filter((biome) => !foundBiomes.has(biome))
    .sort();
  return { seed: options.seed, totalSamples, biomes, missingBiomes };
}

function distanceFromOrigin(candidate: BiomeRepresentative): number {
  return Math.hypot(candidate.blockX, candidate.blockZ);
}

function chooseSeparatedRepresentatives(
  candidates: BiomeRepresentative[],
  wantedCount: number,
  initialSeparationBlocks: number,
  stepBlocks: number,
): BiomeRepresentative[] {
  const ranked = [...candidates].sort(
    (left, right) =>
      right.interiorNeighbours - left.interiorNeighbours ||
      distanceFromOrigin(left) - distanceFromOrigin(right) ||
      left.blockX - right.blockX ||
      left.blockZ - right.blockZ,
  );
  let chosen: BiomeRepresentative[] = [];
  for (let separation = initialSeparationBlocks; separation >= 0; separation = separation > stepBlocks ? separation / 2 : -1) {
    chosen = [];
    for (const candidate of ranked) {
      const isFarEnough = chosen.every(
        (existing) => Math.hypot(existing.blockX - candidate.blockX, existing.blockZ - candidate.blockZ) >= separation,
      );
      if (isFarEnough) chosen.push(candidate);
      if (chosen.length === wantedCount) return chosen;
    }
  }
  return chosen;
}
