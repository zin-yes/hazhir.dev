// Tunables shared by the CPU side (coverage, weather) and the sky shader, which receives them as GLSL defines.

export const DAY_LENGTH_SECONDS = 1200;
/** Morning, so a new world opens on a bright sky. */
export const STARTING_TIME_OF_DAY = 0.3;
export const MOON_PHASE_COUNT = 8;

/** The sun climbs from the east horizon and passes slightly south of the zenith. */
export const ORBIT_TILT = 0.25;

export const CLOUD_BASE_Y = 300;
/** Vertical extent of the cloud deck; clouds are one continuous noise volume inside it. */
export const CLOUD_THICKNESS = 90;
export const CLOUD_MAX_DISTANCE = 2400;
/** Samples along a view ray through the deck (a quadratic spread keeps them dense near the viewer). */
export const CLOUD_VIEW_STEPS = 32;
export const CLOUD_LIGHT_STEPS = 3;
export const CLOUD_WIND_BLOCKS_PER_SECOND = { x: 3.2, z: 1.1 };
/** Vertical noise units per second the field evolves in, so clouds form and dissolve while drifting. */
export const CLOUD_EVOLUTION_PER_SECOND = 0.0006;
/** Blocks one repeat of the noise texture covers, for the big shapes and for the fine erosion. */
export const CLOUD_SHAPE_TILE_BLOCKS = 1600;
export const CLOUD_SHAPE_VERTICAL_TILE_BLOCKS = 500;
export const CLOUD_DETAIL_TILE_BLOCKS = 420;
/** Extinction per block at full density. */
export const CLOUD_SIGMA = 0.06;
/** The cloud pass renders at this share of the screen size and is upsampled. */
export const CLOUD_RENDER_SCALE = 0.5;

/** Coverage (0 clear, 1 overcast) = base + humidity * gain + weather shift. */
export const CLOUD_BASE_COVERAGE = 0.22;
export const CLOUD_HUMIDITY_GAIN = 0.5;
export const WEATHER_SHIFT_RANGE = 0.22;
export const WEATHER_PERIOD_SECONDS = 540;
