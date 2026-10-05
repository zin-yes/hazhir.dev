import * as THREE from "three";
import { cloudCoverageFor, weatherShiftAt } from "./cloud-weather";
import type { HumidityMap } from "./climate/humidity-map";
import { SkyClock } from "./sky-clock";
import { SkyDome } from "./sky-dome";
import { targetFogDensity } from "./fog-weather";
import { MAX_FOG_DENSITY, skyLightingUniforms } from "./sky-lighting";
import { computeSkyState } from "./sky-state";

/** Overcast grows once the local coverage passes this share of the sky. */
const OVERCAST_COVERAGE_START = 0.6;
const OVERCAST_COVERAGE_FULL = 1;
/** The haze cube the far terrain fades into is re-rendered this often (the sky moves slowly). */
const HAZE_REFRESH_INTERVAL_SECONDS = 2;
/** Fog rolls in and burns off over about this long, so crossing a biome border never pops. */
const FOG_RESPONSE_SECONDS = 25;

function linearToSrgbChannel(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** Drives the day/night clock, weather and humidity-fed clouds, and keeps the terrain daylight uniform in step. */
export class SkyController {
  readonly dome: SkyDome;
  readonly clock = new SkyClock();
  private elapsedSeconds = 0;
  private fogDensity = 0;
  private secondsSinceHazeRefresh = Number.POSITIVE_INFINITY;

  constructor(
    private readonly humidityMap: HumidityMap,
    private weatherSeed: number = 0,
  ) {
    this.dome = new SkyDome(humidityMap.texture, humidityMap.uniforms);
  }

  /** A new world gets its own biome humidity and its own run of weather. */
  setWorldSeed(seed: number): void {
    this.weatherSeed = seed % 9973;
    this.humidityMap.setSeed(seed);
  }

  /** Returns true when the sky changed enough that the far terrain's haze cube should be re-rendered. */
  update(deltaSeconds: number, viewerPosition: THREE.Vector3): boolean {
    this.elapsedSeconds += deltaSeconds;
    this.clock.advance(deltaSeconds);
    this.humidityMap.update(viewerPosition.x, viewerPosition.z);

    const weatherShift = weatherShiftAt(this.elapsedSeconds, this.weatherSeed);
    const humidity = this.humidityMap.humidityAt(viewerPosition.x, viewerPosition.z);
    const localCoverage = cloudCoverageFor(humidity, weatherShift);
    const overcast = THREE.MathUtils.smoothstep(localCoverage, OVERCAST_COVERAGE_START, OVERCAST_COVERAGE_FULL);
    const state = computeSkyState(this.clock.timeOfDay, this.clock.moonPhaseIndex, overcast);

    const fogTarget = targetFogDensity({ humidity, weatherShift, sunElevation: state.sunDirection[1] });
    this.fogDensity += (fogTarget - this.fogDensity) * (1 - Math.exp(-deltaSeconds / FOG_RESPONSE_SECONDS));

    skyLightingUniforms.skyDaylight.value = state.daylight;
    skyLightingUniforms.skyFogDensity.value = this.fogDensity;
    skyLightingUniforms.skyFogTime.value = this.elapsedSeconds;
    skyLightingUniforms.skyFogColor.value.set(
      linearToSrgbChannel(state.fogColor[0]),
      linearToSrgbChannel(state.fogColor[1]),
      linearToSrgbChannel(state.fogColor[2]),
    );
    this.dome.apply({
      state,
      viewerPosition,
      elapsedSeconds: this.elapsedSeconds,
      weatherShift,
      fogStrength: Math.min(1, this.fogDensity / MAX_FOG_DENSITY),
    });

    this.secondsSinceHazeRefresh += deltaSeconds;
    if (this.secondsSinceHazeRefresh < HAZE_REFRESH_INTERVAL_SECONDS) return false;
    this.secondsSinceHazeRefresh = 0;
    return true;
  }

  /** Debug hook: jumps the world clock (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset). */
  setTimeOfDay(timeOfDay: number): void {
    this.clock.setTimeOfDay(timeOfDay);
  }

  dispose(): void {
    this.humidityMap.dispose();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
  }
}
