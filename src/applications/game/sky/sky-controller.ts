import * as THREE from "three";
import { profiler } from "../profiler";
import { CloudPass } from "./cloud-pass";
import { CloudCarves } from "./cloud-carves";
import { cloudDensityAt } from "./cloud-field";
import { CLOUD_NOISE_SIZE, generateCloudNoise } from "./cloud-noise";
import { cloudCoverageFor, weatherShiftAt } from "./cloud-weather";
import { GRID_CELLS, type HumidityMap } from "./climate/humidity-map";
import { SkyClock } from "./sky-clock";
import { SkyDome } from "./sky-dome";
import { targetFogDensity } from "./fog-weather";
import { MAX_FOG_DENSITY, skyLightingUniforms } from "./sky-lighting";
import { computeSkyState, type SkyState } from "./sky-state";

interface SkyConditions {
  humidity: number;
  weatherShift: number;
  localCoverage: number;
  overcast: number;
  densityAtViewer: number;
}

/** Overcast grows once the local coverage passes this share of the sky. */
const OVERCAST_COVERAGE_START = 0.6;
const OVERCAST_COVERAGE_FULL = 1;
/** The haze cube the far terrain fades into is re-rendered this often (the sky moves slowly). */
const HAZE_REFRESH_INTERVAL_SECONDS = 2;
/** Fog rolls in and burns off over about this long, so crossing a biome border never pops. */
const FOG_RESPONSE_SECONDS = 25;
/** Cloud density the viewer sits in that gives complete mist, and how fast it builds up or clears. */
const FULL_MIST_DENSITY = 0.6;
const MIST_RESPONSE_SECONDS = 0.35;
/** The hole opened behind a moving viewer sits this far back, so it never swallows the viewer's own cloud. */
const CARVE_DISTANCE_BEHIND_BLOCKS = 42;
const MAX_TRAIL_STEP_BLOCKS = 20;

