// Holes the viewer punches through clouds by flying through them. Each hole is a sphere that starts at full size and
// shrinks away, so the cloud closes up behind a flight path. The shader receives the live list as a uniform array.

import { profiler } from "../profiler";
import type { CloudCarve } from "./cloud-field";

export const MAX_CLOUD_CARVES = 12;
const CARVE_RADIUS_BLOCKS = 34;
const CARVE_LIFETIME_SECONDS = 30;
const MINIMUM_SPACING_BLOCKS = 16;

interface LiveCarve {
  x: number;
  y: number;
  z: number;
  ageSeconds: number;
}

function radiusAtAge(ageSeconds: number): number {
  const remaining = 1 - ageSeconds / CARVE_LIFETIME_SECONDS;
  return remaining <= 0 ? 0 : CARVE_RADIUS_BLOCKS * Math.sqrt(remaining);
}

export class CloudCarves {
  private liveCarves: LiveCarve[] = [];

  /** Opens a hole at a position unless one was opened very close to it a moment ago. */
  carve(x: number, y: number, z: number): void {
    const newest = this.liveCarves[this.liveCarves.length - 1];
    if (newest && Math.hypot(newest.x - x, newest.y - y, newest.z - z) < MINIMUM_SPACING_BLOCKS) {
      profiler.addCounter("game.sky.carves.rejectedTooClose");
      return;
    }
    this.liveCarves.push({ x, y, z, ageSeconds: 0 });
    profiler.addCounter("game.sky.carves.created");
    if (this.liveCarves.length > MAX_CLOUD_CARVES) {
      this.liveCarves.shift();
      profiler.addCounter("game.sky.carves.evictedOverCapacity");
    }
  }

  advance(deltaSeconds: number): void {
    for (const carve of this.liveCarves) carve.ageSeconds += deltaSeconds;
    const liveBefore = this.liveCarves.length;
    this.liveCarves = this.liveCarves.filter((carve) => carve.ageSeconds < CARVE_LIFETIME_SECONDS);
    if (this.liveCarves.length < liveBefore) profiler.addCounter("game.sky.carves.expired", liveBefore - this.liveCarves.length);
    profiler.sampleGauge("game.sky.carves.live", this.liveCarves.length);
  }

  list(): CloudCarve[] {
    return this.liveCarves.map((carve) => ({ x: carve.x, y: carve.y, z: carve.z, radius: radiusAtAge(carve.ageSeconds) }));
  }

  /** Fills a vec4 uniform array with x, y, z, radius per hole (unused slots get radius 0). */
  writeUniform(target: ReadonlyArray<{ set(x: number, y: number, z: number, w: number): unknown }>): void {
    const carves = this.list();
    profiler.addCounter("game.sky.carves.uniformWrites");
    target.forEach((slot, index) => {
      const carve = carves[index];
      if (carve) slot.set(carve.x, carve.y, carve.z, carve.radius);
      else slot.set(0, 0, 0, 0);
    });
  }
}
