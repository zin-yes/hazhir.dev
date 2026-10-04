// Mirrors net.minecraft.world.level.chunk.CarvingMask: one bit per block of a chunk column, set by the carvers
// stage. The carving_mask placement modifier streams set bits in BitSet order (index = x | z << 4 | (y - minY) << 8).

export type CarvingStep = "air" | "liquid";

export class CarvingMask {
  private readonly words: Uint32Array;

  constructor(
    readonly minY: number,
    readonly height: number,
  ) {
    this.words = new Uint32Array((256 * height + 31) >>> 5);
  }

  /** Packs a byte-per-block mask laid out as (y - minY) * 256 + localZ * 16 + localX (the carvers' layout). */
  static fromByteMask(minY: number, height: number, byteMask: Uint8Array): CarvingMask {
    const mask = new CarvingMask(minY, height);
    for (let index = 0; index < byteMask.length; index++) {
      if (byteMask[index] !== 0) mask.words[index >>> 5]! |= 1 << (index & 31);
    }
    return mask;
  }

  private indexOf(blockX: number, y: number, blockZ: number): number {
    return (blockX & 15) | ((blockZ & 15) << 4) | ((y - this.minY) << 8);
  }

  set(blockX: number, y: number, blockZ: number): void {
    const index = this.indexOf(blockX, y, blockZ);
    this.words[index >>> 5]! |= 1 << (index & 31);
  }

  get(blockX: number, y: number, blockZ: number): boolean {
    const index = this.indexOf(blockX, y, blockZ);
    return (this.words[index >>> 5]! & (1 << (index & 31))) !== 0;
  }

  /** CarvingMask.stream(chunkPos): block positions of set bits in ascending index order. */
  positions(chunkX: number, chunkZ: number): Array<{ x: number; y: number; z: number }> {
    const positions: Array<{ x: number; y: number; z: number }> = [];
    for (let wordIndex = 0; wordIndex < this.words.length; wordIndex++) {
      let word = this.words[wordIndex]!;
      while (word !== 0) {
        const bit = 31 - Math.clz32(word & -word);
        word &= word - 1;
        const index = (wordIndex << 5) | bit;
        positions.push({ x: chunkX * 16 + (index & 15), y: (index >> 8) + this.minY, z: chunkZ * 16 + ((index >> 4) & 15) });
      }
    }
    return positions;
  }
}
