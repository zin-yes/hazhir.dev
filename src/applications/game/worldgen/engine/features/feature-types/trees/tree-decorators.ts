// Mirrors levelgen.feature.treedecorators: TreeDecorator.Context and the six decorator types (beehive,
// trunk_vine, leave_vine, cocoa, alter_ground, attached_to_leaves). The log, leaf and root lists come from
// HashSets in Java; JavaHashPositionSet reproduces their iteration order, then the lists are stably sorted by y.

import { LegacyRandomSource, type RandomSource } from "../../../random";
import type { BlockStateCatalog } from "../../../block-state";
import { Direction } from "../../core/direction";
import type { FeatureParser } from "../../feature/feature-parser";
import type { WorldGenLevel } from "../../level/world-gen-level";
import type { BlockStateProvider } from "../../providers/block-state-providers";
import { endFeatureStep, startFeatureStep } from "../../profiling/feature-profiling";
import { asArray, asObject, type JsonObject, type JsonValue, requireNumber, typeOf } from "../../providers/json-fields";
import type { JavaHashPositionSet, PositionEntry } from "./java-hash-position-set";
import type { TreeBlockSetter } from "./tree-placement";
import { isDirtBlock, parseTreeStateProvider } from "./tree-world";

const fround = Math.fround;

export class TreeDecoratorContext {
  readonly logs: PositionEntry[];
  readonly leaves: PositionEntry[];
  readonly roots: PositionEntry[];

  constructor(
    readonly level: WorldGenLevel,
    private readonly decorationSetter: TreeBlockSetter,
    readonly random: RandomSource,
    readonly treeOrigin: PositionEntry,
    logs: JavaHashPositionSet,
    leaves: JavaHashPositionSet,
    roots: JavaHashPositionSet,
  ) {
    this.roots = sortedByHeight(roots);
    this.logs = sortedByHeight(logs);
    this.leaves = sortedByHeight(leaves);
  }

  setBlock(x: number, y: number, z: number, state: string): boolean {
    return this.decorationSetter(x, y, z, state);
  }

  isAir(x: number, y: number, z: number): boolean {
    return this.level.getBlockInfo(x, y, z).isAir;
  }

  placeVine(x: number, y: number, z: number, faceProperty: string): void {
    this.setBlock(x, y, z, vineState(this.level.blockStates, faceProperty));
  }
}

function sortedByHeight(set: JavaHashPositionSet): PositionEntry[] {
  return set.values().sort((first, second) => first.y - second.y);
}

const vineStatesByCatalog = new WeakMap<BlockStateCatalog, Map<string, string>>();

function vineState(catalog: BlockStateCatalog, faceProperty: string): string {
  let states = vineStatesByCatalog.get(catalog);
  if (!states) {
    states = new Map();
    vineStatesByCatalog.set(catalog, states);
  }
  let state = states.get(faceProperty);
  if (!state) {
    state = catalog.withProperty(catalog.defaultState("minecraft:vine"), faceProperty, "true");
    states.set(faceProperty, state);
  }
  return state;
}

export interface TreeDecorator {
  place(context: TreeDecoratorContext): void;
}

/**
 * BeehiveDecorator shuffles its candidate positions with Collections.shuffle(list), which seeds a fresh
 * java.util.Random: vanilla picks a different nest position on every run. The port derives the shuffle seed from
 * the tree origin instead, so a world stays reproducible.
 */
export function beehiveShuffleSeed(origin: PositionEntry): bigint {
  return BigInt.asIntN(64, BigInt(origin.x) * BigInt(3129871) ^ BigInt(origin.z) * BigInt(116129781) ^ BigInt(origin.y));
}

class BeehiveDecorator implements TreeDecorator {
  constructor(private readonly probability: number) {}

  place(context: TreeDecoratorContext): void {
    const { random, leaves, logs } = context;
    if (random.nextFloat() >= this.probability) return;
    if (logs.length === 0) return;
    const nestHeight =
      leaves.length > 0
        ? Math.max(leaves[0]!.y - 1, logs[0]!.y + 1)
        : Math.min(logs[0]!.y + 1 + random.nextIntBounded(3), logs[logs.length - 1]!.y);
    const candidates: Array<{ x: number; y: number; z: number }> = [];
    for (const log of logs) {
      if (log.y !== nestHeight) continue;
      for (const direction of [Direction.EAST, Direction.SOUTH, Direction.WEST]) {
        candidates.push({ x: log.x + direction.stepX, y: log.y, z: log.z + direction.stepZ });
      }
    }
    if (candidates.length === 0) return;
    const shuffleRandom = new LegacyRandomSource(beehiveShuffleSeed(context.treeOrigin));
    for (let size = candidates.length; size > 1; size--) {
      const swapIndex = shuffleRandom.nextIntBounded(size);
      const swapped = candidates[size - 1]!;
      candidates[size - 1] = candidates[swapIndex]!;
      candidates[swapIndex] = swapped;
    }
    const nest = candidates.find((position) => context.isAir(position.x, position.y, position.z) && context.isAir(position.x, position.y, position.z + 1));
    if (!nest) return;
    const nestState = context.level.blockStates.withProperty(context.level.blockStates.defaultState("minecraft:bee_nest"), "facing", "south");
    if (!context.setBlock(nest.x, nest.y, nest.z, nestState)) return;
    // The bee nest block entity exists after a successful write; storing its bees consumes the tree random.
    const beeCount = 2 + random.nextIntBounded(2);
    for (let bee = 0; bee < beeCount; bee++) random.nextIntBounded(599);
  }
}

