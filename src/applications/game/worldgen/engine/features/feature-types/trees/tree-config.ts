// TreeConfiguration.CODEC: trunk/foliage providers and placers, optional root placer, dirt provider, minimum size,
// decorators and the ignore_vines / force_dirt flags (both default to false).

import type { FeatureParser } from "../../feature/feature-parser";
import { asArray, asObject, type JsonValue, optionalBoolean } from "../../providers/json-fields";
import { parseFeatureSize } from "./feature-size";
import { parseFoliagePlacer } from "./foliage-placers";
import { parseRootPlacer } from "./root-placers";
import { parseTreeDecorator } from "./tree-decorators";
import type { TreeConfig } from "./tree-placement";
import { parseTrunkPlacer } from "./trunk-placers";
import { parseTreeStateProvider } from "./tree-world";

export function parseTreeConfig(json: JsonValue | undefined, parser: FeatureParser): TreeConfig {
  const config = asObject(json, "tree config");
  return {
    trunkProvider: parseTreeStateProvider(parser, config.trunk_provider, "tree.trunk_provider"),
    trunkPlacer: parseTrunkPlacer(config.trunk_placer, parser),
    foliageProvider: parseTreeStateProvider(parser, config.foliage_provider, "tree.foliage_provider"),
    foliagePlacer: parseFoliagePlacer(config.foliage_placer, parser),
    rootPlacer: config.root_placer === undefined ? undefined : parseRootPlacer(config.root_placer, parser),
    dirtProvider: parseTreeStateProvider(parser, config.dirt_provider, "tree.dirt_provider"),
    minimumSize: parseFeatureSize(config.minimum_size, parser),
    decorators: asArray(config.decorators, "tree.decorators").map((decorator) => parseTreeDecorator(decorator, parser)),
    ignoreVines: optionalBoolean(config, "ignore_vines", false),
    forceDirt: optionalBoolean(config, "force_dirt", false),
  };
}
