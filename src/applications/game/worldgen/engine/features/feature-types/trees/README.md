# feature-types/trees

Feature types for trees, ported from the 1.20.6 classes: `minecraft:tree` (`TreeFeature`), `minecraft:root_system`
(`RootSystemFeature`, azalea), `minecraft:huge_red_mushroom` and `minecraft:huge_brown_mushroom`.
`TREE_FEATURE_TYPES` (in `index.ts`) is the list to add to the feature type registry.

| Part | Files | Mirrors |
| --- | --- | --- |
| tree feature, config | `tree-feature.ts`, `tree-config.ts`, `feature-size.ts` | `TreeFeature`, `TreeConfiguration`, `TwoLayersFeatureSize`, `ThreeLayersFeatureSize` |
| trunk placers (9) | `trunk-placers/` | straight, forking, giant, mega_jungle, dark_oak, fancy, bending, upwards_branching, cherry |
| foliage placers (11) | `foliage-placer.ts`, `foliage-placers.ts` | blob, spruce, pine, acacia, bush, fancy, jungle, mega_pine, dark_oak, random_spread, cherry |
| root placers | `root-placers.ts` | `RootPlacer`, `MangroveRootPlacer` |
| tree decorators (6) | `tree-decorators.ts` | beehive, trunk_vine, leave_vine, cocoa, alter_ground, attached_to_leaves |
| after the tree | `tree-post-processing.ts`, `voxel-shape.ts` | `TreeFeature.updateLeaves`, `StructureTemplate.updateShapeAtEdge` |
| root system, mushrooms | `root-system.ts`, `huge-mushroom.ts` | `RootSystemFeature`, `AbstractHugeMushroomFeature` |

## Things that are easy to get wrong

- Logs, leaves and roots are `HashSet<BlockPos>`s in Java and the decorators walk them in iteration order, so
  `java-hash-position-set.ts` reproduces `java.util.HashSet` order (resizes, tree bins, iterator removal).
- Trees finish with the leaf `distance` update and neighbor updates along the tree's faces. Plants, torches, carpets
  and vines next to the tree can disappear there; `block-behavior.generated.ts` (from the real classes) says which
  blocks do and from which directions, survival comes from `SurvivalRules`, vines and double plants are ported by hand.
- The beehive decorator shuffles with an unseeded `java.util.Random` in vanilla (a different nest position on every
  run); here the seed derives from the tree origin. Bee nests also consume the tree random for their bees.
- `BlockState.CODEC` ignores properties a block does not have (Terralith writes `snowy` on moss_block); tree
  providers drop them (`parseTreeStateProvider`).

## Verification

`fixtures/TreesReference.java` runs every tree-like configured feature (216 vanilla + Terralith) at 6-9 origins each
on a synthetic world through the real classes and records every accepted block write in order, the result and the
random state afterwards (`fixtures/trees-reference.json.gz`); it also records `java.util.HashSet` order scenarios and
`fixtures/block-behavior-reference.json.gz` (`isSolidRender`, update-shape removals). Build and run instructions are
in its header; after re-recording the block tables run `generate-block-behavior-table.node.ts`.

- `trees.oracle.test.ts`: all runs match exactly (writes, order, random state); the synthetic world is
  `trees-test-world.ts` (keep it identical to the Java one).
- `java-hash-position-set.test.ts`: HashSet order after random, disc and anti-diagonal add / remove / pop sequences.
- `trees.config.test.ts`: every config parses strictly, placer and decorator coverage, `toGameBlock` accepts every
  placed block (except cocoa pods, which the block map lacks).
- `trees.fixtures.integration.test.ts` (`RUN_INTEGRATION=1`): leaf and log counts through the whole decoration path
  against the ground-truth server chunks. Vanilla decorates on top of neighbors' trees, here every origin sees only
  base terrain, so dense forests come out about 15-20% fuller; chunks without overlapping trees match exactly.
