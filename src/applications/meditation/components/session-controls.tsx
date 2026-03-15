"use client";

import { Button } from "@/components/ui/button";
import { Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import { memo } from "react";

interface SessionControlsProps {
  isSessionActive: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  isMuted: boolean;
  isSavingSession: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  onOpenHistory: () => void;
}

/** Playback controls: start/pause/resume, stop & save, mute toggle, history button */
const SessionControls = memo(function SessionControls({
  isSessionActive,
  isPlaying,
  isPaused,
  isMuted,
  isSavingSession,
  onStart,
  onPause,
  onResume,
  onStop,
  onToggleMute,
  onOpenHistory,
}: SessionControlsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {!isSessionActive ? (
        <Button onClick={onStart} size="lg" className="flex-1 sm:flex-initial">
          <Play className="mr-2 h-5 w-5" />
          Start
        </Button>
      ) : isPaused ? (
        <Button onClick={onResume} size="lg" className="flex-1 sm:flex-initial">
          <Play className="mr-2 h-5 w-5" />
          Resume
        </Button>
      ) : (
        <Button onClick={onPause} size="lg" className="flex-1 sm:flex-initial">
          <Pause className="mr-2 h-5 w-5" />
          Pause
        </Button>
      )}

      {isSessionActive && (
        <Button
          onClick={onStop}
          size="lg"
          variant="destructive"
          className="flex-1 sm:flex-initial"
          disabled={isSavingSession}
        >
          <Square className="mr-2 h-5 w-5" />
          {isSavingSession ? "Saving..." : "Stop & Save"}
        </Button>
      )}

      <Button onClick={onToggleMute} size="icon" variant="outline">
        {isMuted ? (
          <VolumeX className="h-5 w-5" />
        ) : (
          <Volume2 className="h-5 w-5" />
        )}
      </Button>

      <Button type="button" variant="outline" onClick={onOpenHistory}>
        View history
      </Button>
    </div>
  );
});

export default SessionControls;