class TrunkVineDecorator implements TreeDecorator {
  place(context: TreeDecoratorContext): void {
    const { random } = context;
    for (const log of context.logs) {
      if (random.nextIntBounded(3) > 0 && context.isAir(log.x - 1, log.y, log.z)) context.placeVine(log.x - 1, log.y, log.z, "east");
      if (random.nextIntBounded(3) > 0 && context.isAir(log.x + 1, log.y, log.z)) context.placeVine(log.x + 1, log.y, log.z, "west");
      if (random.nextIntBounded(3) > 0 && context.isAir(log.x, log.y, log.z - 1)) context.placeVine(log.x, log.y, log.z - 1, "south");
      if (random.nextIntBounded(3) > 0 && context.isAir(log.x, log.y, log.z + 1)) context.placeVine(log.x, log.y, log.z + 1, "north");
    }
  }
}

class LeaveVineDecorator implements TreeDecorator {
  constructor(private readonly probability: number) {}

  place(context: TreeDecoratorContext): void {
    const { random } = context;
    for (const leaf of context.leaves) {
      if (random.nextFloat() < this.probability && context.isAir(leaf.x - 1, leaf.y, leaf.z)) this.addHangingVine(context, leaf.x - 1, leaf.y, leaf.z, "east");
      if (random.nextFloat() < this.probability && context.isAir(leaf.x + 1, leaf.y, leaf.z)) this.addHangingVine(context, leaf.x + 1, leaf.y, leaf.z, "west");
      if (random.nextFloat() < this.probability && context.isAir(leaf.x, leaf.y, leaf.z - 1)) this.addHangingVine(context, leaf.x, leaf.y, leaf.z - 1, "south");
      if (random.nextFloat() < this.probability && context.isAir(leaf.x, leaf.y, leaf.z + 1)) this.addHangingVine(context, leaf.x, leaf.y, leaf.z + 1, "north");
    }
  }

  private addHangingVine(context: TreeDecoratorContext, x: number, y: number, z: number, faceProperty: string): void {
    context.placeVine(x, y, z, faceProperty);
    let belowY = y - 1;
    for (let remaining = 4; context.isAir(x, belowY, z) && remaining > 0; remaining--) {
      context.placeVine(x, belowY, z, faceProperty);
      belowY--;
    }
  }
}

class CocoaDecorator implements TreeDecorator {
  constructor(private readonly probability: number) {}

  place(context: TreeDecoratorContext): void {
    const { random, level } = context;
    if (random.nextFloat() >= this.probability) return;
    const baseY = context.logs[0]!.y;
    const cocoaDefault = level.blockStates.defaultState("minecraft:cocoa");
    for (const log of context.logs) {
      if (log.y - baseY > 2) continue;
      for (const facing of Direction.HORIZONTAL) {
        const opposite = facing.opposite;
        const x = log.x + opposite.stepX;
        const z = log.z + opposite.stepZ;
        if (!(random.nextFloat() <= fround(0.25)) || !context.isAir(x, log.y, z)) continue;
        const aged = level.blockStates.withProperty(cocoaDefault, "age", String(random.nextIntBounded(3)));
        context.setBlock(x, log.y, z, level.blockStates.withProperty(aged, "facing", facing.name));
      }
    }
  }
}

class AlterGroundDecorator implements TreeDecorator {
  constructor(private readonly provider: BlockStateProvider) {}

  place(context: TreeDecoratorContext): void {
    const { roots, logs, random } = context;
    let candidates: PositionEntry[];
    if (roots.length === 0) candidates = [...logs];
    else if (logs.length > 0 && roots[0]!.y === logs[0]!.y) candidates = [...logs, ...roots];
    else candidates = [...roots];
    if (candidates.length === 0) return;
    const groundY = candidates[0]!.y;
    for (const position of candidates) {
      if (position.y !== groundY) continue;
      this.placeCircle(context, position.x - 1, position.y, position.z - 1);
      this.placeCircle(context, position.x + 2, position.y, position.z - 1);
      this.placeCircle(context, position.x - 1, position.y, position.z + 2);
      this.placeCircle(context, position.x + 2, position.y, position.z + 2);
      for (let attempt = 0; attempt < 5; attempt++) {
        const roll = random.nextIntBounded(64);
        const column = roll % 8;
        const row = Math.trunc(roll / 8);
        if (column !== 0 && column !== 7 && row !== 0 && row !== 7) continue;
        this.placeCircle(context, position.x - 3 + column, position.y, position.z - 3 + row);
      }
    }
  }

