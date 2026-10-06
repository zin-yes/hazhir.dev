// What to draw this frame: the selected leaves where their meshes are ready, otherwise the closest ready stand-in for
// the same area (the four finer children kept from before a merge, or a ready coarser ancestor). Areas are never
// drawn twice, so stand-ins and the tiles they replace cannot overlap and z-fight.

import { profiler } from "../../profiler";
import { childAddressesOf, tileKeyOf, type TileAddress } from "../core/tile-address";
import { rootTilesAround, type SelectionParameters, type SelectionResult } from "./quadtree-selection";

export interface RenderSet {
  drawn: TileAddress[];
  /** Selected leaves without a ready mesh (the build queue's candidates). */
  missingLeaves: TileAddress[];
}

interface RegionCover {
  tiles: TileAddress[];
  complete: boolean;
}

export function computeRenderSet(
  selection: SelectionResult,
  selectionParameters: SelectionParameters,
  isReady: (address: TileAddress) => boolean,
): RenderSet {
  const leafKeys = new Set(selection.leaves.map((leaf) => tileKeyOf(leaf.level, leaf.tileX, leaf.tileZ)));
  const missingLeaves: TileAddress[] = [];
  let regionsCovered = 0;
  let readyLeaves = 0;
  let childStandIns = 0;
  let ancestorStandIns = 0;
  let incompleteRegions = 0;
  let unselectedRegions = 0;

  const cover = (address: TileAddress): RegionCover => {
    regionsCovered++;
    const key = tileKeyOf(address.level, address.tileX, address.tileZ);
    if (leafKeys.has(key)) {
      if (isReady(address)) {
        readyLeaves++;
        return { tiles: [address], complete: true };
      }
      missingLeaves.push(address);
      if (address.level > 0) {
        const children = childAddressesOf(address);
        if (children.every(isReady)) {
          childStandIns++;
          return { tiles: children, complete: true };
        }
      }
      incompleteRegions++;
      return { tiles: [], complete: false };
    }
    if (!selection.split.has(key)) {
      unselectedRegions++;
      return { tiles: [], complete: true };
    }
    const childCovers = childAddressesOf(address).map(cover);
    if (childCovers.every((childCover) => childCover.complete)) return { tiles: childCovers.flatMap((childCover) => childCover.tiles), complete: true };
    if (isReady(address)) {
      ancestorStandIns++;
      return { tiles: [address], complete: true };
    }
    incompleteRegions++;
    return { tiles: childCovers.flatMap((childCover) => childCover.tiles), complete: false };
  };

  const drawn: TileAddress[] = [];
  for (const root of rootTilesAround(selectionParameters)) drawn.push(...cover(root).tiles);
  if (profiler.enabled) {
    profiler.addCounter("game.lod.renderSet.regionsCovered", regionsCovered);
    profiler.addCounter("game.lod.renderSet.readyLeaves", readyLeaves);
    profiler.addCounter("game.lod.renderSet.missingLeaves", missingLeaves.length);
    profiler.addCounter("game.lod.renderSet.childStandIns", childStandIns);
    profiler.addCounter("game.lod.renderSet.ancestorStandIns", ancestorStandIns);
    profiler.addCounter("game.lod.renderSet.incompleteRegions", incompleteRegions);
    profiler.addCounter("game.lod.renderSet.unselectedRegions", unselectedRegions);
    profiler.sampleGauge("game.lod.renderSet.drawn", drawn.length);
  }
  return { drawn, missingLeaves };
}
