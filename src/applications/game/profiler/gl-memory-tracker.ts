const TEXTURE0 = 0x84c0;
const MIPMAP_EXTRA_FRACTION = 1 / 3;

interface TextureRecord {
  levelBytes: Map<number, number>;
  isImmutable: boolean;
}

/**
 * Mirrors WebGL buffer and texture allocation calls to estimate how much GPU
 * memory the page holds. Texture bindings are tracked per texture unit and
 * target. Sizes are estimates from format tables, not driver-reported values.
 */
export class GlMemoryTracker {
  private boundBuffers = new Map<number, object | null>();
  private bufferSizes = new Map<object, number>();
  private boundTextures = new Map<string, object | null>();
  private textureRecords = new Map<object, TextureRecord>();
  private activeTextureUnit = 0;

  private bufferByteTotal = 0;
  private textureByteTotal = 0;
  private allocatedSinceLastTake = 0;
  private freedSinceLastTake = 0;

  get bufferBytes(): number {
    return this.bufferByteTotal;
  }

  get textureBytes(): number {
    return this.textureByteTotal;
  }

  get bufferCount(): number {
    return this.bufferSizes.size;
  }

  /** Bytes allocated and freed since the previous call, then resets both. */
  takeAllocationDeltas(): { allocatedBytes: number; freedBytes: number } {
    const deltas = {
      allocatedBytes: this.allocatedSinceLastTake,
      freedBytes: this.freedSinceLastTake,
    };
    this.allocatedSinceLastTake = 0;
    this.freedSinceLastTake = 0;
    return deltas;
  }

  bindBuffer(target: number, buffer: object | null) {
    this.boundBuffers.set(target, buffer);
  }

  recordBufferData(target: number, bytes: number) {
    const buffer = this.boundBuffers.get(target);
    if (!buffer) return;
    const previousBytes = this.bufferSizes.get(buffer) ?? 0;
    this.bufferSizes.set(buffer, bytes);
    this.bufferByteTotal += bytes - previousBytes;
    this.freedSinceLastTake += previousBytes;
    this.allocatedSinceLastTake += bytes;
  }

  deleteBuffer(buffer: object | null) {
    if (!buffer) return;
    const bytes = this.bufferSizes.get(buffer);
    if (bytes === undefined) return;
    this.bufferSizes.delete(buffer);
    this.bufferByteTotal -= bytes;
    this.freedSinceLastTake += bytes;
    for (const [target, bound] of this.boundBuffers) {
      if (bound === buffer) this.boundBuffers.set(target, null);
    }
  }

  activeTexture(textureUnitEnum: number) {
    this.activeTextureUnit = textureUnitEnum - TEXTURE0;
  }

  bindTexture(target: number, texture: object | null) {
    this.boundTextures.set(this.textureSlotKey(target), texture);
  }

  /** Records one mip level uploaded with texImage*. */
  recordTextureLevel(target: number, level: number, bytes: number) {
    const record = this.recordForBoundTexture(target);
    if (!record) return;
    const previousBytes = record.levelBytes.get(level) ?? 0;
    record.levelBytes.set(level, bytes);
    this.applyTextureDelta(bytes - previousBytes, bytes, previousBytes);
  }

  /** Records an immutable allocation from texStorage*, replacing earlier levels. */
  recordTextureStorage(target: number, totalBytes: number) {
    const record = this.recordForBoundTexture(target);
    if (!record) return;
    let previousBytes = 0;
    record.levelBytes.forEach((bytes) => (previousBytes += bytes));
    record.levelBytes.clear();
    record.levelBytes.set(0, totalBytes);
    record.isImmutable = true;
    this.applyTextureDelta(totalBytes - previousBytes, totalBytes, previousBytes);
  }

  /** generateMipmap adds roughly a third on top of level 0 for mutable textures. */
  recordMipmapGeneration(target: number) {
    const record = this.recordForBoundTexture(target);
    if (!record || record.isImmutable || record.levelBytes.has(1)) return;
    const levelZeroBytes = record.levelBytes.get(0);
    if (!levelZeroBytes) return;
    const extraBytes = Math.round(levelZeroBytes * MIPMAP_EXTRA_FRACTION);
    record.levelBytes.set(1, extraBytes);
    this.applyTextureDelta(extraBytes, extraBytes, 0);
  }

  deleteTexture(texture: object | null) {
    if (!texture) return;
    const record = this.textureRecords.get(texture);
    if (!record) return;
    let bytes = 0;
    record.levelBytes.forEach((levelBytes) => (bytes += levelBytes));
    this.textureRecords.delete(texture);
    this.textureByteTotal -= bytes;
    this.freedSinceLastTake += bytes;
    for (const [slot, bound] of this.boundTextures) {
      if (bound === texture) this.boundTextures.set(slot, null);
    }
  }

  private applyTextureDelta(netDelta: number, allocatedBytes: number, freedBytes: number) {
    this.textureByteTotal += netDelta;
    this.allocatedSinceLastTake += allocatedBytes;
    this.freedSinceLastTake += freedBytes;
  }

  private recordForBoundTexture(target: number): TextureRecord | null {
    const texture = this.boundTextures.get(this.textureSlotKey(target));
    if (!texture) return null;
    let record = this.textureRecords.get(texture);
    if (!record) {
      record = { levelBytes: new Map(), isImmutable: false };
      this.textureRecords.set(texture, record);
    }
    return record;
  }

  private textureSlotKey(target: number): string {
    return `${this.activeTextureUnit}:${target}`;
  }
}
