import type { GameSettings, TouchControlSize } from "../../settings/game-settings";

/** Pixel sizes of each touch control at a given size setting. */
export interface TouchLayout {
  smallButton: number;
  mediumButton: number;
  jumpButton: number;
  joystickRadius: number;
  stickSize: number;
}

const SIZE_SCALE: Record<TouchControlSize, number> = {
  small: 0.8,
  medium: 1,
  large: 1.25,
};

export function touchLayoutFor(size: TouchControlSize): TouchLayout {
  const scale = SIZE_SCALE[size];
  return {
    smallButton: Math.round(44 * scale),
    mediumButton: Math.round(56 * scale),
    jumpButton: Math.round(64 * scale),
    joystickRadius: Math.round(50 * scale),
    stickSize: Math.round(40 * scale),
  };
}

/** Whether a touch at this horizontal fraction of the screen belongs to the joystick rather than the camera. */
export function isJoystickSide(
  horizontalFraction: number,
  handedness: GameSettings["touchHandedness"],
): boolean {
  return handedness === "right" ? horizontalFraction < 0.4 : horizontalFraction > 0.6;
}

/** Fixed joystick base position, as a distance in pixels from the screen edge and the bottom. */
export const FIXED_JOYSTICK_EDGE_INSET = 28;
export const FIXED_JOYSTICK_BOTTOM_INSET = 112;
