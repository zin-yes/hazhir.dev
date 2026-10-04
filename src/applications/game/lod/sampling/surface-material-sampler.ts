// Top and wall blocks of one LOD cell from the real compiled surface rules, evaluated at a single column instead of a
// chunk: the rule context is fed the sampled surface height, the cell's biome, sea level as the water height and a
// planar heightmap built from the local slope (for the `steep` condition). Snow cover and sea ice follow the
// freeze_top_layer feature's temperature test. Coordinates are Minecraft blocks.

import { BlockType } from "../../blocks";
import { toGameBlockOrAir } from "../../worldgen/engine/blocks/lenient-block-map";
import { NO_RULE_MATCH, SurfaceRuleContext } from "../../worldgen/engine/surface";
import type { SeedWorldgenContext } from "./seed-worldgen-context";

const NO_WATER_HEIGHT = -2147483648;
/** How far below the sampled surface the preliminary surface is assumed to be (it ignores jaggedness). */
const PRELIMINARY_SURFACE_DEPTH = 8;
const STONE_DEPTH_BELOW_SURFACE = 64;
const CHUNK_COLUMN_MASK = 15;

export interface SurfaceMaterial {
  topBlock: BlockType;
  /** Block whose side texture colours the cell's walls: the top block itself, or what a thin cover (snow) lies on. */
  sideBlock: BlockType;
  /** Minecraft y of the water surface (top face), or undefined on dry land and under sea ice. */
  waterSurfaceY: number | undefined;
}

export class SurfaceMaterialSampler {
  private readonly ruleContext: SurfaceRuleContext;
  private readonly gameBlockByResultIndex: BlockType[] = [];
  private readonly defaultGameBlock: BlockType;
  private currentBiome = "";
  private currentTopY = 0;
  private currentSlopeX = 0;
  private currentSlopeZ = 0;
  private currentLocalX = 0;
  private currentLocalZ = 0;
  ruleEvaluations = 0;

  constructor(private readonly context: SeedWorldgenContext) {
    const { settings, surfaceSystem, temperature } = context;
    this.defaultGameBlock = toGameBlockOrAir(settings.defaultBlock).gameBlock;
    this.ruleContext = new SurfaceRuleContext(
      {
        minY: settings.minY,
        height: settings.height,
        getSurfaceDepth: (blockX, blockZ) => surfaceSystem.getSurfaceDepth(blockX, blockZ),
        getSurfaceSecondary: (blockX, blockZ) => surfaceSystem.getSurfaceSecondary(blockX, blockZ),
        getPreliminarySurfaceLevel: () => this.currentTopY - PRELIMINARY_SURFACE_DEPTH,
        isColdEnoughToSnow: (biomeId, blockX, blockY, blockZ) => temperature.isColdEnoughToSnow(biomeId, blockX, blockY, blockZ),
      },
      {
        getHeight: (localX, localZ) =>
          Math.round(
            this.currentTopY + this.currentSlopeX * (localX - this.currentLocalX) + this.currentSlopeZ * (localZ - this.currentLocalZ),
          ),
      },
      () => this.currentBiome,
    );
  }

  private gameBlockOfResult(resultIndex: number): BlockType {
    if (resultIndex === NO_RULE_MATCH) return this.defaultGameBlock;
    let gameBlock = this.gameBlockByResultIndex[resultIndex];
    if (gameBlock === undefined) {
      gameBlock = toGameBlockOrAir(this.context.surfaceResults.states[resultIndex]!).gameBlock;
      if (gameBlock === BlockType.AIR) gameBlock = this.defaultGameBlock;
      this.gameBlockByResultIndex[resultIndex] = gameBlock;
    }
    return gameBlock;
  }

  private evaluateAt(blockX: number, blockY: number, blockZ: number, stoneDepthAbove: number, waterHeight: number): BlockType {
    this.ruleContext.updateY(stoneDepthAbove, STONE_DEPTH_BELOW_SURFACE, waterHeight, blockX, blockY, blockZ);
    this.ruleEvaluations++;
    return this.gameBlockOfResult(this.context.surfaceRule(this.ruleContext));
  }

  /**
   * @param topY top-face y of the terrain (highest solid block + 1)
   * @param slopeX rise in blocks per block along +x around the column, likewise slopeZ
   */
  sample(blockX: number, blockZ: number, topY: number, slopeX: number, slopeZ: number, biomeId: string): SurfaceMaterial {
    const { seaLevel } = this.context.settings;
    this.currentBiome = biomeId;
    this.currentTopY = topY;
    this.currentSlopeX = slopeX;
    this.currentSlopeZ = slopeZ;
    this.currentLocalX = blockX & CHUNK_COLUMN_MASK;
    this.currentLocalZ = blockZ & CHUNK_COLUMN_MASK;
    this.ruleContext.updateXZ(blockX, blockZ);
    const isUnderwater = topY < seaLevel;
    const waterHeight = isUnderwater ? seaLevel : NO_WATER_HEIGHT;
    const topBlock = this.evaluateAt(blockX, topY - 1, blockZ, 1, waterHeight);
    const { temperature } = this.context;
    if (isUnderwater) {
      if (temperature.isColdEnoughToSnow(biomeId, blockX, seaLevel - 1, blockZ)) {
        return { topBlock: BlockType.ICE, sideBlock: BlockType.ICE, waterSurfaceY: undefined };
      }
      return { topBlock, sideBlock: topBlock, waterSurfaceY: seaLevel };
    }
    if (temperature.isColdEnoughToSnow(biomeId, blockX, topY, blockZ)) {
      return { topBlock: BlockType.SNOW_LAYER, sideBlock: topBlock === BlockType.GRASS ? BlockType.GRASS_SNOWY : topBlock, waterSurfaceY: undefined };
    }
    return { topBlock, sideBlock: topBlock, waterSurfaceY: undefined };
  }
}
