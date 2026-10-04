// The chunk-independent half of NoiseChunk's wiring pass, computed once per router. NoiseChunk.wrapNew unwraps
// every HolderHolder (which lets TwoArgumentSimpleFunction.create fold constants into MulOrAdd) and swaps
// BeardifierMarker for the structure Beardifier (infinite bounds); markers are kept here and only turned into
// per-chunk caches by NoiseChunk. Structurally equal markers are merged, like Java's HashMap over records.

import { type DensityNode, MemoizingDensityVisitor } from "../density/density-function";
import { createTwoArgument } from "../density/nodes/two-argument-nodes";
import { BeardifierNode, HolderNode, MarkerNode } from "../density/nodes/structural-nodes";
import { NOISE_ROUTER_FIELDS, type NoiseRouter } from "../density/router-wiring";

class NoiseChunkTemplateVisitor extends MemoizingDensityVisitor {
  protected wrapNew(node: DensityNode): DensityNode {
    if (node instanceof HolderNode) return node.target;
    if (node instanceof BeardifierNode && !node.insideNoiseChunk) return new BeardifierNode(true);
    return node;
  }
}

export class NoiseChunkTemplate {
  readonly router = {} as NoiseRouter;
  readonly fieldOrder: readonly (keyof NoiseRouter)[] = NOISE_ROUTER_FIELDS.map(([fieldName]) => fieldName);
  readonly finalDensityForFill: DensityNode;
  private readonly containsMarkerByNode = new Map<DensityNode, boolean>();

  constructor(routerSource: NoiseRouter) {
    const visitor = new NoiseChunkTemplateVisitor();
    for (const fieldName of this.fieldOrder) this.router[fieldName] = visitor.map(routerSource[fieldName]);
    this.finalDensityForFill = new MarkerNode(
      "cache_all_in_cell",
      createTwoArgument("add", this.router.finalDensity, new BeardifierNode(true)),
    );
  }

  /** True when the subtree holds a marker, i.e. it needs per-chunk state; other subtrees are shared stateless. */
  containsMarker(node: DensityNode): boolean {
    const known = this.containsMarkerByNode.get(node);
    if (known !== undefined) return known;
    let result = node instanceof MarkerNode;
    if (!result) {
      for (const child of node.children()) {
        if (this.containsMarker(child)) {
          result = true;
          break;
        }
      }
    }
    this.containsMarkerByNode.set(node, result);
    return result;
  }
}

const templatesByRouter = new WeakMap<NoiseRouter, NoiseChunkTemplate>();

export function getNoiseChunkTemplate(router: NoiseRouter): NoiseChunkTemplate {
  let template = templatesByRouter.get(router);
  if (template === undefined) {
    template = new NoiseChunkTemplate(router);
    templatesByRouter.set(router, template);
  }
  return template;
}
