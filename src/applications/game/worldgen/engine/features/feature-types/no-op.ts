// Mirrors NoOpFeature (minecraft:no_op): places nothing and reports success.

import { defineFeatureType } from "../feature/feature-type";

export const noOpFeature = defineFeatureType<undefined>({
  id: "minecraft:no_op",
  parseConfig: () => undefined,
  place: () => true,
});
