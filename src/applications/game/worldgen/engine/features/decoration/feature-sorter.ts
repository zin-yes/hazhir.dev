// Mirrors net.minecraft.world.level.biome.FeatureSorter.buildFeaturesPerStep: one global, topologically sorted
// feature list per generation step across all possible biomes, so every biome's per-step order is respected and
// each placed feature gets a stable index (the index setFeatureSeed mixes into the decoration seed).
// Java keys the graph by FeatureData(featureIndex, step) in TreeMaps ordered by (step, featureIndex) and walks it
// with util.Graph.depthFirstSearch; the same orderings are reproduced here with sorted arrays.

export interface StepFeatureData {
  /** Placed feature keys in decoration order for this step. */
  readonly features: readonly string[];
  /** Placed feature key -> index in `features` (Util.createIndexIdentityLookup). */
  readonly indexOf: ReadonlyMap<string, number>;
}

/** Per biome: one list of placed feature keys per generation step (BiomeGenerationSettings.features()). */
export type FeaturesPerStepOf<Biome> = (biome: Biome) => ReadonlyArray<readonly string[]>;

interface FeatureNode {
  readonly featureIndex: number;
  readonly step: number;
  readonly featureKey: string;
}

function compareNodes(first: FeatureNode, second: FeatureNode): number {
  return first.step - second.step || first.featureIndex - second.featureIndex;
}

function nodeKey(node: FeatureNode): number {
  // Steps are < 64 and feature indices < 2^24 in any datapack, so this orders like compareNodes.
  return node.step * 0x1000000 + node.featureIndex;
}

export class FeatureOrderCycleError extends Error {}

export function buildFeaturesPerStep<Biome>(biomes: readonly Biome[], featuresOf: FeaturesPerStepOf<Biome>): StepFeatureData[] {
  const featureIndexByKey = new Map<string, number>();
  const nodesByKey = new Map<number, FeatureNode>();
  const successorsByKey = new Map<number, Map<number, FeatureNode>>();
  let stepCount = 0;

  for (const biome of biomes) {
    const steps = featuresOf(biome);
    stepCount = Math.max(stepCount, steps.length);
    const biomeNodes: FeatureNode[] = [];
    for (let step = 0; step < steps.length; step++) {
      for (const featureKey of steps[step]!) {
        let featureIndex = featureIndexByKey.get(featureKey);
        if (featureIndex === undefined) {
          featureIndex = featureIndexByKey.size;
          featureIndexByKey.set(featureKey, featureIndex);
        }
        biomeNodes.push({ featureIndex, step, featureKey });
      }
    }
    for (let position = 0; position < biomeNodes.length; position++) {
      const node = biomeNodes[position]!;
      const key = nodeKey(node);
      if (!nodesByKey.has(key)) nodesByKey.set(key, node);
      let successors = successorsByKey.get(key);
      if (!successors) {
        successors = new Map();
        successorsByKey.set(key, successors);
      }
      if (position < biomeNodes.length - 1) {
        const next = biomeNodes[position + 1]!;
        successors.set(nodeKey(next), nodesByKey.get(nodeKey(next)) ?? next);
      }
    }
  }

  const sortedSuccessors = new Map<number, FeatureNode[]>();
  for (const [key, successors] of successorsByKey) sortedSuccessors.set(key, [...successors.values()].sort(compareNodes));

  const finished = new Set<number>();
  const inProgress = new Set<number>();
  const order: FeatureNode[] = [];
  /** util.Graph.depthFirstSearch: true when a cycle is found. */
  const depthFirstSearch = (node: FeatureNode): boolean => {
    const key = nodeKey(node);
    if (finished.has(key)) return false;
    if (inProgress.has(key)) return true;
    inProgress.add(key);
    for (const successor of sortedSuccessors.get(key) ?? []) {
      if (depthFirstSearch(successor)) return true;
    }
    inProgress.delete(key);
    finished.add(key);
    order.push(node);
    return false;
  };

  const roots = [...nodesByKey.values()].sort(compareNodes);
  for (const root of roots) {
    if (finished.has(nodeKey(root))) continue;
    if (depthFirstSearch(root)) throw new FeatureOrderCycleError(`Feature order cycle found involving ${root.featureKey}`);
  }
  order.reverse();

  const result: StepFeatureData[] = [];
  for (let step = 0; step < stepCount; step++) {
    const features = order.filter((node) => node.step === step).map((node) => node.featureKey);
    result.push({ features, indexOf: new Map(features.map((featureKey, index) => [featureKey, index])) });
  }
  return result;
}
