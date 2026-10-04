# engine/features

Biome decoration for Minecraft 1.20.6 + Terralith: feature ordering, decoration seeding, the placement modifier
engine, value/height/state providers, block predicates and the feature framework that feature types plug into.

## Public API (`index.ts`)

| Export | Mirrors |
| --- | --- |
| `FeatureDecorator` (`decorateOrigin`, `generateDecoratedColumn`, `featuresPerStep`) | `ChunkGenerator.applyBiomeDecoration`, `featuresPerStep` |
| `buildFeaturesPerStep`, `StepFeatureData` | `biome.FeatureSorter` (+ `util.Graph.depthFirstSearch`) |
| `BiomeFeatureIndex`, `possibleBiomesOfDimension`, `DECORATION_STEPS` | `BiomeGenerationSettings`, `BiomeSource.possibleBiomes`, `GenerationStep.Decoration` |
| `WorldgenRandom` (`setDecorationSeed`, `setFeatureSeed`), `createDecorationRandom` | `levelgen.WorldgenRandom` over `XoroshiroRandomSource` |
| `WorldGenLevel`, `DecorationRegion`, `BaseColumnSource` | `WorldGenLevel` / `server.level.WorldGenRegion` / `ProtoChunk` |
| `ChunkHeightmap`, `HeightmapType` | `levelgen.Heightmap` (+ `ChunkStatus` PRE/POST_FEATURES) |
| `CarvingMask` | `chunk.CarvingMask` |
| `ConfiguredFeature`, `PlacedFeature` | `feature.ConfiguredFeature`, `placement.PlacedFeature` |
| `FeatureType`, `defineFeatureType`, `FeatureTypeRegistry`, `FeaturePlaceContext` | `feature.Feature`, `FeaturePlaceContext` |
| `FeatureResolver`, `FeatureParser`, `FeatureDiagnostics` | the configured/placed feature codecs (`RegistryFileCodec`) |
| `PlacementContext`, `PlacementModifier`, `VANILLA_PLACEMENT_MODIFIER_TYPES` | `placement.*` (all 15 types) |
| `parseIntProvider`, `parseFloatProvider`, `parseHeightProvider`, `SimpleWeightedRandomList` | `util.valueproviders`, `heightproviders`, `util.random` |
| `parseBlockStateProvider`, `parseBlockPredicate` | `feature.stateproviders`, `blockpredicates` |
| `BlockPos`, `MutableBlockPos`, `Direction` | `core.BlockPos`, `core.Direction` |

Block knowledge (air, fluids, blocksMotion, isSolid, replaceable, leaves, sturdy faces, `canSurvive`) lives in
`../block-state`.

## How decoration runs on demand

The game asks for one chunk column at a time and needs a pure function of `(seed, chunk)`, so:

1. `decorateOrigin(N)` runs the vanilla step loop for origin chunk N in a `DecorationRegion`: reads see the base
   columns (terrain + surface from the `BaseColumnSource`, generated lazily, any distance) plus N's own writes;
   writes are clipped to the 3x3 chunks around N (`writeRadiusCutoff = 1`, as vanilla). Seeding, the biome set
   (biomes of the 3x3 chunks that are possible biomes), the per-step sorted feature indices and
   `placeWithBiomeCheck` at `(minBlockX, minY, minBlockZ)` are exactly `applyBiomeDecoration`.
2. `generateDecoratedColumn(C)` = base column C + the patches of the 9 origins around C, applied in raster order
   (ascending chunkZ, then chunkX; later origins win where they wrote the same block). Origin patches are cached
   (bounded LRU, `maxCachedOrigins`).

**Deviation from vanilla:** vanilla decorates a chunk on top of whatever its already-decorated neighbors wrote,
which depends on generation order. Here every origin decorates against base terrain only, so where two origins'
patches overlap the merge can differ from any vanilla order (e.g. a flower from a later origin replacing one half of
an earlier double plant, or two trees interleaving). Structures, which share the step loop in vanilla, are not
placed here.