function linearToSrgbChannel(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** Drives the day/night clock, weather and humidity-fed clouds, and keeps the terrain daylight uniform in step. */
export class SkyController {
  readonly dome: SkyDome;
  readonly cloudPass: CloudPass;
  private readonly cloudNoiseData: Uint8Array;
  private readonly cloudNoiseTexture: THREE.Data3DTexture;
  readonly clock = new SkyClock();
  private elapsedSeconds = 0;
  private fogDensity = 0;
  private cloudMist = 0;
  private readonly carves = new CloudCarves();
  private readonly previousViewerPosition = new THREE.Vector3();
  private hasPreviousViewerPosition = false;
  private secondsSinceHazeRefresh = Number.POSITIVE_INFINITY;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly humidityMap: HumidityMap,
    private weatherSeed: number = 0,
  ) {
    const initToken = profiler.begin("main.sky.init");
    try {
      this.cloudNoiseData = generateCloudNoise();
      const cloudNoiseTexture = new THREE.Data3DTexture(this.cloudNoiseData, CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE);
      cloudNoiseTexture.format = THREE.RGFormat;
      cloudNoiseTexture.type = THREE.UnsignedByteType;
      cloudNoiseTexture.minFilter = THREE.LinearFilter;
      cloudNoiseTexture.magFilter = THREE.LinearFilter;
      cloudNoiseTexture.wrapS = THREE.RepeatWrapping;
      cloudNoiseTexture.wrapT = THREE.RepeatWrapping;
      cloudNoiseTexture.wrapR = THREE.RepeatWrapping;
      cloudNoiseTexture.unpackAlignment = 1;
      cloudNoiseTexture.generateMipmaps = false;
      cloudNoiseTexture.needsUpdate = true;
      this.cloudNoiseTexture = cloudNoiseTexture;
      this.dome = new SkyDome(humidityMap.texture, humidityMap.uniforms, cloudNoiseTexture);
      this.cloudPass = new CloudPass(renderer, this.dome.material.uniforms);
      this.cloudPass.onDisabled = () => this.dome.setCloudsInDome(true);
    } finally {
      profiler.end(initToken);
    }
  }

  /** A new world gets its own biome humidity and its own run of weather. */
  setWorldSeed(seed: number): void {
    profiler.addCounter("game.sky.worldSeedsSet");
    this.weatherSeed = seed % 9973;
    this.humidityMap.setSeed(seed);
  }

  /** Returns true when the sky changed enough that the far terrain's haze cube should be re-rendered. */
  update(deltaSeconds: number, viewerPosition: THREE.Vector3): boolean {
    const clockToken = profiler.begin("main.sky.update.clock");
    try {
      this.elapsedSeconds += deltaSeconds;
      this.clock.advance(deltaSeconds);
    } finally {
      profiler.end(clockToken);
    }

    const humidityUpdateToken = profiler.begin("main.sky.update.humidityGrid");
    try {
      this.humidityMap.update(viewerPosition.x, viewerPosition.z);
    } finally {
      profiler.end(humidityUpdateToken);
    }

    const weatherToken = profiler.begin("main.sky.update.weather");
    let weatherShift: number;
    let humidity: number;
    let localCoverage: number;
    let overcast: number;
    try {
      weatherShift = weatherShiftAt(this.elapsedSeconds, this.weatherSeed);
      humidity = this.humidityMap.humidityAt(viewerPosition.x, viewerPosition.z);
      localCoverage = cloudCoverageFor(humidity, weatherShift);
      overcast = THREE.MathUtils.smoothstep(localCoverage, OVERCAST_COVERAGE_START, OVERCAST_COVERAGE_FULL);
    } finally {
      profiler.end(weatherToken);
    }

    const stateToken = profiler.begin("main.sky.update.skyState");
    let state: SkyState;
    try {
      state = computeSkyState(this.clock.timeOfDay, this.clock.moonPhaseIndex, overcast);
    } finally {
      profiler.end(stateToken);
    }

    const cloudsToken = profiler.begin("main.sky.update.clouds");
    let densityAtViewer: number;
    try {
      this.carves.advance(deltaSeconds);
      const cloudInputs = {
        noise: this.cloudNoiseData,
        elapsedSeconds: this.elapsedSeconds,
        weatherShift,
        humidityAt: (worldX: number, worldZ: number) => this.humidityMap.humidityAt(worldX, worldZ),
        carves: this.carves.list(),
      };
      densityAtViewer = cloudDensityAt(viewerPosition.x, viewerPosition.y, viewerPosition.z, cloudInputs);
      const mistTarget = Math.min(1, densityAtViewer / FULL_MIST_DENSITY);
      this.cloudMist += (mistTarget - this.cloudMist) * (1 - Math.exp(-deltaSeconds / MIST_RESPONSE_SECONDS));
      this.carveTrailBehind(viewerPosition, densityAtViewer > 0.05);
      this.carves.writeUniform(this.dome.carveUniform);
    } finally {
      profiler.end(cloudsToken);
    }

    const fogToken = profiler.begin("main.sky.update.fog");
    try {
      const fogTarget = targetFogDensity({ humidity, weatherShift, sunElevation: state.sunDirection[1] });
      this.fogDensity += (fogTarget - this.fogDensity) * (1 - Math.exp(-deltaSeconds / FOG_RESPONSE_SECONDS));
    } finally {
      profiler.end(fogToken);
    }

    const lightingToken = profiler.begin("main.sky.update.lightingUniforms");
    try {
      skyLightingUniforms.skyDaylight.value = state.daylight;
      skyLightingUniforms.skyFogDensity.value = this.fogDensity;
      skyLightingUniforms.skyFogTime.value = this.elapsedSeconds;
      skyLightingUniforms.skyMist.value = this.cloudMist;
      skyLightingUniforms.skyLightDirection.value.set(...state.lightDirection);
      skyLightingUniforms.skyDirectColor.value.set(...state.directLightColor);
      skyLightingUniforms.skyAmbientColor.value.set(...state.ambientSkyColor);
      skyLightingUniforms.skyGroundColor.value.set(...state.ambientGroundColor);
      skyLightingUniforms.skyZenithColor.value.set(...state.zenithColor);
      skyLightingUniforms.skyHorizonColor.value.set(...state.horizonColor);
      skyLightingUniforms.skyFogColor.value.set(
        linearToSrgbChannel(state.fogColor[0] + (state.mistColor[0] - state.fogColor[0]) * this.cloudMist),
        linearToSrgbChannel(state.fogColor[1] + (state.mistColor[1] - state.fogColor[1]) * this.cloudMist),
        linearToSrgbChannel(state.fogColor[2] + (state.mistColor[2] - state.fogColor[2]) * this.cloudMist),
      );
    } finally {
      profiler.end(lightingToken);
    }

    const domeToken = profiler.begin("main.sky.update.dome");
    try {
      this.dome.apply({
        state,
        viewerPosition,
        elapsedSeconds: this.elapsedSeconds,
        weatherShift,
        fogStrength: Math.min(1, this.fogDensity / MAX_FOG_DENSITY),
        cloudMist: this.cloudMist,
      });
    } finally {
      profiler.end(domeToken);
    }

    if (profiler.enabled) this.recordUpdateMetrics(state, { humidity, weatherShift, localCoverage, overcast, densityAtViewer });

    this.secondsSinceHazeRefresh += deltaSeconds;
    if (this.secondsSinceHazeRefresh < HAZE_REFRESH_INTERVAL_SECONDS) {
      profiler.addCounter("game.sky.update.hazeRefreshSkipped");
      return false;
    }
    this.secondsSinceHazeRefresh = 0;
    profiler.addCounter("game.sky.update.hazeRefreshRequested");
    return true;
  }

  /** Every update recomputes the whole sky; there is no cached path, so each frame counts as one full recompute. */
  private recordUpdateMetrics(state: SkyState, conditions: SkyConditions): void {
    profiler.addCounter("game.sky.update.fullRecomputes");
    profiler.sampleGauge("game.sky.timeOfDay", this.clock.timeOfDay);
    profiler.sampleGauge("game.sky.sunElevation", state.sunDirection[1]);
    profiler.sampleGauge("game.sky.daylight", state.daylight);
    profiler.sampleGauge("game.sky.humidityAtViewer", conditions.humidity);
    profiler.sampleGauge("game.sky.weatherShift", conditions.weatherShift);
    profiler.sampleGauge("game.sky.cloudCoverage", conditions.localCoverage);
    profiler.sampleGauge("game.sky.overcast", conditions.overcast);
    profiler.sampleGauge("game.sky.cloudDensityAtViewer", conditions.densityAtViewer);
    profiler.sampleGauge("game.sky.cloudMist", this.cloudMist);
    profiler.sampleGauge("game.sky.fogDensity", this.fogDensity);
    profiler.sampleGauge("memory.sky.cloudNoiseBytes", this.cloudNoiseData.byteLength, "bytes");
    profiler.sampleGauge("memory.sky.humidityTextureBytes", GRID_CELLS * GRID_CELLS, "bytes");
  }

  /** Opens a hole in the clouds behind the viewer while it flies through one, so a path stays open for a while. */
  private carveTrailBehind(viewerPosition: THREE.Vector3, isInsideCloud: boolean): void {
    profiler.addCounter(isInsideCloud ? "game.sky.carves.framesInsideCloud" : "game.sky.carves.framesOutsideCloud");
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
    profiler.addCounter("game.sky.timeOfDayJumps");
    this.clock.setTimeOfDay(timeOfDay);
  }

  dispose(): void {
    this.humidityMap.dispose();
    this.cloudPass.dispose();
    this.cloudNoiseTexture.dispose();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
  }
}
