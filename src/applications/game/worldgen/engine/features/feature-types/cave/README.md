# feature-types/cave

Cave and ore feature types: `minecraft:ore`, `scattered_ore`, `geode`, `dripstone_cluster`, `large_dripstone`,
`pointed_dripstone`, `underwater_magma`, `netherrack_replace_blobs`, `lake`, plus no-ops for `fossil` and
`monster_room` (they need structure templates / block entities). Exported as `CAVE_FEATURE_TYPES` from `index.ts`.

Each file mirrors the Java class named in its header (decompiled from the 1.20.6 server jar). `fixtures/CaveReference.java`
runs the real classes on the layered world in `testing/cave-world.ts` and records `fixtures/cave-reference.json.gz`;
`cave-oracle.test.ts` compares return values, final block writes and random state exactly.