Heightmaps follow `ProtoChunk` during FEATURES: `WORLD_SURFACE_WG` / `OCEAN_FLOOR_WG` stay as the base terrain left
them; `WORLD_SURFACE`, `OCEAN_FLOOR`, `MOTION_BLOCKING`, `MOTION_BLOCKING_NO_LEAVES` are primed lazily and updated on
every write (`Heightmap.update`). Raw brightness is always 0: protochunks are unlit until after FEATURES (confirmed
by the ground-truth fixtures, where red mushrooms stand on gravel under open sky, which `MushroomBlock.canSurvive`
only allows below brightness 13).

`createDefaultFeatureTypeRegistry()` registers the core, tree, ground, cave and surface types (`ALL_FEATURE_TYPES`; a duplicate id throws). Unregistered feature types become counted no-op features (`diagnostics.unsupportedFeatureTypes`) so decoration runs
for every biome while other feature types are still being ported; `strict: true` throws instead.

## Adding a feature type (one file per type)

1. Create `feature-types/<type>.ts` exporting a `defineFeatureType` value: `id`, `parseConfig(json, parser)` (the
   codec, using `parser.blockStateProvider`, `parser.placedFeature`, `parser.intProvider`, ...) and
   `place(context)` (the Java `place(FeaturePlaceContext)`), using `context.level` (`WorldGenLevel`),
   `context.random`, `context.origin`, `context.config`.
2. Add it to `CORE_FEATURE_TYPES` in `feature-types/index.ts`.
3. Extend the oracle: `placement/placement-oracle.test.ts` automatically compares every placed feature whose whole
   feature tree resolves with registered types against the Java writes in `fixtures/features-reference.json.gz`.
   If the Java run of your feature recorded a `placementError` (a `WorldGenLevel` method the fake Java world does
   not implement), add that method to `FakeWorld` in `fixtures/FeaturesReference.java` and regenerate.

Worked example (an illustrative type, not a vanilla one; real ports use the vanilla id and codec field names):

```ts
// feature-types/replace-exact-block.ts
import { defineFeatureType } from "../feature/feature-type";
import { asArray, asObject } from "../providers/json-fields";

export const replaceExactBlockFeature = defineFeatureType<{ targets: Array<{ target: string; state: string }> }>({
  id: "example:replace_exact_block",
  parseConfig(json, parser) {
    const config = asObject(json, "replace_exact_block config");
    return {
      targets: asArray(config.targets, "targets").map((entry) => {
        const target = asObject(entry, "target");
        return { target: parser.blockState(target.target), state: parser.blockState(target.state) };
      }),
    };
  },
  place({ level, origin, config }) {
    const current = level.getBlockState(origin.x, origin.y, origin.z);
    for (const { target, state } of config.targets) {
      if (current === target) {
        level.setBlock(origin.x, origin.y, origin.z, state, 2);
        return true;
      }
    }
    return false;
  },
});
```

## Verification

- `fixtures/FeaturesReference.java` records from the real 1.20.6 classes (seed 1337, Terralith): WorldgenRandom
  seeds and draws for chunk (3, -7) at indices 0/5/200 in every step, `FeatureSorter` output for the real biome set,
  `BIOME_INFO_NOISE` and legacy-seeded `NormalNoise` samples, and every biome-listed placed feature run on a
  synthetic world (`testing/synthetic-world.ts` mirrors its terrain): modifier positions and final writes. It also
  writes `../block-state/fixtures/block-state-reference.json.gz`. Build and run instructions are in its header.
- Tests: `core/worldgen-random.test.ts`, `decoration/feature-sorter.test.ts`, `providers/noise-sources.test.ts`,
  `placement/placement-oracle.test.ts` (all modifier types except carving_mask, plus the core feature types),
  `placement/carving-mask-placement.test.ts`, `decoration/feature-decorator.test.ts` (end to end on synthetic
  columns with the real biome feature lists, purity, clipping, heightmaps).
