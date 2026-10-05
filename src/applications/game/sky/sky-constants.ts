// Tunables shared by the CPU side (coverage, weather) and the sky shader, which receives them as GLSL defines.

export const DAY_LENGTH_SECONDS = 1200;
/** Morning, so a new world opens on a bright sky. */
export const STARTING_TIME_OF_DAY = 0.3;
export const MOON_PHASE_COUNT = 8;

/** The sun climbs from the east horizon and passes slightly south of the zenith. */
export const ORBIT_TILT = 0.25;

export const CLOUD_BASE_Y = 300;
export const CLOUD_LAYER_COUNT = 3;
export const CLOUD_CELL_WIDTH = 40;
export const CLOUD_CELL_HEIGHT = 14;
export const CLOUD_MAX_DISTANCE = 2400;
export const CLOUD_MAX_STEPS = 72;
export const CLOUD_WIND_BLOCKS_PER_SECOND = { x: 3.2, z: 1.1 };
/** Noise units per second the cloud field evolves in, so clouds form and dissolve while drifting. */
export const CLOUD_EVOLUTION_PER_SECOND = 0.004;

/** Coverage (0 clear, 1 overcast) = base + humidity * gain + weather shift. */
export const CLOUD_BASE_COVERAGE = 0.22;
export const CLOUD_HUMIDITY_GAIN = 0.5;
export const WEATHER_SHIFT_RANGE = 0.22;
export const WEATHER_PERIOD_SECONDS = 540;
