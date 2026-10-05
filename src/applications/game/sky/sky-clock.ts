import { DAY_LENGTH_SECONDS, MOON_PHASE_COUNT, STARTING_TIME_OF_DAY } from "./sky-constants";

/** World time of day: 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
export class SkyClock {
  private totalDays: number;

  constructor(
    startingTimeOfDay: number = STARTING_TIME_OF_DAY,
    private readonly dayLengthSeconds: number = DAY_LENGTH_SECONDS,
  ) {
    this.totalDays = startingTimeOfDay;
  }

  advance(deltaSeconds: number): void {
    this.totalDays += deltaSeconds / this.dayLengthSeconds;
  }

  setTimeOfDay(timeOfDay: number): void {
    this.totalDays = Math.floor(this.totalDays) + timeOfDay;
  }

  get timeOfDay(): number {
    return this.totalDays - Math.floor(this.totalDays);
  }

  /** 0 is a full moon, counting up through waning phases and back. */
  get moonPhaseIndex(): number {
    return Math.floor(this.totalDays) % MOON_PHASE_COUNT;
  }
}
