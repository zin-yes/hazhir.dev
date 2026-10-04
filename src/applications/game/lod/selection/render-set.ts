// What to draw this frame: the selected leaves where their meshes are ready, otherwise the closest ready stand-in for
// the same area (the four finer children kept from before a merge, or a ready coarser ancestor). Areas are never
// drawn twice, so stand-ins and the tiles they replace cannot overlap and z-fight.

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

  const cover = (address: TileAddress): RegionCover => {
    const key = tileKeyOf(address.level, address.tileX, address.tileZ);
    if (leafKeys.has(key)) {
      if (isReady(address)) return { tiles: [address], complete: true };
      missingLeaves.push(address);
      if (address.level > 0) {
        const children = childAddressesOf(address);
        if (children.every(isReady)) return { tiles: children, complete: true };
      }
      return { tiles: [], complete: false };
    }
    if (!selection.split.has(key)) return { tiles: [], complete: true };
    const childCovers = childAddressesOf(address).map(cover);
    if (childCovers.every((childCover) => childCover.complete)) return { tiles: childCovers.flatMap((childCover) => childCover.tiles), complete: true };
    if (isReady(address)) return { tiles: [address], complete: true };
    return { tiles: childCovers.flatMap((childCover) => childCover.tiles), complete: false };
  };

  const drawn: TileAddress[] = [];
  for (const root of rootTilesAround(selectionParameters)) drawn.push(...cover(root).tiles);
  return { drawn, missingLeaves };
}
