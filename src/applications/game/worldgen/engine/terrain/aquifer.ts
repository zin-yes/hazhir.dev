// Port of Aquifer.NoiseBasedAquifer (Minecraft 1.20.6): per block, decides whether open space is air, water, lava or
// stays solid (null, returned here as NULL_SUBSTANCE). Aquifer centres sit on a jittered 16 x 12 x 16 grid; the three
// nearest centres to a block decide its fluid and, through pressure against the barrier noise, whether a thin wall of
// the default block is kept between differing fluids. Fluids are the terrain symbols (air, default fluid, lava).

import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import {
  addWorkerCounter,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSampledSection,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import { type FunctionContext, SinglePointContext } from "../density/density-function";
import type { DensityNode } from "../density/density-function";
import type { PositionalRandomFactory } from "../random";
import { transientRandomAt } from "../random/xoroshiro-random-source";
import { BLOCK_AIR, BLOCK_DEFAULT_FLUID, BLOCK_LAVA } from "./terrain-blocks";

/** Aquifer.computeSubstance returning null: the block is not decided by the aquifer. */
export const NULL_SUBSTANCE = -1;
/** openBlockSubstanceWithoutContext could not decide without evaluating density functions at the block. */
export const UNRESOLVED_SUBSTANCE = -2;

const GLOBAL_LAVA_LEVEL = -54;
const WAY_BELOW_MIN_Y = -134217728;
const MAX_INT = 2147483647;

const X_RANGE = 10;
const Y_RANGE = 9;
const Z_RANGE = 10;
const X_SPACING = 16;
const Y_SPACING = 12;
const Z_SPACING = 16;

/** (-2, -1) style chunk offsets sampled when looking for the surface above an aquifer centre. */
const NEAREST_CENTERS_SAMPLE_EVERY = 64;
const GRID_CELLS_PER_LOOKUP = 12;
const ORIGIN_UNIFORM = 1;
const ORIGIN_MIXED = 2;

const SURFACE_SAMPLING_OFFSETS_IN_CHUNKS: readonly (readonly [number, number])[] = [
  [0, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [-3, 0], [-2, 0], [-1, 0], [1, 0], [-2, 1], [-1, 1], [0, 1], [1, 1],
];

export interface NoiseBasedAquiferParams {
  chunkX: number;
  chunkZ: number;
  minY: number;
  height: number;
  seaLevel: number;
  /** The router's functions as wired by the chunk's NoiseChunk (erosion and depth read the chunk's flat caches). */
  barrier: DensityNode;
  fluidLevelFloodedness: DensityNode;
  fluidLevelSpread: DensityNode;
  lava: DensityNode;
  erosion: DensityNode;
  depth: DensityNode;
  /** RandomState.aquiferRandom(). */
  positionalRandomFactory: PositionalRandomFactory;
  preliminarySurfaceLevel: (blockX: number, blockZ: number) => number;
}

function similarity(firstDistanceSquared: number, secondDistanceSquared: number): number {
  return 1 - Math.abs(secondDistanceSquared - firstDistanceSquared) / 25;
}

function clampedLerp(start: number, end: number, delta: number): number {
  if (delta < 0) return start;
  if (delta > 1) return end;
  return start + delta * (end - start);
}

function clampedMap(value: number, fromStart: number, fromEnd: number, toStart: number, toEnd: number): number {
  return clampedLerp(toStart, toEnd, (value - fromStart) / (fromEnd - fromStart));
}

function map(value: number, fromStart: number, fromEnd: number, toStart: number, toEnd: number): number {
  const delta = (value - fromStart) / (fromEnd - fromStart);
  return toStart + delta * (toEnd - toStart);
}

export class NoiseBasedAquifer {
  private readonly minGridX: number;
  private readonly minGridY: number;
  private readonly minGridZ: number;
  private readonly gridSizeX: number;
  private readonly gridSizeZ: number;
  private readonly lavaBelowY: number;
  private readonly seaLevel: number;

  private readonly locationKnown: Uint8Array;
  private readonly locationX: Int32Array;
  private readonly locationY: Int32Array;
  private readonly locationZ: Int32Array;
  private readonly statusKnown: Uint8Array;
  private readonly statusLevel: Int32Array;
  private readonly statusFluid: Uint8Array;
  /** Per origin grid cell: 0 unknown, ORIGIN_UNIFORM when its 12 candidate centres share one status, else ORIGIN_MIXED. */
  private readonly originUniformity: Uint8Array;

  private readonly isProfiling = isWorkerProfiling();
  private substanceLookups = 0;
  private locationMisses = 0;
  private statusLookups = 0;
  private statusMisses = 0;
  private pressureCalculations = 0;

  private computedLevel = 0;
  private computedFluid = BLOCK_AIR;
  private cachedBarrierValue = Number.NaN;

  constructor(private readonly params: NoiseBasedAquiferParams) {
    const chunkMinBlockX = params.chunkX * 16;
    const chunkMinBlockZ = params.chunkZ * 16;
    this.seaLevel = params.seaLevel;
    this.lavaBelowY = Math.min(GLOBAL_LAVA_LEVEL, params.seaLevel);
    this.minGridX = Math.floor(chunkMinBlockX / X_SPACING) - 1;
    const maxGridX = Math.floor((chunkMinBlockX + 15) / X_SPACING) + 1;
    this.gridSizeX = maxGridX - this.minGridX + 1;
    this.minGridY = Math.floor(params.minY / Y_SPACING) - 1;
    const maxGridY = Math.floor((params.minY + params.height) / Y_SPACING) + 1;
    const gridSizeY = maxGridY - this.minGridY + 1;
    this.minGridZ = Math.floor(chunkMinBlockZ / Z_SPACING) - 1;
    const maxGridZ = Math.floor((chunkMinBlockZ + 15) / Z_SPACING) + 1;
    this.gridSizeZ = maxGridZ - this.minGridZ + 1;
    const cellCount = this.gridSizeX * gridSizeY * this.gridSizeZ;
    this.locationKnown = new Uint8Array(cellCount);
    this.locationX = new Int32Array(cellCount);
    this.locationY = new Int32Array(cellCount);
    this.locationZ = new Int32Array(cellCount);
    this.statusKnown = new Uint8Array(cellCount);
    this.statusLevel = new Int32Array(cellCount);
    this.statusFluid = new Uint8Array(cellCount);
    this.originUniformity = new Uint8Array(cellCount);
  }

  private cellIndex(gridX: number, gridY: number, gridZ: number): number {
    return ((gridY - this.minGridY) * this.gridSizeZ + (gridZ - this.minGridZ)) * this.gridSizeX + (gridX - this.minGridX);
  }

  /** FluidPicker.computeFluid(...).at(y) for the generator's global picker. */
  private globalFluidAt(blockY: number): number {
    if (blockY < this.lavaBelowY) return BLOCK_LAVA;
    return blockY < this.seaLevel ? BLOCK_DEFAULT_FLUID : BLOCK_AIR;
  }

  /** Aquifer.computeSubstance: a terrain symbol, or NULL_SUBSTANCE where the block stays solid. */
  computeSubstance(context: FunctionContext, density: number): number {
    if (density > 0) return NULL_SUBSTANCE;
    return this.resolveSubstance(context, density, context.blockX, context.blockY, context.blockZ);
  }

  /**
   * The answer for an open block (density <= 0) when it needs no density function: lava below the lava level, or the
   * shared fluid of a uniform origin cell. UNRESOLVED_SUBSTANCE means computeSubstanceAt must decide.
   */
  openBlockSubstanceWithoutContext(blockX: number, blockY: number, blockZ: number): number {
    if (blockY < this.lavaBelowY) {
      this.substanceLookups++;
      return BLOCK_LAVA;
    }
    const originGridX = (blockX - 5) >> 4;
    const originGridY = Math.floor((blockY + 1) / Y_SPACING);
    const originGridZ = (blockZ - 5) >> 4;
    const originIndex = ((originGridY - this.minGridY) * this.gridSizeZ + (originGridZ - this.minGridZ)) * this.gridSizeX + (originGridX - this.minGridX);
    let uniformity = this.originUniformity[originIndex]!;
    if (uniformity === 0) {
      uniformity = this.classifyOrigin(originGridX, originGridY, originGridZ);
      this.originUniformity[originIndex] = uniformity;
    }
    if (uniformity !== ORIGIN_UNIFORM) return UNRESOLVED_SUBSTANCE;
    this.substanceLookups++;
    return this.fluidAtStatus(originIndex, blockY);
  }

  /** computeSubstance for a context known to sit at (blockX, blockY, blockZ), skipping its coordinate getters. */
  computeSubstanceAt(context: FunctionContext, density: number, blockX: number, blockY: number, blockZ: number): number {
    if (density > 0) return NULL_SUBSTANCE;
    return this.resolveSubstance(context, density, blockX, blockY, blockZ);
  }

  /** Moves the lookup and cache counters accumulated since the last call into the worker profile. */
  drainProfileCounters(): void {
    if (!this.isProfiling) return;
    addWorkerCounter("aquiferLookups", this.substanceLookups);
    addWorkerCounter("aquiferLocationCacheMisses", this.locationMisses);
    addWorkerCounter("aquiferLocationCacheHits", this.substanceLookups * GRID_CELLS_PER_LOOKUP - this.locationMisses);
    addWorkerCounter("aquiferStatusLookups", this.statusLookups);
    addWorkerCounter("aquiferStatusCacheMisses", this.statusMisses);
    addWorkerCounter("aquiferStatusCacheHits", this.statusLookups - this.statusMisses);
    addWorkerCounter("aquiferPressureCalculations", this.pressureCalculations);
    this.substanceLookups = 0;
    this.locationMisses = 0;
    this.statusLookups = 0;
    this.statusMisses = 0;
    this.pressureCalculations = 0;
  }

  /** A router function the aquifer reads, timed exactly under the density node dimension (a few hundred calls per column). */
  private computeRouterFunction(routerFunction: DensityNode, point: FunctionContext, sectionName: string): number {
    if (!this.isProfiling) return routerFunction.compute(point);
    startWorkerSection(sectionName, DIMENSIONS.worldgenDensityNode, sectionName);
    try {
      return routerFunction.compute(point);
    } finally {
      endWorkerSection();
    }
  }

  private resolveSubstance(context: FunctionContext, density: number, blockX: number, blockY: number, blockZ: number): number {
    this.substanceLookups++;
    if (blockY < this.lavaBelowY) return BLOCK_LAVA;

    // X_SPACING and Z_SPACING are 16: an arithmetic shift is Math.floor of the division for block coordinates.
    const originGridX = (blockX - 5) >> 4;
    const originGridY = Math.floor((blockY + 1) / Y_SPACING);
    const originGridZ = (blockZ - 5) >> 4;
    const originIndex = ((originGridY - this.minGridY) * this.gridSizeZ + (originGridZ - this.minGridZ)) * this.gridSizeX + (originGridX - this.minGridX);
    let uniformity = this.originUniformity[originIndex]!;
    if (uniformity === 0) {
      uniformity = this.classifyOrigin(originGridX, originGridY, originGridZ);
      this.originUniformity[originIndex] = uniformity;
    }
    // When every candidate centre (the origin cell is one) has the same fluid status, all pressures are 0 and the
    // answer is that status's fluid.
    if (uniformity === ORIGIN_UNIFORM) return this.fluidAtStatus(originIndex, blockY);
    let nearestDistance = MAX_INT;
    let secondDistance = MAX_INT;
    let thirdDistance = MAX_INT;
    let nearestIndex = 0;
    let secondIndex = 0;
    let thirdIndex = 0;
    // Only the center search is timed: the fluid status work below can trigger rare heavy children, which would skew a sampled estimate.
    if (this.isProfiling) startWorkerSampledSection("aquifer.findNearestCenters", NEAREST_CENTERS_SAMPLE_EVERY);
    for (let offsetX = 0; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetZ = 0; offsetZ <= 1; offsetZ++) {
          const gridX = originGridX + offsetX;
          const gridY = originGridY + offsetY;
          const gridZ = originGridZ + offsetZ;
          const index = this.cellIndex(gridX, gridY, gridZ);
          this.ensureLocation(index, gridX, gridY, gridZ);
          const deltaX = this.locationX[index]! - blockX;
          const deltaY = this.locationY[index]! - blockY;
          const deltaZ = this.locationZ[index]! - blockZ;
          const distance = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
          if (nearestDistance >= distance) {
            thirdIndex = secondIndex;
            secondIndex = nearestIndex;
            nearestIndex = index;
            thirdDistance = secondDistance;
            secondDistance = nearestDistance;
            nearestDistance = distance;
          } else if (secondDistance >= distance) {
            thirdIndex = secondIndex;
            secondIndex = index;
            thirdDistance = secondDistance;
            secondDistance = distance;
          } else if (thirdDistance >= distance) {
            thirdIndex = index;
            thirdDistance = distance;
          }
        }
      }
    }

    if (this.isProfiling) endWorkerSection();

    this.ensureStatus(nearestIndex);
    const nearestFluid = this.fluidAtStatus(nearestIndex, blockY);
    const nearestSimilarity = similarity(nearestDistance, secondDistance);
    if (nearestSimilarity <= 0) return nearestFluid;
    if (nearestFluid === BLOCK_DEFAULT_FLUID && this.globalFluidAt(blockY - 1) === BLOCK_LAVA) return nearestFluid;

    this.cachedBarrierValue = Number.NaN;
    this.ensureStatus(secondIndex);
    const firstPressure = nearestSimilarity * this.calculatePressure(context, nearestIndex, secondIndex);
    if (density + firstPressure > 0) return NULL_SUBSTANCE;

    this.ensureStatus(thirdIndex);
    const nearestThirdSimilarity = similarity(nearestDistance, thirdDistance);
    if (nearestThirdSimilarity > 0) {
      const pressure = nearestSimilarity * nearestThirdSimilarity * this.calculatePressure(context, nearestIndex, thirdIndex);
      if (density + pressure > 0) return NULL_SUBSTANCE;
    }
    const secondThirdSimilarity = similarity(secondDistance, thirdDistance);
    if (secondThirdSimilarity > 0) {
      const pressure = nearestSimilarity * secondThirdSimilarity * this.calculatePressure(context, secondIndex, thirdIndex);
      if (density + pressure > 0) return NULL_SUBSTANCE;
    }
    return nearestFluid;
  }

  private ensureLocation(index: number, gridX: number, gridY: number, gridZ: number): void {
    if (this.locationKnown[index] !== 0) return;
    const random = transientRandomAt(this.params.positionalRandomFactory, gridX, gridY, gridZ);
    this.locationX[index] = gridX * X_SPACING + random.nextIntBounded(X_RANGE);
    this.locationY[index] = gridY * Y_SPACING + random.nextIntBounded(Y_RANGE);
    this.locationZ[index] = gridZ * Z_SPACING + random.nextIntBounded(Z_RANGE);
    this.locationKnown[index] = 1;
    this.locationMisses++;
  }

  /** Statuses are pure per chunk, so resolving all 12 candidates up front changes no answer. */
  private classifyOrigin(originGridX: number, originGridY: number, originGridZ: number): number {
    let firstLevel = 0;
    let firstFluid = 0;
    let isUniform = true;
    let isFirst = true;
    for (let offsetX = 0; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetZ = 0; offsetZ <= 1; offsetZ++) {
          const gridX = originGridX + offsetX;
          const gridY = originGridY + offsetY;
          const gridZ = originGridZ + offsetZ;
          const index = this.cellIndex(gridX, gridY, gridZ);
          this.ensureLocation(index, gridX, gridY, gridZ);
          this.ensureStatus(index);
          if (isFirst) {
            firstLevel = this.statusLevel[index]!;
            firstFluid = this.statusFluid[index]!;
            isFirst = false;
          } else if (this.statusLevel[index] !== firstLevel || this.statusFluid[index] !== firstFluid) {
            isUniform = false;
          }
        }
      }
    }
    return isUniform ? ORIGIN_UNIFORM : ORIGIN_MIXED;
  }

  private fluidAtStatus(index: number, blockY: number): number {
    return blockY < this.statusLevel[index]! ? this.statusFluid[index]! : BLOCK_AIR;
  }

  private calculatePressure(context: FunctionContext, firstIndex: number, secondIndex: number): number {
    this.pressureCalculations++;
    const blockY = context.blockY;
    const firstFluid = this.fluidAtStatus(firstIndex, blockY);
    const secondFluid = this.fluidAtStatus(secondIndex, blockY);
    if ((firstFluid === BLOCK_LAVA && secondFluid === BLOCK_DEFAULT_FLUID) || (firstFluid === BLOCK_DEFAULT_FLUID && secondFluid === BLOCK_LAVA)) {
      return 2;
    }
    const firstLevel = this.statusLevel[firstIndex]!;
    const secondLevel = this.statusLevel[secondIndex]!;
    const levelDifference = Math.abs(firstLevel - secondLevel);
    if (levelDifference === 0) return 0;
    const averageLevel = 0.5 * (firstLevel + secondLevel);
    const heightAboveAverage = blockY + 0.5 - averageLevel;
    const halfDifference = levelDifference / 2;
    const overlap = halfDifference - Math.abs(heightAboveAverage);
    let gradient: number;
    if (heightAboveAverage > 0) {
      const above = 0 + overlap;
      gradient = above > 0 ? above / 1.5 : above / 2.5;
    } else {
      const below = 3 + overlap;
      gradient = below > 0 ? below / 3 : below / 10;
    }
    let barrierValue = 0;
    if (!(gradient < -2 || gradient > 2)) {
      if (Number.isNaN(this.cachedBarrierValue)) this.cachedBarrierValue = this.computeRouterFunction(this.params.barrier, context, "router.barrier");
      barrierValue = this.cachedBarrierValue;
    }
    return 2 * (barrierValue + gradient);
  }

  private ensureStatus(index: number): void {
    this.statusLookups++;
    if (this.statusKnown[index] !== 0) return;
    this.statusMisses++;
    if (this.isProfiling) startWorkerSection("aquifer.computeFluid");
    this.computeFluid(this.locationX[index]!, this.locationY[index]!, this.locationZ[index]!);
    if (this.isProfiling) endWorkerSection();
    this.statusLevel[index] = this.computedLevel;
    this.statusFluid[index] = this.computedFluid;
    this.statusKnown[index] = 1;
  }

  /** Writes the FluidStatus of an aquifer centre into computedLevel / computedFluid. */
  private computeFluid(blockX: number, blockY: number, blockZ: number): void {
    const globalLevel = blockY < this.lavaBelowY ? GLOBAL_LAVA_LEVEL : this.seaLevel;
    const globalFluid = blockY < this.lavaBelowY ? BLOCK_LAVA : BLOCK_DEFAULT_FLUID;
    let lowestSurface = MAX_INT;
    const probeTop = blockY + 12;
    const probeBottom = blockY - 12;
    let fluidAtCentreSurface = false;
    for (const [chunkOffsetX, chunkOffsetZ] of SURFACE_SAMPLING_OFFSETS_IN_CHUNKS) {
      const sampleX = blockX + chunkOffsetX * 16;
      const sampleZ = blockZ + chunkOffsetZ * 16;
      const surfaceLevel = this.params.preliminarySurfaceLevel(sampleX, sampleZ);
      const surfaceTop = (surfaceLevel + 8) | 0;
      const isCentre = chunkOffsetX === 0 && chunkOffsetZ === 0;
      if (isCentre && probeBottom > surfaceTop) {
        this.computedLevel = globalLevel;
        this.computedFluid = globalFluid;
        return;
      }
      const isHigher = probeTop > surfaceTop;
      if (isHigher || isCentre) {
        const pickedLevel = surfaceTop < this.lavaBelowY ? GLOBAL_LAVA_LEVEL : this.seaLevel;
        const pickedFluid = surfaceTop < this.lavaBelowY ? BLOCK_LAVA : BLOCK_DEFAULT_FLUID;
        if (surfaceTop < pickedLevel) {
          if (isCentre) fluidAtCentreSurface = true;
          if (isHigher) {
            this.computedLevel = pickedLevel;
            this.computedFluid = pickedFluid;
            return;
          }
        }
      }
      lowestSurface = Math.min(lowestSurface, surfaceLevel);
    }
    const surfaceLevel = this.computeSurfaceLevel(blockX, blockY, blockZ, globalLevel, lowestSurface, fluidAtCentreSurface);
    this.computedLevel = surfaceLevel;
    this.computedFluid = this.computeFluidType(blockX, blockY, blockZ, globalFluid, surfaceLevel);
  }

  private computeSurfaceLevel(blockX: number, blockY: number, blockZ: number, globalLevel: number, lowestSurface: number, fluidAtCentreSurface: boolean): number {
    const point = new SinglePointContext(blockX, blockY, blockZ);
    let floodedThreshold: number;
    let randomizedThreshold: number;
    if (this.isDeepDarkRegion(point)) {
      floodedThreshold = -1;
      randomizedThreshold = -1;
    } else {
      const distanceBelowSurface = lowestSurface + 8 - blockY;
      const surfaceProximity = fluidAtCentreSurface ? clampedMap(distanceBelowSurface, 0, 64, 1, 0) : 0;
      const floodedness = Math.min(1, Math.max(-1, this.computeRouterFunction(this.params.fluidLevelFloodedness, point, "router.fluidLevelFloodedness")));
      const floodedCutoff = map(surfaceProximity, 1, 0, -0.3, 0.8);
      const randomizedCutoff = map(surfaceProximity, 1, 0, -0.8, 0.4);
      randomizedThreshold = floodedness - randomizedCutoff;
      floodedThreshold = floodedness - floodedCutoff;
    }
    if (floodedThreshold > 0) return globalLevel;
    if (randomizedThreshold > 0) return this.computeRandomizedFluidSurfaceLevel(blockX, blockY, blockZ, lowestSurface);
    return WAY_BELOW_MIN_Y;
  }

  private isDeepDarkRegion(point: SinglePointContext): boolean {
    return (
      this.computeRouterFunction(this.params.erosion, point, "router.erosion") < Math.fround(-0.225) &&
      this.computeRouterFunction(this.params.depth, point, "router.depth") > Math.fround(0.9)
    );
  }

  private computeRandomizedFluidSurfaceLevel(blockX: number, blockY: number, blockZ: number, lowestSurface: number): number {
    const cellX = Math.floor(blockX / 16);
    const cellY = Math.floor(blockY / 40);
    const cellZ = Math.floor(blockZ / 16);
    const cellCentreY = cellY * 40 + 20;
    const spread =
      this.computeRouterFunction(this.params.fluidLevelSpread, new SinglePointContext(cellX, cellY, cellZ), "router.fluidLevelSpread") * 10;
    const quantizedSpread = Math.floor(spread / 3) * 3;
    return Math.min(lowestSurface, cellCentreY + quantizedSpread);
  }

  private computeFluidType(blockX: number, blockY: number, blockZ: number, globalFluid: number, surfaceLevel: number): number {
    if (surfaceLevel <= -10 && surfaceLevel !== WAY_BELOW_MIN_Y && globalFluid !== BLOCK_LAVA) {
      const lavaNoise = this.computeRouterFunction(
        this.params.lava,
        new SinglePointContext(Math.floor(blockX / 64), Math.floor(blockY / 40), Math.floor(blockZ / 64)),
        "router.lava",
      );
      if (Math.abs(lavaNoise) > 0.3) return BLOCK_LAVA;
    }
    return globalFluid;
  }
}
