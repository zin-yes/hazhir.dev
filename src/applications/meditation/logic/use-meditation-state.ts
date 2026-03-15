"use client";

/**
 * Central state hook for the meditation application.
 * Manages breathing timer, audio feedback, session persistence, and history.
 */

import { useSession } from "@/auth/client";
import { trpc } from "@/lib/trpc/client";
import { useEffect, useRef, useState } from "react";

import {
  BREATHING_PRESETS,
  type BreathingPresetName,
  type MeditationPhaseState,
  type MeditationSessionRecord,
  PHASE_TONE_FREQUENCIES,
  SESSION_COMPLETE_TONE_FREQUENCY,
} from "./breathing-presets";

export function useMeditationState() {
  const session = useSession();
  const isHistoryEnabled =
    session.status === "authenticated" && !session.isGuest;

  // --- Timer and playback state ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedDuration, setElapsedDuration] = useState(0);
  const [displayTime, setDisplayTime] = useState("00:00");
  const [phaseLabel, setPhaseLabel] = useState("Ready to begin");
  const [phaseSecondsRemaining, setPhaseSecondsRemaining] = useState(0);
  const [completedRoundCount, setCompletedRoundCount] = useState(0);
  const [currentPhaseState, setCurrentPhaseState] =
    useState<MeditationPhaseState>("idle");

  // --- Breathing configuration state ---
  const [selectedPreset, setSelectedPreset] =
    useState<BreathingPresetName>("beginner");
  const [inhaleSeconds, setInhaleSeconds] = useState(4);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [exhaleSeconds, setExhaleSeconds] = useState(4);
  const [switchSeconds, setSwitchSeconds] = useState(1);
  const [targetMinutes, setTargetMinutes] = useState(5);

  // --- UI state ---
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isHistoryListOpen, setIsHistoryListOpen] = useState(false);
  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null);
  const [selectedHistorySession, setSelectedHistorySession] =
    useState<MeditationSessionRecord | null>(null);
  const [isHistoryDetailDialogOpen, setIsHistoryDetailDialogOpen] =
    useState(false);

  // --- Server queries ---
  const historyQuery = trpc.meditation.list.useQuery(undefined, {
    enabled: isHistoryEnabled && isHistoryListOpen,
  });
  const saveSessionMutation = trpc.meditation.save.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
    },
  });

  const historySessionList = historyQuery.data?.sessions ?? [];
  const isHistoryLoading = historyQuery.isLoading;
  const historyErrorMessage = historyQuery.error?.message ?? null;
  const isSavingSession = saveSessionMutation.isPending;

  // --- Internal refs ---
  const audioContextReference = useRef<AudioContext | null>(null);
  const phaseTickIntervalReference = useRef<NodeJS.Timeout | null>(null);
  const timerTickIntervalReference = useRef<NodeJS.Timeout | null>(null);
  const sessionStartTimestampReference = useRef<number | null>(null);
  const timerStartTimestampReference = useRef<number | null>(null);
  const accumulatedElapsedSecondsReference = useRef(0);
  const currentPhaseIndexReference = useRef(0);
  const phaseSecondsRemainingReference = useRef(0);

  // Initialize audio context on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      audioContextReference.current = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }
    return () => {
      clearAllIntervals();
      audioContextReference.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Helper functions ---

  const clearAllIntervals = () => {
    if (phaseTickIntervalReference.current)
      clearInterval(phaseTickIntervalReference.current);
    if (timerTickIntervalReference.current)
      clearInterval(timerTickIntervalReference.current);
  };

  const formatDurationAsTimestamp = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const formatIsoTimestamp = (isoValue: string) => {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return isoValue;
    return date.toLocaleString();
  };

  const formatOptionalNumber = (
    value: number | null | undefined,
    suffix = "",
  ) => {
    if (value === null || value === undefined) return "-";
    return `${value}${suffix}`;
  };

  /** Play a short tone at the given frequency for audio feedback */
  const playToneAtFrequency = (frequency: number) => {
    if (!audioContextReference.current || isMuted) return;

    const oscillatorNode = audioContextReference.current.createOscillator();
    const gainNode = audioContextReference.current.createGain();

    oscillatorNode.connect(gainNode);
    gainNode.connect(audioContextReference.current.destination);

    oscillatorNode.frequency.value = frequency;
    gainNode.gain.setValueAtTime(
      0.3,
      audioContextReference.current.currentTime,
    );
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContextReference.current.currentTime + 0.3,
    );

    oscillatorNode.start(audioContextReference.current.currentTime);
    oscillatorNode.stop(audioContextReference.current.currentTime + 0.3);
  };

  /** Build the sequence of breathing phases from current configuration */
  const buildBreathingPhaseSequence = () => {
    return [
      {
        type: "inhale" as const,
        label: "Inhale Left",
        seconds: inhaleSeconds,
      },
      { type: "hold" as const, label: "Hold", seconds: holdSeconds },
      { type: "switch" as const, label: "Switch", seconds: switchSeconds },
      {
        type: "exhale" as const,
        label: "Exhale Right",
        seconds: exhaleSeconds,
      },
      {
        type: "inhale" as const,
        label: "Inhale Right",
        seconds: inhaleSeconds,
      },
      { type: "hold" as const, label: "Hold", seconds: holdSeconds },
      { type: "switch" as const, label: "Switch", seconds: switchSeconds },
      {
        type: "exhale" as const,
        label: "Exhale Left",
        seconds: exhaleSeconds,
      },
    ].filter((phase) => phase.seconds > 0);
  };

  /** Save a completed session to the server */
  const persistSessionToServer = async (
    endedAtTimestamp: number,
    durationSeconds: number,
  ) => {
    if (!isHistoryEnabled || !sessionStartTimestampReference.current) return;
    setSessionSaveError(null);

    const payload = {
      startedAt: sessionStartTimestampReference.current,
      endedAt: endedAtTimestamp,
      durationSeconds,
      preset: selectedPreset,
      inhaleSeconds,
      holdSeconds,
      exhaleSeconds,
      switchSeconds,
      targetMinutes,
      roundCount: completedRoundCount,
    };

    try {
      await saveSessionMutation.mutateAsync(payload);
    } catch (error) {
      setSessionSaveError(
        error instanceof Error ? error.message : "Unable to save session.",
      );
    }
  };

  /** Start the phase tick and timer intervals */
  const startTimerIntervals = (
    phases: ReturnType<typeof buildBreathingPhaseSequence>,
  ) => {
    clearAllIntervals();

    // Phase tick — counts down seconds within each breathing phase
    phaseTickIntervalReference.current = setInterval(() => {
      phaseSecondsRemainingReference.current -= 1;
      setPhaseSecondsRemaining(phaseSecondsRemainingReference.current);

      if (phaseSecondsRemainingReference.current <= 0) {
        currentPhaseIndexReference.current =
          (currentPhaseIndexReference.current + 1) % phases.length;
        if (currentPhaseIndexReference.current === 0) {
          setCompletedRoundCount((previous) => previous + 1);
        }

        const nextPhase = phases[currentPhaseIndexReference.current];
        phaseSecondsRemainingReference.current = nextPhase.seconds;
        setPhaseLabel(nextPhase.label);
        setCurrentPhaseState(nextPhase.type);
        playToneAtFrequency(PHASE_TONE_FREQUENCIES[nextPhase.type]);
      }
    }, 1000);

    // Timer tick — tracks total elapsed session time
    timerTickIntervalReference.current = setInterval(() => {
      if (timerStartTimestampReference.current) {
        const elapsed = Math.floor(
          (Date.now() - timerStartTimestampReference.current) / 1000,
        );
        accumulatedElapsedSecondsReference.current = elapsed;
        setElapsedDuration(elapsed);
        setDisplayTime(formatDurationAsTimestamp(elapsed));

        // Auto-stop when target duration is reached
        if (targetMinutes > 0 && elapsed >= targetMinutes * 60) {
          clearAllIntervals();
          setIsPlaying(false);
          setIsPaused(false);
          timerStartTimestampReference.current = null;
          phaseSecondsRemainingReference.current = 0;
          setPhaseSecondsRemaining(0);
          setCurrentPhaseState("complete");
          setPhaseLabel("Session complete");
          playToneAtFrequency(SESSION_COMPLETE_TONE_FREQUENCY);
        }
      }
    }, 1000);
  };

  // --- Public actions ---

  const startSession = () => {
    const phases = buildBreathingPhaseSequence();
    if (phases.length === 0) return;

    setIsPlaying(true);
    setIsPaused(false);
    sessionStartTimestampReference.current = Date.now();
    timerStartTimestampReference.current =
      sessionStartTimestampReference.current;
    accumulatedElapsedSecondsReference.current = 0;
    setElapsedDuration(0);
    setDisplayTime("00:00");
    setCompletedRoundCount(0);

    currentPhaseIndexReference.current = 0;
    phaseSecondsRemainingReference.current = phases[0].seconds;
    setPhaseLabel(phases[0].label);
    setCurrentPhaseState(phases[0].type);
    setPhaseSecondsRemaining(phases[0].seconds);

    playToneAtFrequency(PHASE_TONE_FREQUENCIES[phases[0].type]);
    startTimerIntervals(phases);
  };

  const pauseSession = () => {
    if (!isPlaying) return;
    clearAllIntervals();
    if (timerStartTimestampReference.current) {
      const elapsed = Math.floor(
        (Date.now() - timerStartTimestampReference.current) / 1000,
      );
      accumulatedElapsedSecondsReference.current = elapsed;
      setElapsedDuration(elapsed);
      setDisplayTime(formatDurationAsTimestamp(elapsed));
    }
    setIsPlaying(false);
    setIsPaused(true);
  };

  const resumeSession = () => {
    if (!isPaused) return;
    const phases = buildBreathingPhaseSequence();
    if (phases.length === 0) return;
    timerStartTimestampReference.current =
      Date.now() - accumulatedElapsedSecondsReference.current * 1000;
    setIsPlaying(true);
    setIsPaused(false);
    startTimerIntervals(phases);
  };

  const stopSession = async (shouldSaveSession: boolean) => {
    clearAllIntervals();
    const now = Date.now();
    const sessionStart = sessionStartTimestampReference.current;
    const finalDuration = isPaused
      ? accumulatedElapsedSecondsReference.current
      : timerStartTimestampReference.current
        ? Math.floor((now - timerStartTimestampReference.current) / 1000)
        : 0;

    accumulatedElapsedSecondsReference.current = finalDuration;
    setElapsedDuration(finalDuration);
    setIsPlaying(false);
    setIsPaused(false);
    timerStartTimestampReference.current = null;
    phaseSecondsRemainingReference.current = 0;
    setPhaseSecondsRemaining(0);
    setCurrentPhaseState("idle");
    setPhaseLabel("Ready to begin");
    setSessionSaveError(null);

    if (shouldSaveSession && finalDuration > 0 && sessionStart) {
      sessionStartTimestampReference.current = sessionStart;
      await persistSessionToServer(now, finalDuration);
    }

    sessionStartTimestampReference.current = null;
  };

  const applyBreathingPreset = (presetName: BreathingPresetName) => {
    setSelectedPreset(presetName);
    if (presetName !== "custom") {
      const configuration = BREATHING_PRESETS[presetName];
      setInhaleSeconds(configuration.inhale);
      setHoldSeconds(configuration.hold);
      setExhaleSeconds(configuration.exhale);
      setSwitchSeconds(configuration.switch);
    }
  };

  const updateInhaleSeconds = (value: number) => {
    setSelectedPreset("custom");
    setInhaleSeconds(Math.max(0, value));
  };

  const updateHoldSeconds = (value: number) => {
    setSelectedPreset("custom");
    setHoldSeconds(Math.max(0, value));
  };

  const updateExhaleSeconds = (value: number) => {
    setSelectedPreset("custom");
    setExhaleSeconds(Math.max(0, value));
  };

  const updateSwitchSeconds = (value: number) => {
    setSelectedPreset("custom");
    setSwitchSeconds(Math.max(0, value));
  };

  const updateTargetMinutes = (value: number) => {
    setTargetMinutes(Math.max(0, value));
  };

  // --- Derived display values ---

  const isSessionActive = isPlaying || isPaused;

  const isBrightPhaseBackground =
    currentPhaseState === "inhale" ||
    currentPhaseState === "hold" ||
    currentPhaseState === "switch" ||
    currentPhaseState === "complete";

  const phaseTransitionDurationMilliseconds =
    currentPhaseState === "inhale"
      ? inhaleSeconds * 1000
      : currentPhaseState === "exhale"
        ? exhaleSeconds * 1000
        : 300;

  const displayedPhaseLabel = isPaused ? "Paused" : phaseLabel;

  const statusSummaryText = isPlaying
    ? `${phaseSecondsRemaining}s left \u2022 Round ${completedRoundCount}`
    : isPaused
      ? "Paused"
      : currentPhaseState === "complete"
        ? "Session complete"
        : "Ready";

  const detailSummaryText = isPlaying
    ? `${phaseSecondsRemaining}s left \u2022 Round ${completedRoundCount}`
    : isPaused
      ? "Paused"
      : currentPhaseState === "complete"
        ? "Session complete"
        : `${inhaleSeconds}s inhale \u2022 ${exhaleSeconds}s exhale`;

  return {
    // Timer state
    isPlaying,
    isPaused,
    isSessionActive,
    displayTime,
    displayedPhaseLabel,
    statusSummaryText,
    detailSummaryText,

    // Phase display
    currentPhaseState,
    isBrightPhaseBackground,
    phaseTransitionDurationMilliseconds,

    // Configuration
    selectedPreset,
    inhaleSeconds,
    holdSeconds,
    exhaleSeconds,
    switchSeconds,
    targetMinutes,

    // Audio
    isMuted,
    setIsMuted,

    // Fullscreen
    isFullscreen,
    setIsFullscreen,

    // History
    isHistoryListOpen,
    setIsHistoryListOpen,
    historySessionList,
    isHistoryLoading,
    historyErrorMessage,
    isSavingSession,
    selectedHistorySession,
    setSelectedHistorySession,
    isHistoryDetailDialogOpen,
    setIsHistoryDetailDialogOpen,
    sessionSaveError,

    // Actions
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    applyBreathingPreset,
    updateInhaleSeconds,
    updateHoldSeconds,
    updateExhaleSeconds,
    updateSwitchSeconds,
    updateTargetMinutes,
    refreshHistory: () => historyQuery.refetch(),
    isHistoryEnabled,

    // Formatters (exposed for history dialogs)
    formatDurationAsTimestamp,
    formatIsoTimestamp,
    formatOptionalNumber,
  };
}
