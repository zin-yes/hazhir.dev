// Loading-screen progress: how many chunks around the start position are generated, lit and on screen. A chunk
// that leaves the desired set (skipped as sky, unloaded) counts as done.

import { profiler } from "../profiler";
import type { StartAreaProgress as StartAreaFractions } from "./pipeline-backends";

export const START_STAGE_GENERATED = 1;
export const START_STAGE_LIT = 2;
export const START_STAGE_MESHED = 3;

const STAGE_NAMES = ["target", "generated", "lit", "meshed"];
const STAGE_REACHED_COUNTERS = STAGE_NAMES.map((name) => `game.startArea.chunksReached.${name}`);
const STAGE_COMPLETE_TIMERS = STAGE_NAMES.map((name) => `latency.startArea.${name}Complete`);
const STAGE_FRACTION_GAUGES = STAGE_NAMES.map((name) => `game.startArea.fraction.${name}`);

export class StartAreaProgress {
  private readonly reachedStageByKey = new Map<number, number>();
  private readonly keysAtLeastAtStage = [0, 0, 0, 0];
  private readonly createdAtMs = profiler.now();
  private readonly hasRecordedStageCompletion = [false, false, false, false];
  private hasReportedReady = false;

  constructor(
    targetKeys: Iterable<number>,
    private readonly onProgress: (fractions: StartAreaFractions) => void,
    private readonly onReady: () => void,
  ) {
    for (const key of targetKeys) this.reachedStageByKey.set(key, 0);
    profiler.sampleGauge("game.startArea.targetChunks", this.reachedStageByKey.size);
  }

  get targetCount(): number {
    return this.reachedStageByKey.size;
  }

  get isReady(): boolean {
    return this.keysAtLeastAtStage[START_STAGE_MESHED] === this.reachedStageByKey.size;
  }

  markReached(key: number, stage: number): void {
    const reachedStage = this.reachedStageByKey.get(key);
    if (reachedStage === undefined) {
      profiler.addCounter("game.startArea.marksOutsideTarget");
      return;
    }
    if (reachedStage >= stage) {
      profiler.addCounter("game.startArea.marksAlreadyReached");
      return;
    }
    for (let passedStage = reachedStage + 1; passedStage <= stage; passedStage++) {
      this.keysAtLeastAtStage[passedStage]!++;
      profiler.addCounter(STAGE_REACHED_COUNTERS[passedStage]!);
      this.recordStageCompletion(passedStage);
    }
    this.reachedStageByKey.set(key, stage);
    this.report();
  }

  markRemoved(key: number): void {
    if (this.reachedStageByKey.has(key)) profiler.addCounter("game.startArea.chunksRemovedBeforeReady");
    this.markReached(key, START_STAGE_MESHED);
  }

  /** Reports once with whatever was reached, for an empty target or a world started fully cached. */
  reportInitial(): void {
    this.report();
  }

  private recordStageCompletion(stage: number): void {
    if (this.hasRecordedStageCompletion[stage] || this.keysAtLeastAtStage[stage] !== this.reachedStageByKey.size) return;
    this.hasRecordedStageCompletion[stage] = true;
    profiler.recordTimer(STAGE_COMPLETE_TIMERS[stage]!, profiler.now() - this.createdAtMs, "latency");
  }

  private report(): void {
    if (this.hasReportedReady) return;
    const targetCount = Math.max(1, this.reachedStageByKey.size);
    profiler.addCounter("game.startArea.progressReports");
    if (profiler.enabled) {
      for (let stage = START_STAGE_GENERATED; stage <= START_STAGE_MESHED; stage++) {
        profiler.sampleGauge(STAGE_FRACTION_GAUGES[stage]!, this.keysAtLeastAtStage[stage]! / targetCount, "fraction");
      }
    }
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
