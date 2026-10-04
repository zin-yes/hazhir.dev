// Port of OreVeinifier (Minecraft 1.20.6): large copper (y 0..50) and iron (y -60..-8) veins carved out of solid
// terrain. vein_toggle picks the vein type by sign and the vein core by magnitude, vein_ridged thins it into ribbons,
// vein_gap leaves holes. Veins are raw ore blocks (2%), ore, or the granite / tuff filler. Returns a terrain symbol,
// or NO_VEIN where the block is not part of a vein.

import type { FunctionContext } from "../density/density-function";
import type { DensityNode } from "../density/density-function";
import type { PositionalRandomFactory } from "../random";
import { transientRandomAt } from "../random/xoroshiro-random-source";
import {
  BLOCK_COPPER_ORE,
  BLOCK_DEEPSLATE_IRON_ORE,
  BLOCK_GRANITE,
  BLOCK_RAW_COPPER_BLOCK,
  BLOCK_RAW_IRON_BLOCK,
  BLOCK_TUFF,
} from "./terrain-blocks";

export const NO_VEIN = -1;

const VEININESS_THRESHOLD = Math.fround(0.4);
const EDGE_ROUNDOFF_BEGIN = 20;
const MAX_EDGE_ROUNDOFF = 0.2;
const VEIN_SOLIDNESS = Math.fround(0.7);
const MIN_RICHNESS = Math.fround(0.1);
const MAX_RICHNESS = Math.fround(0.3);
const MAX_RICHNESS_THRESHOLD = Math.fround(0.6);
const CHANCE_OF_RAW_ORE_BLOCK = Math.fround(0.02);
const SKIP_ORE_IF_GAP_NOISE_IS_BELOW = Math.fround(-0.3);

interface VeinType {
  ore: number;
  rawOreBlock: number;
  filler: number;
  minY: number;
  maxY: number;
}

const COPPER_VEIN: VeinType = { ore: BLOCK_COPPER_ORE, rawOreBlock: BLOCK_RAW_COPPER_BLOCK, filler: BLOCK_GRANITE, minY: 0, maxY: 50 };
const IRON_VEIN: VeinType = { ore: BLOCK_DEEPSLATE_IRON_ORE, rawOreBlock: BLOCK_RAW_IRON_BLOCK, filler: BLOCK_TUFF, minY: -60, maxY: -8 };

function clampedMap(value: number, fromStart: number, fromEnd: number, toStart: number, toEnd: number): number {
  const delta = (value - fromStart) / (fromEnd - fromStart);
  if (delta < 0) return toStart;
  if (delta > 1) return toEnd;
  return toStart + delta * (toEnd - toStart);
}


export class OreVeinifier {

  constructor(
    private readonly veinToggle: DensityNode,
    private readonly veinRidged: DensityNode,
    private readonly veinGap: DensityNode,
    private readonly positionalRandomFactory: PositionalRandomFactory,
  ) {}

  /** False where compute is NO_VEIN whatever the noise (outside both vein height ranges). */
  mayHoldVeinAt(blockY: number): boolean {
    return blockY <= COPPER_VEIN.maxY && blockY >= IRON_VEIN.minY;
  }

  /** The BlockStateFiller of OreVeinifier.create: the vein block at the context's position, or NO_VEIN. */
  compute(context: FunctionContext): number {
    return this.computeVein(context);
  }

  private computeVein(context: FunctionContext): number {
    const blockY = context.blockY;
    // Outside both vein height ranges the answer is NO_VEIN whatever the toggle (an interpolated read, no side effects).
    if (blockY > COPPER_VEIN.maxY || blockY < IRON_VEIN.minY) return NO_VEIN;
    const toggle = this.veinToggle.compute(context);
    const vein = toggle > 0 ? COPPER_VEIN : IRON_VEIN;
    const magnitude = Math.abs(toggle);
    const distanceToTop = vein.maxY - blockY;
    const distanceToBottom = blockY - vein.minY;
    if (distanceToBottom < 0 || distanceToTop < 0) return NO_VEIN;
    const distanceToEdge = Math.min(distanceToTop, distanceToBottom);
    const edgeRoundoff = clampedMap(distanceToEdge, 0, EDGE_ROUNDOFF_BEGIN, -MAX_EDGE_ROUNDOFF, 0);
    if (magnitude + edgeRoundoff < VEININESS_THRESHOLD) return NO_VEIN;
    const random = transientRandomAt(this.positionalRandomFactory, context.blockX, blockY, context.blockZ);
    if (random.nextFloat() > VEIN_SOLIDNESS) return NO_VEIN;
    if (this.veinRidged.compute(context) >= 0) return NO_VEIN;
    const richness = clampedMap(magnitude, VEININESS_THRESHOLD, MAX_RICHNESS_THRESHOLD, MIN_RICHNESS, MAX_RICHNESS);
    if (random.nextFloat() < richness && this.veinGap.compute(context) > SKIP_ORE_IF_GAP_NOISE_IS_BELOW) {
      return random.nextFloat() < CHANCE_OF_RAW_ORE_BLOCK ? vein.rawOreBlock : vein.ore;
    }
    return vein.filler;
  }
}