  private placeCircle(context: TreeDecoratorContext, centerX: number, y: number, centerZ: number): void {
    for (let offsetX = -2; offsetX <= 2; offsetX++) {
      for (let offsetZ = -2; offsetZ <= 2; offsetZ++) {
        if (Math.abs(offsetX) === 2 && Math.abs(offsetZ) === 2) continue;
        this.placeBlockAt(context, centerX + offsetX, y, centerZ + offsetZ);
      }
    }
  }

  private placeBlockAt(context: TreeDecoratorContext, x: number, y: number, z: number): void {
    const { level } = context;
    for (let offsetY = 2; offsetY >= -3; offsetY--) {
      const positionY = y + offsetY;
      if (isDirtBlock(level, level.getBlockInfo(x, positionY, z).name)) {
        context.setBlock(x, positionY, z, this.provider.getState(context.random, x, y, z));
        break;
      }
      if (!context.isAir(x, positionY, z) && offsetY < 0) break;
    }
  }
}

class AttachedToLeavesDecorator implements TreeDecorator {
  constructor(
    private readonly probability: number,
    private readonly exclusionRadiusXZ: number,
    private readonly exclusionRadiusY: number,
    private readonly blockProvider: BlockStateProvider,
    private readonly requiredEmptyBlocks: number,
    private readonly directions: readonly Direction[],
  ) {}

  place(context: TreeDecoratorContext): void {
    const { random } = context;
    const excluded = new Set<string>();
    const shuffledLeaves = [...context.leaves];
    for (let size = shuffledLeaves.length; size > 1; size--) {
      const swapIndex = random.nextIntBounded(size);
      const swapped = shuffledLeaves[size - 1]!;
      shuffledLeaves[size - 1] = shuffledLeaves[swapIndex]!;
      shuffledLeaves[swapIndex] = swapped;
    }
    for (const leaf of shuffledLeaves) {
      const direction = this.directions[random.nextIntBounded(this.directions.length)]!;
      const attachX = leaf.x + direction.stepX;
      const attachY = leaf.y + direction.stepY;
      const attachZ = leaf.z + direction.stepZ;
      if (excluded.has(`${attachX},${attachY},${attachZ}`) || !(random.nextFloat() < this.probability) || !this.hasRequiredEmptyBlocks(context, leaf, direction)) continue;
      for (let x = attachX - this.exclusionRadiusXZ; x <= attachX + this.exclusionRadiusXZ; x++) {
        for (let y = attachY - this.exclusionRadiusY; y <= attachY + this.exclusionRadiusY; y++) {
          for (let z = attachZ - this.exclusionRadiusXZ; z <= attachZ + this.exclusionRadiusXZ; z++) excluded.add(`${x},${y},${z}`);
        }
      }
      context.setBlock(attachX, attachY, attachZ, this.blockProvider.getState(random, attachX, attachY, attachZ));
    }
  }

  private hasRequiredEmptyBlocks(context: TreeDecoratorContext, leaf: PositionEntry, direction: Direction): boolean {
    for (let distance = 1; distance <= this.requiredEmptyBlocks; distance++) {
      if (!context.isAir(leaf.x + direction.stepX * distance, leaf.y + direction.stepY * distance, leaf.z + direction.stepZ * distance)) return false;
    }
    return true;
  }
}

function withProfiling(stepName: string, decorator: TreeDecorator): TreeDecorator {
  return {
    place(context) {
      const mark = startFeatureStep(stepName, context.level);
      decorator.place(context);
      endFeatureStep(stepName, context.level, mark);
    },
  };
}

export function parseTreeDecorator(json: JsonValue | undefined, parser: FeatureParser): TreeDecorator {
  const object = asObject(json, "tree decorator");
  const type = typeOf(object, "tree decorator");
  return withProfiling(`feature.tree.decorator.${type.slice(type.indexOf(":") + 1)}`, createTreeDecorator(object, type, parser));
}

function createTreeDecorator(object: JsonObject, type: string, parser: FeatureParser): TreeDecorator {
  switch (type) {
    case "minecraft:beehive":
      return new BeehiveDecorator(fround(requireNumber(object, "probability", type)));
    case "minecraft:trunk_vine":
      return new TrunkVineDecorator();
    case "minecraft:leave_vine":
      return new LeaveVineDecorator(fround(requireNumber(object, "probability", type)));
    case "minecraft:cocoa":
      return new CocoaDecorator(fround(requireNumber(object, "probability", type)));
    case "minecraft:alter_ground":
      return new AlterGroundDecorator(parseTreeStateProvider(parser, object.provider, `${type}.provider`));
    case "minecraft:attached_to_leaves":
      return new AttachedToLeavesDecorator(
        fround(requireNumber(object, "probability", type)),
        requireNumber(object, "exclusion_radius_xz", type),
        requireNumber(object, "exclusion_radius_y", type),
        parseTreeStateProvider(parser, object.block_provider, `${type}.block_provider`),
        requireNumber(object, "required_empty_blocks", type),
        asArray(object.directions, `${type}.directions`).map((direction) => parser.direction(direction, `${type}.directions`)),
      );
    default:
      throw new Error(`Unknown tree decorator type ${type}`);
  }
}
