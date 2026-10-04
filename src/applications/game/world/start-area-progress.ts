// Loading-screen progress: how many chunks around the start position are generated, lit and on screen. A chunk
// that leaves the desired set (skipped as sky, unloaded) counts as done.

import type { StartAreaProgress as StartAreaFractions } from "./pipeline-backends";

export const START_STAGE_GENERATED = 1;
export const START_STAGE_LIT = 2;
export const START_STAGE_MESHED = 3;

export class StartAreaProgress {
  private readonly reachedStageByKey = new Map<number, number>();
  private readonly keysAtLeastAtStage = [0, 0, 0, 0];
  private hasReportedReady = false;

  constructor(
    targetKeys: Iterable<number>,
    private readonly onProgress: (fractions: StartAreaFractions) => void,
    private readonly onReady: () => void,
  ) {
    for (const key of targetKeys) this.reachedStageByKey.set(key, 0);
  }

  get targetCount(): number {
    return this.reachedStageByKey.size;
  }

  get isReady(): boolean {
    return this.keysAtLeastAtStage[START_STAGE_MESHED] === this.reachedStageByKey.size;
  }

  markReached(key: number, stage: number): void {
    const reachedStage = this.reachedStageByKey.get(key);
    if (reachedStage === undefined || reachedStage >= stage) return;
    for (let passedStage = reachedStage + 1; passedStage <= stage; passedStage++) {
      this.keysAtLeastAtStage[passedStage]!++;
    }
    this.reachedStageByKey.set(key, stage);
    this.report();
  }

  markRemoved(key: number): void {
    this.markReached(key, START_STAGE_MESHED);
  }

  /** Reports once with whatever was reached, for an empty target or a world started fully cached. */
  reportInitial(): void {
    this.report();
  }

  private report(): void {
    if (this.hasReportedReady) return;
    const targetCount = Math.max(1, this.reachedStageByKey.size);
    this.onProgress({
      generated: this.keysAtLeastAtStage[START_STAGE_GENERATED]! / targetCount,
      lit: this.keysAtLeastAtStage[START_STAGE_LIT]! / targetCount,
      meshed: this.keysAtLeastAtStage[START_STAGE_MESHED]! / targetCount,
    });
    if (this.isReady) {
      this.hasReportedReady = true;
      this.onReady();
    }
  }
}
