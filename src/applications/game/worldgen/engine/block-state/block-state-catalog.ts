// Block state knowledge recorded from the real 1.20.6 classes (BlockBehaviour.BlockStateBase isAir, blocksMotion,
// isSolid, canBeReplaced, getFluidState, isFaceSturdy; LeavesBlock / DoublePlantBlock instances; liquid()).
// States are strings like "minecraft:tall_grass[half=lower]"; missing properties take the block's default values
// (what BlockState.CODEC does when a datapack omits them).
//
// Unknown block names are an explicit decision: strict catalogs (tests) throw, lenient catalogs (runtime) treat the
// block as a full solid stone-like block and count it in `unknownBlockCounts`.

import { BlockPalette, blockNameOf, formatBlockState, parseBlockState } from "../chunk";
import { GENERATED_BLOCK_ENTRIES } from "./block-state-table.generated";
import type { GeneratedBlockEntry, GeneratedSurvivalRule } from "./block-state-table-types";

export type FluidKind = "empty" | "water" | "flowing_water" | "lava" | "flowing_lava";

/** Direction ordinals as in net.minecraft.core.Direction: DOWN, UP, NORTH, SOUTH, WEST, EAST. */
export const SturdyFace = { down: 1, up: 2, north: 4, south: 8, west: 16, east: 32 } as const;
const STURDY_LETTER_BITS: Record<string, number> = { d: 1, u: 2, n: 4, s: 8, w: 16, e: 32 };

export interface BlockStateInfo {
  readonly state: string;
  readonly name: string;
  /** False when the block name is not a registered 1.20.6 block (lenient fallback values are used). */
  readonly known: boolean;
  readonly isAir: boolean;
  readonly blocksMotion: boolean;
  /** BlockBehaviour.BlockStateBase.isSolid (the deprecated "legacy solid" used by the solid block predicate). */
  readonly isSolid: boolean;
  /** canBeReplaced() without a placement context (BlockBehaviour.Properties.replaceable). */
  readonly isReplaceable: boolean;
  readonly isLeaves: boolean;
  readonly isDoublePlant: boolean;
  /** BlockState.liquid(): water, lava and bubble columns. */
  readonly isLiquid: boolean;
  readonly isWaterloggable: boolean;
  readonly fluid: FluidKind;
  /** FluidState.getAmount(): 8 for sources and falling fluid, 8 - level for flowing fluid, 0 for none. */
  readonly fluidAmount: number;
  /** Bit set of SturdyFace values (isFaceSturdy with SupportType.FULL on an empty block getter, default state). */
  readonly sturdyFaces: number;
}

function fluidFromLetters(letters: string): FluidKind {
  if (letters.includes("W")) return "water";
  if (letters.includes("F")) return "flowing_water";
  if (letters.includes("L")) return "lava";
  if (letters.includes("G")) return "flowing_lava";
  return "empty";
}

function sturdyBits(letters: string): number {
  let bits = 0;
  for (const letter of letters) bits |= STURDY_LETTER_BITS[letter] ?? 0;
  return bits;
}

function parsePropertyString(propertyString: string): Record<string, string> {
  const properties: Record<string, string> = {};
  if (propertyString === "") return properties;
  for (const pair of propertyString.split(",")) {
    const separatorIndex = pair.indexOf("=");
    properties[pair.slice(0, separatorIndex)] = pair.slice(separatorIndex + 1);
  }
  return properties;
}

function fluidAmountOf(fluid: FluidKind, properties: Record<string, string>): number {
  if (fluid === "empty") return 0;
  if (fluid === "water" || fluid === "lava") return 8;
  const level = Number(properties.level ?? "0");
  return level >= 8 ? 8 : 8 - level;
}

export class UnknownBlockError extends Error {}

export interface BlockStateCatalogOptions {
  /** Throw on unknown block names instead of falling back to a solid block. Use in tests. */
  strict?: boolean;
}

export class BlockStateCatalog {
  readonly strict: boolean;
  /** Unknown block name -> number of distinct states classified with the solid fallback. */
  readonly unknownBlockCounts = new Map<string, number>();
  private readonly infoByState = new Map<string, BlockStateInfo>();
  private readonly defaultPropertiesByName = new Map<string, Record<string, string>>();
  private readonly propertiesByState = new Map<string, Readonly<Record<string, string>>>();
  private readonly normalizedByState = new Map<string, string>();

  constructor(options: BlockStateCatalogOptions = {}) {
    this.strict = options.strict ?? false;
  }

  isKnownBlock(name: string): boolean {
    return GENERATED_BLOCK_ENTRIES[name] !== undefined;
  }

  private entryOf(name: string): GeneratedBlockEntry | undefined {
    return GENERATED_BLOCK_ENTRIES[name];
  }

  /** Records (or throws for) an unknown block name. Returns false so callers can fall back. */
  reportUnknownBlock(name: string, context: string): false {
    if (this.strict) throw new UnknownBlockError(`Unknown block "${name}" (${context})`);
    this.unknownBlockCounts.set(name, (this.unknownBlockCounts.get(name) ?? 0) + 1);
    return false;
  }

