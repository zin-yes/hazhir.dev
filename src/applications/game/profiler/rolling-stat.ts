import type { DistributionSummary } from "./types";

const SAMPLE_CAPACITY = 512;
const HISTORY_SECONDS = 60;
const RECENT_SECONDS_WINDOW = 5;

/**
 * Streaming statistics for one metric: lifetime count/total/min/max, a ring of
 * recent samples for percentiles, and per-second buckets for rates.
 */
export class RollingStat {
  count = 0;
  total = 0;
  min = Infinity;
  max = -Infinity;

  private readonly samples: Float64Array;
  private sampleCursor = 0;
  private sampleCount = 0;

  private bucketSecond = -1;
  private bucketTotal = 0;
  private bucketCount = 0;
  private completedTotals: number[] = [];
  private completedCounts: number[] = [];

  constructor(sampleCapacity = SAMPLE_CAPACITY) {
    this.samples = new Float64Array(sampleCapacity);
  }

  add(value: number, nowMs: number) {
    this.count++;
    this.total += value;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;

    this.samples[this.sampleCursor] = value;
    this.sampleCursor = (this.sampleCursor + 1) % this.samples.length;
    if (this.sampleCount < this.samples.length) this.sampleCount++;

    this.rollBuckets(Math.floor(nowMs / 1000));
    this.bucketTotal += value;
    this.bucketCount++;
  }

  summary(nowMs: number): DistributionSummary {
    this.rollBuckets(Math.floor(nowMs / 1000));

    const sorted = this.samples.slice(0, this.sampleCount).sort();
    const recentTotals = this.completedTotals.slice(-RECENT_SECONDS_WINDOW);
    const recentCounts = this.completedCounts.slice(-RECENT_SECONDS_WINDOW);
    const hasCompletedSeconds = recentTotals.length > 0;

    return {
      count: this.count,
      total: this.total,
      mean: this.count === 0 ? 0 : this.total / this.count,
      min: this.count === 0 ? 0 : this.min,
      max: this.count === 0 ? 0 : this.max,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      recentPerSecondTotal: hasCompletedSeconds
        ? average(recentTotals)
        : this.bucketTotal,
      recentPerSecondCount: hasCompletedSeconds
        ? average(recentCounts)
        : this.bucketCount,
      perSecondHistory: [...this.completedTotals],
    };
  }

  private rollBuckets(second: number) {
    if (this.bucketSecond === -1) {
      this.bucketSecond = second;
      return;
    }
    if (second <= this.bucketSecond) return;

    this.completedTotals.push(this.bucketTotal);
    this.completedCounts.push(this.bucketCount);
    const skippedSeconds = Math.min(second - this.bucketSecond - 1, HISTORY_SECONDS);
    for (let skipped = 0; skipped < skippedSeconds; skipped++) {
      this.completedTotals.push(0);
      this.completedCounts.push(0);
    }
    if (this.completedTotals.length > HISTORY_SECONDS) {
      const overflow = this.completedTotals.length - HISTORY_SECONDS;
      this.completedTotals.splice(0, overflow);
      this.completedCounts.splice(0, overflow);
    }

    this.bucketSecond = second;
    this.bucketTotal = 0;
    this.bucketCount = 0;
  }
}

export function emptyDistribution(): DistributionSummary {
  return {
    count: 0,
    total: 0,
    mean: 0,
    min: 0,
    max: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    recentPerSecondTotal: 0,
    recentPerSecondCount: 0,
    perSecondHistory: [],
  };
}

function percentile(sortedAscending: Float64Array, fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(
    sortedAscending.length - 1,
    Math.floor(fraction * sortedAscending.length),
  );
  return sortedAscending[index];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
