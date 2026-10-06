// Runtime wrapper around toGameBlock: a block name the tables do not know becomes air instead of throwing, so one
// unmapped decoration block can never fail chunk generation. Every distinct unknown state is remembered and warned
// about once, which makes gaps in the tables visible in the worker console and the profiler counters.

import { BlockType } from "../../../blocks";
import { defineHotCounter, noteHot } from "../profiling/hot-counters";
import { toGameBlock } from "./minecraft-block-map";

const LENIENT_CACHE_HITS = defineHotCounter("lenientBlockMap.cacheHits");
const LENIENT_LOOKUPS = defineHotCounter("lenientBlockMap.lookups");
const LENIENT_UNKNOWN_STATES = defineHotCounter("lenientBlockMap.unknownStates");

export interface LenientBlockLookup {
  readonly gameBlock: BlockType;
  readonly isUnknown: boolean;
}

const lookupByBlockState = new Map<string, LenientBlockLookup>();
const unknownBlockStates = new Set<string>();

export function toGameBlockOrAir(blockState: string): LenientBlockLookup {
  let lookup = lookupByBlockState.get(blockState);
  if (lookup === undefined) {
    noteHot(LENIENT_LOOKUPS);
    try {
      lookup = { gameBlock: toGameBlock(blockState), isUnknown: false };
    } catch {
      lookup = { gameBlock: BlockType.AIR, isUnknown: true };
      noteHot(LENIENT_UNKNOWN_STATES);
      unknownBlockStates.add(blockState);
      console.warn(`[worldgen] no game block for "${blockState}", using air`);
    }
    lookupByBlockState.set(blockState, lookup);
  } else {
    noteHot(LENIENT_CACHE_HITS);
  }
  return lookup;
}

/** Distinct unknown block states seen so far on this thread (empty when the tables cover everything generated). */
export function getUnknownBlockStates(): ReadonlySet<string> {
  return unknownBlockStates;
}