  defaultProperties(name: string): Record<string, string> {
    let properties = this.defaultPropertiesByName.get(name);
    if (!properties) {
      const entry = this.entryOf(name);
      properties = entry ? parsePropertyString(entry[0]) : {};
      this.defaultPropertiesByName.set(name, properties);
    }
    return properties;
  }

  defaultState(name: string): string {
    return formatBlockState(name, this.defaultProperties(name));
  }

  /** Full property map of a state: defaults overlaid with the state's own properties. Shared: do not mutate. */
  propertiesOf(state: string): Readonly<Record<string, string>> {
    let properties = this.propertiesByState.get(state);
    if (!properties) {
      const parsed = parseBlockState(state);
      properties = Object.freeze({ ...this.defaultProperties(parsed.name), ...parsed.properties });
      this.propertiesByState.set(state, properties);
    }
    return properties;
  }

  /** "minecraft:tall_grass" -> "minecraft:tall_grass[half=lower]" (all properties, sorted). Unknown blocks are returned as given. */
  normalize(state: string): string {
    let normalized = this.normalizedByState.get(state);
    if (normalized === undefined) {
      const parsed = parseBlockState(state);
      normalized = this.isKnownBlock(parsed.name) ? formatBlockState(parsed.name, { ...this.defaultProperties(parsed.name), ...parsed.properties }) : state;
      this.normalizedByState.set(state, normalized);
    }
    return normalized;
  }

  /** BlockState.setValue on a state string (the state is normalized first). */
  withProperty(state: string, propertyName: string, value: string): string {
    const name = blockNameOf(state);
    const properties = { ...this.propertiesOf(state) };
    if (this.isKnownBlock(name) && !(propertyName in properties)) {
      throw new Error(`Block ${name} has no property "${propertyName}"`);
    }
    properties[propertyName] = value;
    return formatBlockState(name, properties);
  }

  hasProperty(state: string, propertyName: string): boolean {
    return propertyName in this.propertiesOf(state);
  }

  info(state: string): BlockStateInfo {
    const cached = this.infoByState.get(state);
    if (cached) return cached;
    const created = this.classify(state);
    this.infoByState.set(state, created);
    return created;
  }

  private classify(state: string): BlockStateInfo {
    const name = blockNameOf(state);
    const entry = this.entryOf(name);
    if (!entry) {
      this.reportUnknownBlock(name, `classifying ${state}`);
      return {
        state, name, known: false, isAir: false, blocksMotion: true, isSolid: true, isReplaceable: false, isLeaves: false,
        isDoublePlant: false, isLiquid: false, isWaterloggable: false, fluid: "empty", fluidAmount: 0, sturdyFaces: 63,
      };
    }
    const defaults = this.defaultProperties(name);
    const properties = { ...defaults, ...parseBlockState(state).properties };
    const differing = Object.keys(properties)
      .filter((key) => defaults[key] !== properties[key] && !(key === "waterlogged" && properties[key] === "true"))
      .sort()
      .map((key) => `${key}=${properties[key]}`)
      .join(",");
    const blockLetters = entry[1];
    const variantLetters = differing === "" ? undefined : entry[3]?.[differing];
    const stateLetters = variantLetters ?? blockLetters.replace(/[YDIQ]/g, "");
    let fluid = fluidFromLetters(stateLetters);
    if (properties.waterlogged === "true") fluid = "water";
    return {
      state,
      name,
      known: true,
      isAir: stateLetters.includes("A"),
      blocksMotion: stateLetters.includes("M"),
      isSolid: stateLetters.includes("S"),
      isReplaceable: stateLetters.includes("R"),
      isLeaves: blockLetters.includes("Y"),
      isDoublePlant: blockLetters.includes("D"),
      isLiquid: blockLetters.includes("I"),
      isWaterloggable: blockLetters.includes("Q"),
      fluid,
      fluidAmount: fluidAmountOf(fluid, properties),
      sturdyFaces: sturdyBits(entry[2]),
    };
  }

  /** Survival rules keyed by the properties that differ from the default state ("" = default state). */
  survivalRulesOf(name: string): Record<string, GeneratedSurvivalRule> | undefined {
    return this.entryOf(name)?.[4];
  }

  /** Per-palette classification cache for hot paths that hold palette ids. */
  forPalette(palette: BlockPalette): PaletteBlockInfo {
    return new PaletteBlockInfo(palette, this);
  }
}

export class PaletteBlockInfo {
  private readonly infoById: BlockStateInfo[] = [];

  constructor(
    readonly palette: BlockPalette,
    readonly catalog: BlockStateCatalog,
  ) {}

  info(paletteId: number): BlockStateInfo {
    let cached = this.infoById[paletteId];
    if (!cached) {
      cached = this.catalog.info(this.palette.stateOf(paletteId));
      this.infoById[paletteId] = cached;
    }
    return cached;
  }
}

export function isFluidWater(fluid: FluidKind): boolean {
  return fluid === "water" || fluid === "flowing_water";
}

export function isFluidLava(fluid: FluidKind): boolean {
  return fluid === "lava" || fluid === "flowing_lava";
}
