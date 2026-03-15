/**
 * Types and preset configurations for the meditation breathing timer.
 */

export type BreathingPhaseTone = "soft" | "low" | "mid" | "high" | "silent";

export type BreathingPhaseType = "inhale" | "hold" | "exhale" | "switch";

export type BreathingPresetName =
  | "custom"
  | "beginner"
  | "intermediate"
  | "advanced";

export type BreathingPhaseConfiguration = {
  inhale: number;
  hold: number;
  exhale: number;
  switch: number;
};

export type MeditationSessionRecord = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  preset: string | null;
  inhaleSeconds: number | null;
  holdSeconds: number | null;
  exhaleSeconds: number | null;
  switchSeconds: number | null;
  targetMinutes: number | null;
  roundCount: number | null;
};

/**
 * The current state of the meditation timer's active phase.
 * "idle" = not started, "complete" = session finished.
 */
export type MeditationPhaseState = BreathingPhaseType | "idle" | "complete";

/** Pre-defined breathing timing configurations */
export const BREATHING_PRESETS: Record<
  Exclude<BreathingPresetName, "custom">,
  BreathingPhaseConfiguration
> = {
  beginner: { inhale: 4, hold: 0, exhale: 4, switch: 1 },
  intermediate: { inhale: 4, hold: 4, exhale: 8, switch: 1 },
  advanced: { inhale: 5, hold: 20, exhale: 10, switch: 10 },
};

/** Tone frequency for each breathing phase */
export const PHASE_TONE_FREQUENCIES: Record<BreathingPhaseType, number> = {
  inhale: 523.25,
  hold: 660,
  exhale: 392,
  switch: 784,
};

/** Session-complete tone frequency */
export const SESSION_COMPLETE_TONE_FREQUENCY = 880;
