const INITIAL_CAPACITY = 4096;

/**
 * First-in first-out queue of cells stored in typed ring buffers, so a flood
 * fill allocates nothing per cell. Each entry carries one cell code and a
 * small value (the light level a removal wave is carrying).
 *
 * Usage counters (pushes, the most entries held at once, buffer growths) are
 * plain integers that clear() resets, so a caller can read them after a flood
 * and report them, from a worker or the main thread alike.
 */
export class CellQueue {
  private cells = new Uint32Array(INITIAL_CAPACITY);
  private values = new Uint8Array(INITIAL_CAPACITY);
  private head = 0;
  private count = 0;
  private pushes = 0;
  private peak = 0;
  private growths = 0;
  /** Value of the entry most recently returned by shift. */
  shiftedValue = 0;

  get length(): number {
    return this.count;
  }

  /** Entries pushed since the last clear. */
  get pushedCount(): number {
    return this.pushes;
  }

  /** The most entries held at once since the last clear. */
  get peakLength(): number {
    return this.peak;
  }

  /** Times the buffers doubled since the last clear. */
  get growthCount(): number {
    return this.growths;
  }

  /** Allocated bytes of both ring buffers. */
  get capacityBytes(): number {
    return this.cells.byteLength + this.values.byteLength;
  }

  push(cell: number, value = 0) {
    if (this.count === this.cells.length) this.grow();
    const tail = (this.head + this.count) & (this.cells.length - 1);
    this.cells[tail] = cell;
    this.values[tail] = value;
    this.count++;
    this.pushes++;
    if (this.count > this.peak) this.peak = this.count;
  }

  shift(): number {
    const cell = this.cells[this.head];
    this.shiftedValue = this.values[this.head];
    this.head = (this.head + 1) & (this.cells.length - 1);
    this.count--;
    return cell;
  }

  clear() {
    this.head = 0;
    this.count = 0;
    this.pushes = 0;
    this.peak = 0;
    this.growths = 0;
  }

  private grow() {
    const capacity = this.cells.length;
    const grownCells = new Uint32Array(capacity * 2);
    const grownValues = new Uint8Array(capacity * 2);
    const firstRunLength = capacity - this.head;
    grownCells.set(this.cells.subarray(this.head), 0);
    grownCells.set(this.cells.subarray(0, this.head), firstRunLength);
    grownValues.set(this.values.subarray(this.head), 0);
    grownValues.set(this.values.subarray(0, this.head), firstRunLength);
    this.cells = grownCells;
    this.values = grownValues;
    this.head = 0;
    this.growths++;
  }
}
