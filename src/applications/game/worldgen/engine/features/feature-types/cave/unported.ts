// Feature types that are registered but intentionally place nothing.
//   minecraft:fossil: places structure templates (fossil/spine_N.nbt, skull_N.nbt and their coal overlays) that this
//     engine has no copy of; the Java placement also depends on template sizes for its random draws, so it cannot be
//     mirrored without them.
//   minecraft:monster_room: places a dungeon whose chests and spawner are block entities; deliberately skipped.
// Each feature draws from its own feature seed, so skipping one never changes what another feature places.

import { defineFeatureType } from "../../feature/feature-type";

export const fossilFeature = defineFeatureType<undefined>({
  id: "minecraft:fossil",
  parseConfig: () => undefined,
  place: () => false,
});

export const monsterRoomFeature = defineFeatureType<undefined>({
  id: "minecraft:monster_room",
  parseConfig: () => undefined,
  place: () => false,
});
