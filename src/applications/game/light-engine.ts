import {
  type BulkEditPhase,
  type BulkEditStats,
  relightAfterSingleBlockWritten,
} from "./edits/apply-block-edits";
import type { ChunkCoordinate, LightChunkSource } from "./edits/chunk-cluster";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";

export type { ChunkCoordinate, LightChunkSource };

/**
 * Incremental light update for a single block edit.
 *
 * Light is stored per block as (sky << 4) | block. Both channels are the closure
 * of a flood fill: light loses one level per step through transparent blocks,
 * except full sky light (15) which falls straight down without losing any. An
 * edit only disturbs the cells whose light flowed through (or came from) the
 * edited block, so it removes exactly those, then refills from whatever light is
 * left around the hole. That is a few thousand cells at most, instead of
 * recomputing every chunk within reach.
 *
 * This is the one-block case of the bulk edit engine in ./edits, which relights
 * a whole batch of edits (brushes, spheres) with the same removal and refill
 * passes.
 */

export interface RelightStats {
  cellsRemoved: number;
  cellsLit: number;
  cellsVisited: number;
}

export interface RelightResult {
  /**
   * Chunks whose mesh has to be rebuilt: the chunk holding the edit and every
   * chunk that has a changed light or block value in it or in the layer next to it.
   */
  chunksToRemesh: ChunkCoordinate[];
  stats: RelightStats;
}

const PROFILER_PHASE_KEYS: { [phase in BulkEditPhase]?: string } = {
  writeBlocks: "engine.writeBlocks",
  seedLightChanges: "engine.seedChanges",
  collectChunks: "engine.collectChunks",
  removeSkyLight: "engine.removeSky",
  removeBlockLight: "engine.removeBlock",
  refillLight: "engine.spreadLight",
};

const PROFILER_PHASE_NAMES: { [phase in BulkEditPhase]?: string } = {
  writeBlocks: "main.light.relight.writeBlocks",
  seedLightChanges: "main.light.relight.seedChanges",
  collectChunks: "main.light.relight.collectChunks",
  removeSkyLight: "main.light.relight.removeLight",
  removeBlockLight: "main.light.relight.removeLight",
  refillLight: "main.light.relight.spreadLight",
};

let openProfilerToken = 0;

/** onPhase for applyBlockEdits on the main thread: each light phase becomes a profiler scope. */
export function trackLightPhaseInProfiler(phase: BulkEditPhase, hasStarted: boolean) {
  const name = PROFILER_PHASE_NAMES[phase];
  if (!name) return;
  if (hasStarted) {
    openProfilerToken = profiler.begin(
      name,
      DIMENSIONS.lightKind,
      PROFILER_PHASE_KEYS[phase],
    );
  } else {
    profiler.end(openProfilerToken);
  }
}

/**
 * Counters for the work one bulk edit did, on top of the cell counters the
 * caller records. Call with the stats of a finished applyBlockEdits.
 */
export function recordBulkEditStats(stats: BulkEditStats) {
  if (!profiler.enabled) return;
  profiler.addCounter("game.light.editsRequested", stats.editsRequested);
  profiler.addCounter("game.light.blocksChanged", stats.blocksChanged);
  profiler.addCounter("game.light.editsInUnloadedChunks", stats.editsInUnloadedChunks);
  profiler.addCounter("game.light.editsSkippedByReplaceRule", stats.editsSkippedByReplaceRule);
  profiler.addCounter("game.light.chunksTouched", stats.chunksTouched);
  profiler.sampleGauge("game.light.cellsVisitedPerEdit", stats.cellsVisited, "cells");
}

/**
 * Brings the light around (x, y, z) back in line after the block there changed
 * from oldBlock to whatever the chunk holds now. The chunk data must already
 * contain the new block. Chunks that are not loaded are left alone.
 */
export function relightAfterBlockChange(
  source: LightChunkSource,
  x: number,
  y: number,
  z: number,
  oldBlock: number,
): RelightResult {
  const result = relightAfterSingleBlockWritten(source, x, y, z, oldBlock, {
    onPhase: profiler.enabled ? trackLightPhaseInProfiler : undefined,
  });
  const { cellsRemoved, cellsLit, cellsVisited } = result.stats;
  if (profiler.enabled) {
    profiler.addCounter("game.light.singleBlockRelights");
    profiler.addCounter("game.light.cellsVisited", cellsVisited);
    profiler.addCounter("game.light.cellsRemoved", cellsRemoved);
    profiler.addCounter("game.light.cellsLit", cellsLit);
    profiler.addCounter("game.light.chunksToRemesh", result.chunksToRemesh.length);
  }
  return {
    chunksToRemesh: result.chunksToRemesh,
    stats: { cellsRemoved, cellsLit, cellsVisited },
  };
}
