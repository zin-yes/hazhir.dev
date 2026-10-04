// Mirrors CoralFeature, the shared base of minecraft:coral_tree, coral_claw and coral_mushroom: pick a random coral
// block from the coral_blocks tag, then let the subclass shape it with placeCoralBlock.

import type { BlockTagIndex } from "../../../block-state";
import type { RandomSource } from "../../../random";
import { Direction } from "../../core/direction";
import { defineFeatureType, type FeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";

const fround = Math.fround;
const COLUMN_CHANCE = fround(0.25);
const SEA_PICKLE_CHANCE = fround(0.05);
const WALL_CORAL_CHANCE = fround(0.2);

const orderedMembersByIndex = new WeakMap<BlockTagIndex, Map<string, readonly string[]>>();

/** HolderSet.Named contents, in tag order (the flattened tag keeps first occurrence order). */
function orderedTagMembers(level: WorldGenLevel, tagId: string): readonly string[] {
  let byTag = orderedMembersByIndex.get(level.blockTags);
  if (!byTag) {
    byTag = new Map();
    orderedMembersByIndex.set(level.blockTags, byTag);
  }
  let members = byTag.get(tagId);
  if (!members) {
    members = [...level.blockTags.members(tagId)];
    byTag.set(tagId, members);
  }
  return members;
}

/** Registry.getRandomElementOf(tag, random): one nextInt(size) draw, nothing when the tag is empty. */
function randomBlockOfTag(level: WorldGenLevel, tagId: string, random: RandomSource): string | undefined {
  const members = orderedTagMembers(level, tagId);
  if (members.length === 0) return undefined;
  return members[random.nextIntBounded(members.length)];
}

/** CoralFeature.placeCoralBlock: true when the coral block was placed (with its decorations). */
export function placeCoralBlock(level: WorldGenLevel, random: RandomSource, x: number, y: number, z: number, coralBlockState: string): boolean {
  const current = level.getBlockInfo(x, y, z);
  const currentIsWaterOrCoral = current.name === "minecraft:water" || level.blockTags.is(current.name, "minecraft:corals");
  if (!currentIsWaterOrCoral || level.getBlockInfo(x, y + 1, z).name !== "minecraft:water") return false;
  level.setBlock(x, y, z, coralBlockState, 3);
  if (random.nextFloat() < COLUMN_CHANCE) {
    const coral = randomBlockOfTag(level, "minecraft:corals", random);
    if (coral !== undefined) level.setBlock(x, y + 1, z, level.blockStates.defaultState(coral), 2);
  } else if (random.nextFloat() < SEA_PICKLE_CHANCE) {
    const pickles = random.nextIntBounded(4) + 1;
    level.setBlock(x, y + 1, z, level.blockStates.withProperty(level.blockStates.defaultState("minecraft:sea_pickle"), "pickles", String(pickles)), 2);
  }
  for (const direction of Direction.HORIZONTAL) {
    const wallX = x + direction.stepX;
    const wallZ = z + direction.stepZ;
    if (!(random.nextFloat() < WALL_CORAL_CHANCE) || level.getBlockInfo(wallX, y, wallZ).name !== "minecraft:water") continue;
    const wallCoral = randomBlockOfTag(level, "minecraft:wall_corals", random);
    if (wallCoral === undefined) continue;
    let wallState = level.blockStates.defaultState(wallCoral);
    if (level.blockStates.hasProperty(wallState, "facing")) wallState = level.blockStates.withProperty(wallState, "facing", direction.name);
    level.setBlock(wallX, y, wallZ, wallState, 2);
  }
  return true;
}

export function defineCoralFeatureType(id: string, placeFeature: (level: WorldGenLevel, random: RandomSource, x: number, y: number, z: number, coralBlockState: string) => boolean): FeatureType<undefined> {
  return defineFeatureType<undefined>({
    id,
    parseConfig: () => undefined,
    place({ level, random, origin }) {
      const coralBlock = randomBlockOfTag(level, "minecraft:coral_blocks", random);
      if (coralBlock === undefined) return false;
      return placeFeature(level, random, origin.x, origin.y, origin.z, level.blockStates.defaultState(coralBlock));
    },
  });
}
