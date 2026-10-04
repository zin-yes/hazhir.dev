const BYTES_PER_WORD = 4;

/** The value every byte holds, or -1 when the bytes differ. Compares four bytes per step when aligned. */
export function uniformByteValue(bytes: Uint8Array): number {
  if (bytes.length === 0) return -1;
  const firstByte = bytes[0]!;
  const isWordAligned = bytes.byteOffset % BYTES_PER_WORD === 0 && bytes.length % BYTES_PER_WORD === 0;
  if (!isWordAligned) {
    for (let index = 1; index < bytes.length; index++) {
      if (bytes[index] !== firstByte) return -1;
    }
    return firstByte;
  }
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / BYTES_PER_WORD);
  const expectedWord = Math.imul(firstByte, 0x01010101) >>> 0;
  for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
    if (words[wordIndex] !== expectedWord) return -1;
  }
  return firstByte;
}
