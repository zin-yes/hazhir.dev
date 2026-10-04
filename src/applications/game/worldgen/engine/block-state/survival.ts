// BlockState.canSurvive(LevelReader, BlockPos) for worldgen, driven by the survival probe recorded from the real
// classes (one non-air neighbor below / above / north, everything else air; see generate-block-state-table.node.ts).
//
// Rule semantics, derived from how the probe was taken:
//   - a block that survives in all-air (a = 1) survives unless a probed neighbor is outside that neighbor's set;
//   - a block that needs support (a = 0) survives if any probed neighbor is inside that neighbor's set;
//   - wall-attached blocks (only probed attached to the north) rotate the probe with their `facing`.
// Documented approximations: neighbors are matched by block name using their default state's properties
// (e.g. a snowy grass block counts as grass), and only the probed neighbor directions are consulted.
// Multi-neighbor conditions are ported by hand from the Java sources below.

import { blockNameOf, parseBlockState } from "../chunk";
import { type BlockStateCatalog, isFluidLava, isFluidWater } from "./block-state-catalog";
import type { GeneratedSurvivalRule } from "./block-state-table-types";
import { GENERATED_SURVIVAL_SETS } from "./block-state-table.generated";

export interface SurvivalLevel {
  getBlockState(x: number, y: number, z: number): string;
  /** LevelReader.getRawBrightness(pos, 0). Worldgen chunks are unlit during features, so the level returns 0. */
  getRawBrightness(x: number, y: number, z: number): number;
}

const HORIZONTAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
/** Horizontal facings in clockwise order, as Direction.getClockWise walks them. */
const CLOCKWISE_FACINGS = ["north", "east", "south", "west"];
const FACING_OFFSETS: Record<string, readonly [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

export class SurvivalRules {
  private readonly setMembership: Array<(blockName: string) => boolean>;
  private readonly ruleByState = new Map<string, GeneratedSurvivalRule | null>();

  constructor(private readonly catalog: BlockStateCatalog) {
    this.setMembership = GENERATED_SURVIVAL_SETS.map((set) => {
      const plus = new Set(set.plus ?? []);
      const minus = new Set(set.minus ?? []);
      const inBase = this.baseMembership(set.base);
      return (blockName: string) => plus.has(blockName) || (!minus.has(blockName) && inBase(blockName));
    });
  }

  private baseMembership(base: string): (blockName: string) => boolean {
    const defaultInfo = (blockName: string) => this.catalog.info(this.catalog.defaultState(blockName));
    switch (base) {
      case "none":
        return () => false;
      case "all":
        return (blockName) => this.catalog.isKnownBlock(blockName);
      case "notAir":
        return (blockName) => this.catalog.isKnownBlock(blockName) && !defaultInfo(blockName).isAir;
      case "solid":
        return (blockName) => this.catalog.isKnownBlock(blockName) && defaultInfo(blockName).isSolid;
      case "motion":
        return (blockName) => this.catalog.isKnownBlock(blockName) && defaultInfo(blockName).blocksMotion;
      case "sturdyUp":
        return (blockName) => this.catalog.isKnownBlock(blockName) && (defaultInfo(blockName).sturdyFaces & 2) !== 0;
      case "sturdyDown":
        return (blockName) => this.catalog.isKnownBlock(blockName) && (defaultInfo(blockName).sturdyFaces & 1) !== 0;
      case "sturdySide":
        return (blockName) => this.catalog.isKnownBlock(blockName) && (defaultInfo(blockName).sturdyFaces & 8) !== 0;
      default:
        throw new Error(`Unknown survival base set ${base}`);
    }
  }

  private inSet(setIndex: number, neighborState: string): boolean {
    return this.setMembership[setIndex]!(blockNameOf(neighborState));
  }

  /** The rule whose differing properties all match the state, preferring the most specific one. */
  private ruleFor(rules: Record<string, GeneratedSurvivalRule>, properties: Readonly<Record<string, string>>): {
    rule: GeneratedSurvivalRule | undefined;
    key: string;
  } {
    let bestKey: string | undefined;
    let bestSpecificity = -1;
    for (const key of Object.keys(rules)) {
      const pairs = key === "" ? [] : key.split(",");
      const matches = pairs.every((pair) => {
        const separatorIndex = pair.indexOf("=");
        return properties[pair.slice(0, separatorIndex)] === pair.slice(separatorIndex + 1);
      });
      if (matches && pairs.length > bestSpecificity) {
        bestKey = key;
        bestSpecificity = pairs.length;
      }
    }
    return { rule: bestKey === undefined ? undefined : rules[bestKey], key: bestKey ?? "" };
  }

  canSurvive(state: string, level: SurvivalLevel, x: number, y: number, z: number): boolean {
    const name = blockNameOf(state);
    if (!this.catalog.isKnownBlock(name)) {
      this.catalog.reportUnknownBlock(name, "canSurvive");
      return true;
    }
    const rules = this.catalog.survivalRulesOf(name);
    if (!rules) return true;
    const properties = this.catalog.propertiesOf(state);
    if (name === "minecraft:tall_seagrass" && properties.half !== "upper") {
      // TallSeagrassBlock.canSurvive: the lower half needs a full water fluid at its own position, plus the
      // SeagrassBlock ground rule (both use mayPlaceOn = sturdy top face and not magma).
      const own = this.catalog.info(level.getBlockState(x, y, z));
      return isFluidWater(own.fluid) && own.fluidAmount === 8 && this.canSurvive("minecraft:seagrass", level, x, y, z);
    }
    if (!this.passesHandPortedChecks(name, level, x, y, z)) return false;
    let rule = this.ruleByState.get(state);
    if (rule === undefined) {
      rule = this.ruleFor(rules, properties).rule ?? null;
      this.ruleByState.set(state, rule);
    }
    if (rule === null) return true;
    const probes: Array<{ setIndex: number; neighbor: () => string }> = [];
    if (rule.b !== undefined) probes.push({ setIndex: this.belowSetIndex(rule, level, x, y, z), neighbor: () => level.getBlockState(x, y - 1, z) });
    if (rule.u !== undefined) probes.push({ setIndex: rule.u, neighbor: () => level.getBlockState(x, y + 1, z) });
    if (rule.n !== undefined) probes.push({ setIndex: rule.n, neighbor: () => level.getBlockState(x, y, z - 1) });
    if (probes.length === 0 && rule.a === 0) {
      const wallProbe = this.wallAttachmentProbe(name, rules, properties, level, x, y, z);
      if (wallProbe) probes.push(wallProbe);
    }
    if (probes.length === 0) return rule.a === 1;
    if (rule.a === 1) return probes.every((probe) => this.inSet(probe.setIndex, probe.neighbor()));
    if (properties.half === "upper" && this.catalog.info(state).isDoublePlant) {
      // DoublePlantBlock.canSurvive: the upper half needs this block's lower half below.
      const belowState = level.getBlockState(x, y - 1, z);
      return blockNameOf(belowState) === name && this.catalog.propertiesOf(belowState).half === "lower";
    }
    return probes.some((probe) => this.inSet(probe.setIndex, probe.neighbor()));
  }

  private belowSetIndex(rule: GeneratedSurvivalRule, level: SurvivalLevel, x: number, y: number, z: number): number {
    // MushroomBlock.canSurvive: raw brightness < 13 widens the ground set.
    if (rule.k !== undefined && level.getRawBrightness(x, y, z) < 13) return rule.k;
    // SugarCaneBlock.canSurvive: water (or frosted ice) beside the block below.
    if (rule.w !== undefined) {
      for (const [offsetX, offsetZ] of HORIZONTAL_OFFSETS) {
        const besideState = level.getBlockState(x + offsetX, y - 1, z + offsetZ);
        if (isFluidWater(this.catalog.info(besideState).fluid) || blockNameOf(besideState) === "minecraft:frosted_ice") return rule.w;
      }
    }
    return rule.b!;
  }

  /** Wall blocks are probed attached to the north only; rotate that probe to the state's facing. */
  private wallAttachmentProbe(
    name: string,
    rules: Record<string, GeneratedSurvivalRule>,
    properties: Readonly<Record<string, string>>,
    level: SurvivalLevel,
    x: number,
    y: number,
    z: number,
  ): { setIndex: number; neighbor: () => string } | undefined {
    const facing = properties.facing;
    if (facing === undefined || !(facing in FACING_OFFSETS)) return undefined;
    const defaultFacing = this.catalog.defaultProperties(name).facing!;
    for (const [key, candidate] of Object.entries(rules)) {
      if (candidate.n === undefined) continue;
      const probedFacing = (key === "" ? undefined : parseBlockState(`probe[${key}]`).properties.facing) ?? defaultFacing;
      const rotation = (CLOCKWISE_FACINGS.indexOf(facing) - CLOCKWISE_FACINGS.indexOf(probedFacing) + 4) % 4;
      const supportFacing = CLOCKWISE_FACINGS[rotation]!; // the probe's support side (north) rotated the same way
      const [offsetX, offsetZ] = FACING_OFFSETS[supportFacing]!;
      return { setIndex: candidate.n, neighbor: () => level.getBlockState(x + offsetX, y, z + offsetZ) };
    }
    return undefined;
  }

  private passesHandPortedChecks(
    name: string,
    level: SurvivalLevel,
    x: number,
    y: number,
    z: number,
  ): boolean {
    if (name === "minecraft:cactus") {
      // CactusBlock.canSurvive: no solid block or lava beside it, and no liquid above.
      for (const [offsetX, offsetZ] of HORIZONTAL_OFFSETS) {
        const beside = this.catalog.info(level.getBlockState(x + offsetX, y, z + offsetZ));
        if (beside.isSolid || isFluidLava(beside.fluid)) return false;
      }
      return !this.catalog.info(level.getBlockState(x, y + 1, z)).isLiquid;
    }
    return true;
  }
}
