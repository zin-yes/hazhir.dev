// Shared vertical landmarks for terrain generation.

/** Water fills every block below this height, so the surface plane sits at this y. */
export const SEA_LEVEL = 80;

/** Temperature drop per block of altitude beyond the continental lowlands (lapse rate). */
export const TEMPERATURE_DROP_PER_BLOCK = 0.009;

/** Height above sea level up to which altitude does not cool the climate. */
export const TEMPERATURE_DROP_START_HEIGHT = 25;
