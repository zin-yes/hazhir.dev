// Shared vertical landmarks that map Minecraft coordinates onto the game's.

/** Game y = Minecraft y + this offset, so Minecraft sea level 63 lands on the game's SEA_LEVEL. */
export const GAME_Y_OFFSET = 17;

/** Water fills every block below this game height, so the surface plane sits at this y (Minecraft 63 + offset). */
export const SEA_LEVEL = 80;
