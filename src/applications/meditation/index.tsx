"use client";

import { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
} from "lucide-react";
import { useSession } from "@/auth/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PhaseTone = "soft" | "low" | "mid" | "high" | "silent";
type BreathingPhaseType = "inhale" | "hold" | "exhale" | "switch";
type BreathingPreset = "custom" | "beginner" | "intermediate" | "advanced";

type MeditationSessionRecord = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  preset: BreathingPreset | null;
  inhaleSeconds: number | null;
  holdSeconds: number | null;
  exhaleSeconds: number | null;
  switchSeconds: number | null;
  targetMinutes: number | null;
  roundCount: number | null;
};

const BREATHING_PRESETS: Record<
  Exclude<BreathingPreset, "custom">,
  { inhale: number; hold: number; exhale: number; switch: number }
> = {
  beginner: { inhale: 4, hold: 0, exhale: 4, switch: 1 },
  intermediate: { inhale: 4, hold: 4, exhale: 8, switch: 1 },
  advanced: { inhale: 5, hold: 20, exhale: 10, switch: 10 },
};

export default function MeditationApplication() {
  const session = useSession();
  const isHistoryEnabled =
    session.status === "authenticated" && !session.isGuest;
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [preset, setPreset] = useState<BreathingPreset>("beginner");
  const [inhaleSeconds, setInhaleSeconds] = useState<number>(4);
  const [holdSeconds, setHoldSeconds] = useState<number>(0);
  const [exhaleSeconds, setExhaleSeconds] = useState<number>(4);
  const [switchSeconds, setSwitchSeconds] = useState<number>(1);
  const [targetMinutes, setTargetMinutes] = useState<number>(5);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const [displayTime, setDisplayTime] = useState("00:00");
  const [phaseLabel, setPhaseLabel] = useState("Ready to begin");
  const [phaseSecondsLeft, setPhaseSecondsLeft] = useState<number>(0);
  const [roundCount, setRoundCount] = useState<number>(0);
  const [phaseType, setPhaseType] = useState<BreathingPhaseType | "idle" | "complete">("idle");
  const [isHistoryListOpen, setIsHistoryListOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] =
    useState<MeditationSessionRecord | null>(null);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);

  const historyQuery = trpc.meditation.list.useQuery(undefined, {
    enabled: isHistoryEnabled && isHistoryListOpen,
  });
  const saveSessionMutation = trpc.meditation.save.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
    },
  });
  const history = historyQuery.data?.sessions ?? [];
  const isHistoryLoading = historyQuery.isLoading;
  const historyError = historyQuery.error?.message ?? null;
  const isSavingSession = saveSessionMutation.isPending;

  const audioContextRef = useRef<AudioContext | null>(null);
  const secondIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const elapsedSecondsRef = useRef(0);
  const phaseIndexRef = useRef(0);
  const phaseSecondsLeftRef = useRef(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return () => {
      stopIntervals();
      audioContextRef.current?.close();
    };
  }, []);

  const stopIntervals = () => {
    if (secondIntervalRef.current) clearInterval(secondIntervalRef.current);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  };

  const formatDuration = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const formatTimestamp = (isoValue: string) => {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return isoValue;
    return date.toLocaleString();
  };

  const formatOptionalNumber = (value: number | null | undefined, suffix = "") => {
    if (value === null || value === undefined) return "-";
    return `${value}${suffix}`;
  };

  const saveSession = async (endedAt: number, durationSeconds: number) => {
    if (!isHistoryEnabled || !sessionStartRef.current) return;
    setSaveError(null);
    const payload = {
      startedAt: sessionStartRef.current,
      endedAt,
      durationSeconds,
      preset,
      inhaleSeconds,
      holdSeconds,
      exhaleSeconds,
      switchSeconds,
      targetMinutes,
      roundCount,
    };

    try {
      await saveSessionMutation.mutateAsync(payload);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Unable to save session.",
      );
    }
  };

  const playTone = (frequency: number) => {
    if (!audioContextRef.current || isMuted) return;
    
    const oscillator = audioContextRef.current.createOscillator();
    const gainNode = audioContextRef.current.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);
    
    oscillator.frequency.value = frequency;
    gainNode.gain.setValueAtTime(0.3, audioContextRef.current.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.3);
    
    oscillator.start(audioContextRef.current.currentTime);
    oscillator.stop(audioContextRef.current.currentTime + 0.3);
  };

  const buildPhases = () => {
    return [
      { type: "inhale" as const, label: "Inhale Left", seconds: inhaleSeconds },
      { type: "hold" as const, label: "Hold", seconds: holdSeconds },
      { type: "switch" as const, label: "Switch", seconds: switchSeconds },
      { type: "exhale" as const, label: "Exhale Right", seconds: exhaleSeconds },
      { type: "inhale" as const, label: "Inhale Right", seconds: inhaleSeconds },
      { type: "hold" as const, label: "Hold", seconds: holdSeconds },
      { type: "switch" as const, label: "Switch", seconds: switchSeconds },
      { type: "exhale" as const, label: "Exhale Left", seconds: exhaleSeconds },
    ].filter(p => p.seconds > 0);
  };

  const getToneFrequency = (type: BreathingPhaseType) => {
    const frequencies = { inhale: 523.25, hold: 660, exhale: 392, switch: 784 };
    return frequencies[type];
  };

  const startIntervals = (phases: ReturnType<typeof buildPhases>) => {
    stopIntervals();

    secondIntervalRef.current = setInterval(() => {
      phaseSecondsLeftRef.current -= 1;
      setPhaseSecondsLeft(phaseSecondsLeftRef.current);

      if (phaseSecondsLeftRef.current <= 0) {
        phaseIndexRef.current = (phaseIndexRef.current + 1) % phases.length;
        if (phaseIndexRef.current === 0) setRoundCount((prev) => prev + 1);

        const nextPhase = phases[phaseIndexRef.current];
        phaseSecondsLeftRef.current = nextPhase.seconds;
        setPhaseLabel(nextPhase.label);
        setPhaseType(nextPhase.type);
        playTone(getToneFrequency(nextPhase.type));
      }
    }, 1000);

    timerIntervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        elapsedSecondsRef.current = elapsed;
        setDuration(elapsed);
        setDisplayTime(formatDuration(elapsed));

        if (targetMinutes > 0 && elapsed >= targetMinutes * 60) {
          stopIntervals();
          setIsPlaying(false);
          setIsPaused(false);
          startTimeRef.current = null;
          phaseSecondsLeftRef.current = 0;
          setPhaseSecondsLeft(0);
          setPhaseType("complete");
          setPhaseLabel("Session complete");
          playTone(880);
        }
      }
    }, 1000);
  };

  const handleStart = () => {
    const phases = buildPhases();
    if (phases.length === 0) return;

    setIsPlaying(true);
    setIsPaused(false);
    sessionStartRef.current = Date.now();
    startTimeRef.current = sessionStartRef.current;
    elapsedSecondsRef.current = 0;
    setDuration(0);
    setDisplayTime("00:00");
    setRoundCount(0);

    phaseIndexRef.current = 0;
    phaseSecondsLeftRef.current = phases[0].seconds;
    setPhaseLabel(phases[0].label);
    setPhaseType(phases[0].type);
    setPhaseSecondsLeft(phases[0].seconds);

    playTone(getToneFrequency(phases[0].type));

    startIntervals(phases);
  };

  const handlePause = () => {
    if (!isPlaying) return;
    stopIntervals();
    if (startTimeRef.current) {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      elapsedSecondsRef.current = elapsed;
      setDuration(elapsed);
      setDisplayTime(formatDuration(elapsed));
    }
    setIsPlaying(false);
    setIsPaused(true);
  };

  const handleResume = () => {
    if (!isPaused) return;
    const phases = buildPhases();
    if (phases.length === 0) return;
    startTimeRef.current = Date.now() - elapsedSecondsRef.current * 1000;
    setIsPlaying(true);
    setIsPaused(false);
    startIntervals(phases);
  };

  const handleStop = async (shouldSave: boolean) => {
    stopIntervals();
    const now = Date.now();
    const sessionStart = sessionStartRef.current;
    const finalDuration = isPaused
      ? elapsedSecondsRef.current
      : startTimeRef.current
        ? Math.floor((now - startTimeRef.current) / 1000)
        : 0;
    elapsedSecondsRef.current = finalDuration;
    setDuration(finalDuration);
    setIsPlaying(false);
    setIsPaused(false);
    startTimeRef.current = null;
    phaseSecondsLeftRef.current = 0;
    setPhaseSecondsLeft(0);
    setPhaseType("idle");
    setPhaseLabel("Ready to begin");
    setSaveError(null);

    if (shouldSave && finalDuration > 0 && sessionStart) {
      sessionStartRef.current = sessionStart;
      await saveSession(now, finalDuration);
    }

    sessionStartRef.current = null;
  };

  const applyPreset = (value: BreathingPreset) => {
    setPreset(value);
    if (value !== "custom") {
      const config = BREATHING_PRESETS[value];
      setInhaleSeconds(config.inhale);
      setHoldSeconds(config.hold);
      setExhaleSeconds(config.exhale);
      setSwitchSeconds(config.switch);
    }
  };

  const isBrightSurface = phaseType === "inhale" || phaseType === "hold" || phaseType === "switch" || phaseType === "complete";
  const transitionDuration = phaseType === "inhale" ? inhaleSeconds * 1000 : phaseType === "exhale" ? exhaleSeconds * 1000 : 300;
  const isSessionActive = isPlaying || isPaused;
  const displayPhaseLabel = isPaused ? "Paused" : phaseLabel;
  const statusText = isPlaying
    ? `${phaseSecondsLeft}s left • Round ${roundCount}`
    : isPaused
      ? "Paused"
      : phaseType === "complete"
        ? "Session complete"
        : "Ready";
  const detailText = isPlaying
    ? `${phaseSecondsLeft}s left • Round ${roundCount}`
    : isPaused
      ? "Paused"
      : phaseType === "complete"
        ? "Session complete"
        : `${inhaleSeconds}s inhale • ${exhaleSeconds}s exhale`;

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <Button onClick={() => setIsFullscreen(false)} size="icon" variant="ghost" className="absolute top-4 right-4">
          <Minimize className="h-5 w-5" />
        </Button>
        <div
          className={`flex h-full w-full items-center justify-center text-center transition-colors ${
            isBrightSurface
              ? "bg-white text-black border-white"
              : "bg-background text-foreground border-foreground/20"
          }`}
          style={{ transitionDuration: `${transitionDuration}ms`, transitionTimingFunction: "linear" }}
        >
          <div>
            <div className="font-mono text-8xl font-bold">{displayTime}</div>
            <p className="mt-6 text-2xl font-medium">{displayPhaseLabel}</p>
            <p className="mt-3 text-lg opacity-70">
              {statusText}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-background p-6 text-foreground">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="relative">
          <div
            className={`rounded-xl border p-6 text-center transition-colors ${isBrightSurface ? "bg-white text-black" : "bg-background text-foreground"}`}
            style={{ transitionDuration: `${transitionDuration}ms`, transitionTimingFunction: "linear" }}
          >
            <div className="font-mono text-5xl font-bold">{displayTime}</div>
            <p className="mt-3 text-lg font-medium">{displayPhaseLabel}</p>
            <p className="mt-2 text-sm opacity-70">
              {detailText}
            </p>
            {targetMinutes > 0 && <p className="mt-1 text-xs opacity-60">Target: {targetMinutes} min</p>}
          </div>
          <Button onClick={() => setIsFullscreen(true)} size="icon" variant="ghost" className="absolute top-2 right-2">
            <Maximize className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {!isSessionActive ? (
            <Button onClick={handleStart} size="lg" className="flex-1 sm:flex-initial">
              <Play className="h-5 w-5 mr-2" />
              Start
            </Button>
          ) : isPaused ? (
            <Button onClick={handleResume} size="lg" className="flex-1 sm:flex-initial">
              <Play className="h-5 w-5 mr-2" />
              Resume
            </Button>
          ) : (
            <Button onClick={handlePause} size="lg" className="flex-1 sm:flex-initial">
              <Pause className="h-5 w-5 mr-2" />
              Pause
            </Button>
          )}
          {isSessionActive && (
            <Button
              onClick={() => handleStop(true)}
              size="lg"
              variant="destructive"
              className="flex-1 sm:flex-initial"
              disabled={isSavingSession}
            >
              <Square className="h-5 w-5 mr-2" />
              {isSavingSession ? "Saving..." : "Stop & Save"}
            </Button>
          )}
          <Button onClick={() => setIsMuted(!isMuted)} size="icon" variant="outline">
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsHistoryListOpen(true)}
          >
            View history
          </Button>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Breathing Preset</Label>
              <Select value={preset} onValueChange={(v) => applyPreset(v as BreathingPreset)} disabled={isSessionActive}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Session Timer (min)</Label>
              <Input
                type="number"
                min={0}
                max={180}
                value={targetMinutes}
                onChange={(e) => setTargetMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                disabled={isSessionActive}
              />
            </div>
          </div>

          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <div className="space-y-2">
              <Label className="text-xs">Inhale (s)</Label>
              <Input
                type="number"
                min={0}
                value={inhaleSeconds}
                onChange={(e) => { setPreset("custom"); setInhaleSeconds(Math.max(0, parseInt(e.target.value) || 0)); }}
                disabled={isSessionActive}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Hold (s)</Label>
              <Input
                type="number"
                min={0}
                value={holdSeconds}
                onChange={(e) => { setPreset("custom"); setHoldSeconds(Math.max(0, parseInt(e.target.value) || 0)); }}
                disabled={isSessionActive}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Exhale (s)</Label>
              <Input
                type="number"
                min={0}
                value={exhaleSeconds}
                onChange={(e) => { setPreset("custom"); setExhaleSeconds(Math.max(0, parseInt(e.target.value) || 0)); }}
                disabled={isSessionActive}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Switch (s)</Label>
              <Input
                type="number"
                min={0}
                value={switchSeconds}
                onChange={(e) => { setPreset("custom"); setSwitchSeconds(Math.max(0, parseInt(e.target.value) || 0)); }}
                disabled={isSessionActive}
              />
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium mb-1">Nadi Shuddhi (Alternate Nostril Breathing)</p>
          <p>A balancing pranayama practice for left and right energy channels. Follow the phase cues to maintain steady breathing rhythm.</p>
        </div>

        {saveError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {saveError}
          </div>
        )}

      </div>

      <Dialog open={isHistoryListOpen} onOpenChange={setIsHistoryListOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Session history</DialogTitle>
            <DialogDescription>
              Review saved sessions and open details for timing breakdowns.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Recent sessions</p>
              {isHistoryEnabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => historyQuery.refetch()}
                  disabled={isHistoryLoading}
                >
                  Refresh
                </Button>
              )}
            </div>
            {!isHistoryEnabled ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Sign in to save and view your meditation history.
              </p>
            ) : isHistoryLoading ? (
              <p className="mt-3 text-xs text-muted-foreground">Loading sessions...</p>
            ) : historyError ? (
              <p className="mt-3 text-xs text-destructive">{historyError}</p>
            ) : history.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No sessions saved yet.</p>
            ) : (
              <div className="mt-3 max-h-[340px] space-y-2 overflow-y-auto pr-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/70 px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {formatTimestamp(item.startedAt)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Duration: {formatDuration(item.durationSeconds)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedSession(item);
                        setIsHistoryDialogOpen(true);
                      }}
                    >
                      Details
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isHistoryDialogOpen}
        onOpenChange={(open) => {
          setIsHistoryDialogOpen(open);
          if (!open) setSelectedSession(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session details</DialogTitle>
            <DialogDescription>
              Extended session info for your meditation practice.
            </DialogDescription>
          </DialogHeader>
          {selectedSession && (
            <div className="grid gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Started</p>
                <p>{formatTimestamp(selectedSession.startedAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ended</p>
                <p>{formatTimestamp(selectedSession.endedAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Duration</p>
                <p>{formatDuration(selectedSession.durationSeconds)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Preset</p>
                <p>{selectedSession.preset ?? "custom"}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Inhale</p>
                  <p>{formatOptionalNumber(selectedSession.inhaleSeconds, "s")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Hold</p>
                  <p>{formatOptionalNumber(selectedSession.holdSeconds, "s")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Exhale</p>
                  <p>{formatOptionalNumber(selectedSession.exhaleSeconds, "s")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Switch</p>
                  <p>{formatOptionalNumber(selectedSession.switchSeconds, "s")}</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Target</p>
                  <p>{formatOptionalNumber(selectedSession.targetMinutes, " min")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Rounds</p>
                  <p>{formatOptionalNumber(selectedSession.roundCount)}</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
