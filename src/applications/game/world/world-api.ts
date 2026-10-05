// Scriptable surface of the live world for the console, Playwright and the upcoming brush tools:
// window.__voxelWorld while a game is mounted.

import type { BlockEdit, BlockPosition, BrushMode } from "../edits/block-edit-batch";
import type { PipelineEditResult } from "./chunk-pipeline";
import type { LodStats } from "../lod/manager/lod-stats";
import type { RenderSettings } from "./render-settings";
import type { BrushSettings } from "../brush/sphere-brush";

export interface WorldEditSummary {
  blocksChanged: number;
  chunksRebuilt: number;
  /** Main-thread milliseconds spent writing blocks and relighting. */
  relightMilliseconds: number;
  /** Milliseconds from the call until every rebuilt chunk was on screen. */
  onScreenMilliseconds: number;
}

export interface VoxelWorldApi {
  applyBlockBatch(edits: ArrayLike<BlockEdit>): Promise<WorldEditSummary | null>;
  applySphere(center: BlockPosition, radius: number, block: number, mode?: BrushMode): Promise<WorldEditSummary | null>;
  getRenderSettings(): RenderSettings;
  setRenderSettings(settings: Partial<RenderSettings>): RenderSettings;
  /** Counts, queue sizes and memory of the chunk pipeline, or null before a world is loaded. */
  stats(): Record<string, number> | null;
  /** Turns the sphere brush on or off and sets its radius (1..64). */
  setBrush(settings: Partial<BrushSettings>): BrushSettings;
  /** The brush settings and the summary of its last finished sphere. */
  getBrush(): BrushSettings & { lastEdit: WorldEditSummary | null };
  /** Far terrain (LOD) tiles, builds, cache and timings, or null while it is off. */
  lodStats(): LodStats | null;
  getBlock(x: number, y: number, z: number): number | null;
  /** Moves the camera (and player); yaw and pitch in radians. */
  setCamera(position: BlockPosition, yaw: number, pitch: number): void;
  getCamera(): { position: BlockPosition; yaw: number; pitch: number };
  /** Runs the simulation without pointer lock (true) or pauses it, flying or walking. */
  setPlaying(playing: boolean, flying?: boolean): void;
  /** Jumps the sky clock: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  setTimeOfDay(timeOfDay: number): void;
}

declare global {
  interface Window {
    __voxelWorld?: VoxelWorldApi;
  }
}

/** Waits for the rebuilt meshes of an edit and sums it up. */
export async function summarizeEdit(
  result: PipelineEditResult | null,
  startedAtMs: number,
): Promise<WorldEditSummary | null> {
  if (!result) return null;
  await Promise.all(result.meshesApplied);
  const { stats } = result;
  return {
    blocksChanged: stats.blocksChanged,
    chunksRebuilt: result.chunksToRemesh.length,
    relightMilliseconds:
      stats.millisecondsWritingBlocks + stats.millisecondsRemovingLight + stats.millisecondsRefillingLight +
      stats.millisecondsCollecting,
    onScreenMilliseconds: performance.now() - startedAtMs,
  };
}

export function installVoxelWorldApi(api: VoxelWorldApi): () => void {
  window.__voxelWorld = api;
  return () => {
    if (window.__voxelWorld === api) delete window.__voxelWorld;
  };
}
