// Player preferences that are not about world streaming: camera, look speed and the phone control layout. Kept apart
// from the render settings because they never reach the chunk pipeline.

export type TouchControlSize = "small" | "medium" | "large";
export type TouchHandedness = "right" | "left";
export type TouchJoystickMode = "floating" | "fixed";
export type ShadowQuality = "off" | "low" | "high";

export interface GameSettings {
  fieldOfViewDegrees: number;
  /** Multiplier on the base look speed, for mouse and touch alike. */
  lookSensitivity: number;
  touchControlSize: TouchControlSize;
  /** The side the action buttons sit on; the joystick takes the other. */
  touchHandedness: TouchHandedness;
  touchOpacity: number;
  touchJoystickMode: TouchJoystickMode;
  shadowQuality: ShadowQuality;
  bloomEnabled: boolean;
}

export const FIELD_OF_VIEW_MINIMUM_DEGREES = 60;
export const FIELD_OF_VIEW_MAXIMUM_DEGREES = 110;
export const LOOK_SENSITIVITY_MINIMUM = 0.25;
export const LOOK_SENSITIVITY_MAXIMUM = 3;
export const TOUCH_OPACITY_MINIMUM = 0.3;
export const TOUCH_OPACITY_MAXIMUM = 1;

export const TOUCH_CONTROL_SIZES: readonly TouchControlSize[] = ["small", "medium", "large"];
export const TOUCH_HANDEDNESS_OPTIONS: readonly TouchHandedness[] = ["right", "left"];
export const TOUCH_JOYSTICK_MODES: readonly TouchJoystickMode[] = ["floating", "fixed"];
export const SHADOW_QUALITIES: readonly ShadowQuality[] = ["off", "low", "high"];

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = {
  fieldOfViewDegrees: 85,
  lookSensitivity: 1,
  touchControlSize: "medium",
  touchHandedness: "right",
  touchOpacity: 0.85,
  touchJoystickMode: "floating",
  shadowQuality: "high",
  bloomEnabled: true,
};

type MatchMedia = (query: string) => Pick<MediaQueryList, "matches">;

/** Shadows start off on touch devices (coarse primary pointer) and high elsewhere, including on the server. */
export function defaultShadowQuality(matchMedia: MatchMedia | undefined = browserMatchMedia()): ShadowQuality {
  return matchMedia?.("(pointer: coarse)").matches ? "off" : "high";
}

/** Bloom starts off on touch devices (coarse primary pointer) and on elsewhere, including on the server. */
export function defaultBloomEnabled(matchMedia: MatchMedia | undefined = browserMatchMedia()): boolean {
  return !matchMedia?.("(pointer: coarse)").matches;
}

function browserMatchMedia(): MatchMedia | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return (query) => window.matchMedia(query);
}

/** The defaults for this device: the static defaults plus the device-dependent shadow quality and bloom. */
export function defaultGameSettings(matchMedia?: MatchMedia): GameSettings {
  return {
    ...DEFAULT_GAME_SETTINGS,
    shadowQuality: defaultShadowQuality(matchMedia),
    bloomEnabled: defaultBloomEnabled(matchMedia),
  };
}

function clampedNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function booleanOrFallback(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function allowedOption<Option extends string>(value: unknown, options: readonly Option[], fallback: Option): Option {
  return options.find((option) => option === value) ?? fallback;
}

/** Fills gaps with defaults and clamps everything into its menu range, so stored junk can never reach the game. */
export function normalizeGameSettings(settings: Partial<Record<keyof GameSettings, unknown>>): GameSettings {
  return {
    fieldOfViewDegrees: Math.round(
      clampedNumber(
        settings.fieldOfViewDegrees,
        FIELD_OF_VIEW_MINIMUM_DEGREES,
        FIELD_OF_VIEW_MAXIMUM_DEGREES,
        DEFAULT_GAME_SETTINGS.fieldOfViewDegrees,
      ),
    ),
    lookSensitivity: clampedNumber(
      settings.lookSensitivity,
      LOOK_SENSITIVITY_MINIMUM,
      LOOK_SENSITIVITY_MAXIMUM,
      DEFAULT_GAME_SETTINGS.lookSensitivity,
    ),
    touchControlSize: allowedOption(settings.touchControlSize, TOUCH_CONTROL_SIZES, DEFAULT_GAME_SETTINGS.touchControlSize),
    touchHandedness: allowedOption(settings.touchHandedness, TOUCH_HANDEDNESS_OPTIONS, DEFAULT_GAME_SETTINGS.touchHandedness),
    touchOpacity: clampedNumber(
      settings.touchOpacity,
      TOUCH_OPACITY_MINIMUM,
      TOUCH_OPACITY_MAXIMUM,
      DEFAULT_GAME_SETTINGS.touchOpacity,
    ),
    touchJoystickMode: allowedOption(settings.touchJoystickMode, TOUCH_JOYSTICK_MODES, DEFAULT_GAME_SETTINGS.touchJoystickMode),
    shadowQuality: allowedOption(settings.shadowQuality, SHADOW_QUALITIES, defaultShadowQuality()),
    bloomEnabled: booleanOrFallback(settings.bloomEnabled, defaultBloomEnabled()),
  };
}
