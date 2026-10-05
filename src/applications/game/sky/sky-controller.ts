import * as THREE from "three";
import { CloudCarves } from "./cloud-carves";
import { cloudDepthAt } from "./cloud-field";
import { cloudCoverageFor, weatherShiftAt } from "./cloud-weather";
import type { HumidityMap } from "./climate/humidity-map";
import { CLOUD_CELL_HEIGHT } from "./sky-constants";
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
/** Depth inside a cloud body (blocks) at which the mist is complete, and how fast it builds up or clears. */
const FULL_MIST_DEPTH_BLOCKS = CLOUD_CELL_HEIGHT * 0.3;
const MIST_RESPONSE_SECONDS = 0.35;
/** The hole opened behind a moving viewer sits this far back, so it never swallows the viewer's own cloud. */
const CARVE_DISTANCE_BEHIND_BLOCKS = 15;
const MAX_TRAIL_STEP_BLOCKS = 20;

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
  private cloudMist = 0;
  private readonly carves = new CloudCarves();
  private readonly previousViewerPosition = new THREE.Vector3();
  private hasPreviousViewerPosition = false;
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

    this.carves.advance(deltaSeconds);
    const cloudInputs = {
      elapsedSeconds: this.elapsedSeconds,
      weatherShift,
      humidityAt: (worldX: number, worldZ: number) => this.humidityMap.humidityAt(worldX, worldZ),
      carves: this.carves.list(),
    };
    const depthInsideCloud = cloudDepthAt(viewerPosition.x, viewerPosition.y, viewerPosition.z, cloudInputs);
    const mistTarget = Math.min(1, depthInsideCloud / FULL_MIST_DEPTH_BLOCKS);
    this.cloudMist += (mistTarget - this.cloudMist) * (1 - Math.exp(-deltaSeconds / MIST_RESPONSE_SECONDS));
    this.carveTrailBehind(viewerPosition, depthInsideCloud > 0);
    this.carves.writeUniform(this.dome.carveUniform);

    const fogTarget = targetFogDensity({ humidity, weatherShift, sunElevation: state.sunDirection[1] });
    this.fogDensity += (fogTarget - this.fogDensity) * (1 - Math.exp(-deltaSeconds / FOG_RESPONSE_SECONDS));

    skyLightingUniforms.skyDaylight.value = state.daylight;
    skyLightingUniforms.skyFogDensity.value = this.fogDensity;
    skyLightingUniforms.skyFogTime.value = this.elapsedSeconds;
    skyLightingUniforms.skyMist.value = this.cloudMist;
    skyLightingUniforms.skyFogColor.value.set(
      linearToSrgbChannel(state.fogColor[0] + (state.mistColor[0] - state.fogColor[0]) * this.cloudMist),
      linearToSrgbChannel(state.fogColor[1] + (state.mistColor[1] - state.fogColor[1]) * this.cloudMist),
      linearToSrgbChannel(state.fogColor[2] + (state.mistColor[2] - state.fogColor[2]) * this.cloudMist),
    );
    this.dome.apply({
      state,
      viewerPosition,
      elapsedSeconds: this.elapsedSeconds,
      weatherShift,
      fogStrength: Math.min(1, this.fogDensity / MAX_FOG_DENSITY),
      cloudMist: this.cloudMist,
    });

    this.secondsSinceHazeRefresh += deltaSeconds;
    if (this.secondsSinceHazeRefresh < HAZE_REFRESH_INTERVAL_SECONDS) return false;
    this.secondsSinceHazeRefresh = 0;
    return true;
  }

  /** Opens a hole in the clouds behind the viewer while it flies through one, so a path stays open for a while. */
  private carveTrailBehind(viewerPosition: THREE.Vector3, isInsideCloud: boolean): void {
    const hadPrevious = this.hasPreviousViewerPosition;
    const movement = viewerPosition.clone().sub(this.previousViewerPosition);
    this.previousViewerPosition.copy(viewerPosition);
    this.hasPreviousViewerPosition = true;
    const stepLength = movement.length();
    if (!hadPrevious || !isInsideCloud || stepLength < 0.01 || stepLength > MAX_TRAIL_STEP_BLOCKS) return;
    const behind = viewerPosition.clone().addScaledVector(movement, -CARVE_DISTANCE_BEHIND_BLOCKS / stepLength);
    this.carves.carve(behind.x, behind.y, behind.z);
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
