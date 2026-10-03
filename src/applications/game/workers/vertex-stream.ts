import { WORDS_PER_VERTEX } from "../vertex-format";

const INITIAL_VERTEX_CAPACITY = 2048;

/**
 * Growable stream of packed vertices. Quads are appended as four vertices; a
 * shared index buffer on the main thread supplies the two triangles per quad,
 * so a flipped diagonal is encoded by rotating the vertex order instead.
 */
export class VertexStream {
  private words = new Uint32Array(INITIAL_VERTEX_CAPACITY * WORDS_PER_VERTEX);
  private wordCount = 0;

  get vertexCount(): number {
    return this.wordCount / WORDS_PER_VERTEX;
  }

  private reserveWords(extraWords: number) {
    const requiredWords = this.wordCount + extraWords;
    if (requiredWords <= this.words.length) return;
    let grownLength = this.words.length * 2;
    while (grownLength < requiredWords) grownLength *= 2;
    const grownWords = new Uint32Array(grownLength);
    grownWords.set(this.words.subarray(0, this.wordCount));
    this.words = grownWords;
  }

  /**
   * Appends the quad v0 v1 v2 v3, drawn as triangles (v0 v1 v2) and (v2 v1 v3).
   * With flipDiagonal the split runs along v0-v3 instead.
   */
  pushQuad(
    positionWord0: number,
    surfaceWord0: number,
    positionWord1: number,
    surfaceWord1: number,
    positionWord2: number,
    surfaceWord2: number,
    positionWord3: number,
    surfaceWord3: number,
    flipDiagonal: boolean,
  ) {
    this.reserveWords(4 * WORDS_PER_VERTEX);
    const words = this.words;
    let cursor = this.wordCount;
    if (flipDiagonal) {
      words[cursor++] = positionWord1;
      words[cursor++] = surfaceWord1;
      words[cursor++] = positionWord3;
      words[cursor++] = surfaceWord3;
      words[cursor++] = positionWord0;
      words[cursor++] = surfaceWord0;
      words[cursor++] = positionWord2;
      words[cursor++] = surfaceWord2;
    } else {
      words[cursor++] = positionWord0;
      words[cursor++] = surfaceWord0;
      words[cursor++] = positionWord1;
      words[cursor++] = surfaceWord1;
      words[cursor++] = positionWord2;
      words[cursor++] = surfaceWord2;
      words[cursor++] = positionWord3;
      words[cursor++] = surfaceWord3;
    }
    this.wordCount = cursor;
  }

  /** A right-sized copy, ready to be transferred to the main thread. */
  toBuffer(): ArrayBuffer {
    return this.words.slice(0, this.wordCount).buffer;
  }
}
