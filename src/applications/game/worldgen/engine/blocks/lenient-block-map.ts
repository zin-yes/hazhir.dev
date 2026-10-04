// Runtime wrapper around toGameBlock: a block name the tables do not know becomes air instead of throwing, so one
// unmapped decoration block can never fail chunk generation. Every distinct unknown state is remembered and warned
// about once, which makes gaps in the tables visible in the worker console and the profiler counters.

import { BlockType } from "../../../blocks";
import { toGameBlock } from "./minecraft-block-map";

export interface LenientBlockLookup {
  readonly gameBlock: BlockType;
  readonly isUnknown: boolean;
}

const lookupByBlockState = new Map<string, LenientBlockLookup>();
const unknownBlockStates = new Set<string>();

export function toGameBlockOrAir(blockState: string): LenientBlockLookup {
  let lookup = lookupByBlockState.get(blockState);
  if (lookup === undefined) {
    try {
      lookup = { gameBlock: toGameBlock(blockState), isUnknown: false };
    } catch {
      lookup = { gameBlock: BlockType.AIR, isUnknown: true };
      unknownBlockStates.add(blockState);
      console.warn(`[worldgen] no game block for "${blockState}", using air`);
    }
    lookupByBlockState.set(blockState, lookup);
  }
  return lookup;
}

/** Distinct unknown block states seen so far on this thread (empty when the tables cover everything generated). */
export function getUnknownBlockStates(): ReadonlySet<string> {
  return unknownBlockStates;
}
