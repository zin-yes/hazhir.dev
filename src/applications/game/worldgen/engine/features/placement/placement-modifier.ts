// Mirrors net.minecraft.world.level.levelgen.placement.PlacementModifier / PlacementContext.
// getPositions returns the positions eagerly; PlacedFeature walks them depth first, which is the order the Java
// Stream.flatMap chain produces (every modifier draws its randomness when getPositions is called).

import type { RandomSource } from "../../random";
import type { BlockPos } from "../core/block-pos";
import type { CarvingMask, CarvingStep } from "../core/carving-mask";
import type { HeightmapType } from "../core/heightmap";
import type { FeatureChunkGenerator } from "../feature/feature-type";
import type { FeatureParser } from "../feature/feature-parser";
import type { PlacedFeature } from "../feature/placed-feature";
import type { WorldGenLevel } from "../level/world-gen-level";
import type { JsonObject } from "../providers/json-fields";
import type { WorldGenerationContext } from "../providers/value-providers";

export class PlacementContext implements WorldGenerationContext {
  readonly minGenY: number;
  readonly genDepth: number;

  constructor(
    readonly level: WorldGenLevel,
    readonly generator: FeatureChunkGenerator,
    /** Set by placeWithBiomeCheck; the biome filter needs it. */
    readonly topFeature: PlacedFeature | undefined,
  ) {
    this.minGenY = Math.max(level.minY, generator.minY);
    this.genDepth = Math.min(level.height, generator.genDepth);
  }

  getHeight(type: HeightmapType, x: number, z: number): number {
    return this.level.getHeight(type, x, z);
  }

  getCarvingMask(chunkX: number, chunkZ: number, step: CarvingStep): CarvingMask {
    return this.level.getCarvingMask(chunkX, chunkZ, step);
  }

  get minBuildHeight(): number {
    return this.level.minY;
  }
}

export interface PlacementModifier {
  readonly type: string;
  getPositions(context: PlacementContext, random: RandomSource, origin: BlockPos): BlockPos[];
}

export interface PlacementModifierType {
  readonly id: string;
  parse(json: JsonObject, parser: FeatureParser): PlacementModifier;
}

export function definePlacementModifierType(type: PlacementModifierType): PlacementModifierType {
  return type;
}

/** PlacementFilter: keep the position when shouldPlace is true. */
export function filterModifier(type: string, shouldPlace: (context: PlacementContext, random: RandomSource, origin: BlockPos) => boolean): PlacementModifier {
  return { type, getPositions: (context, random, origin) => (shouldPlace(context, random, origin) ? [origin] : []) };
}

/** RepeatingPlacement: `count` copies of the position. */
export function repeatingModifier(type: string, count: (random: RandomSource, origin: BlockPos) => number): PlacementModifier {
  return {
    type,
    getPositions: (_context, random, origin) => {
      const copies = count(random, origin);
      const positions: BlockPos[] = [];
      for (let index = 0; index < copies; index++) positions.push(origin);
      return positions;
    },
  };
}

export class PlacementModifierTypeRegistry {
  private readonly typesById = new Map<string, PlacementModifierType>();

  constructor(types: readonly PlacementModifierType[] = []) {
    for (const type of types) this.register(type);
  }

  register(type: PlacementModifierType): this {
    if (this.typesById.has(type.id)) throw new Error(`Placement modifier type ${type.id} is registered twice`);
    this.typesById.set(type.id, type);
    return this;
  }

  get(id: string): PlacementModifierType | undefined {
    return this.typesById.get(id);
  }
}
