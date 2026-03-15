"use client";

import { Button } from "@/components/ui/button";
import { Maximize } from "lucide-react";

import BreathingDisplay from "./components/breathing-display";
import BreathingSettings from "./components/breathing-settings";
import FullscreenView from "./components/fullscreen-view";
import SessionControls from "./components/session-controls";
import SessionDetailDialog from "./components/session-detail-dialog";
import SessionHistoryDialog from "./components/session-history-dialog";
import { useMeditationState } from "./logic/use-meditation-state";

export default function MeditationApplication() {
  const meditation = useMeditationState();

  // Fullscreen mode takes over the entire viewport
  if (meditation.isFullscreen) {
    return (
      <FullscreenView
        displayTime={meditation.displayTime}
        displayedPhaseLabel={meditation.displayedPhaseLabel}
        statusSummaryText={meditation.statusSummaryText}
        isBrightPhaseBackground={meditation.isBrightPhaseBackground}
        phaseTransitionDurationMilliseconds={
          meditation.phaseTransitionDurationMilliseconds
        }
        onExitFullscreen={() => meditation.setIsFullscreen(false)}
      />
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-background p-6 text-foreground">
      <div className="mx-auto max-w-2xl space-y-4">
        {/* Timer display with fullscreen toggle */}
        <div className="relative">
          <BreathingDisplay
            displayTime={meditation.displayTime}
            displayedPhaseLabel={meditation.displayedPhaseLabel}
            detailSummaryText={meditation.detailSummaryText}
            targetMinutes={meditation.targetMinutes}
            isBrightPhaseBackground={meditation.isBrightPhaseBackground}
            phaseTransitionDurationMilliseconds={
              meditation.phaseTransitionDurationMilliseconds
            }
          />
          <Button
            onClick={() => meditation.setIsFullscreen(true)}
            size="icon"
            variant="ghost"
            className="absolute right-2 top-2"
          >
            <Maximize className="h-4 w-4" />
          </Button>
        </div>

        {/* Playback controls */}
        <SessionControls
          isSessionActive={meditation.isSessionActive}
          isPlaying={meditation.isPlaying}
          isPaused={meditation.isPaused}
          isMuted={meditation.isMuted}
          isSavingSession={meditation.isSavingSession}
          onStart={meditation.startSession}
          onPause={meditation.pauseSession}
          onResume={meditation.resumeSession}
          onStop={() => meditation.stopSession(true)}
          onToggleMute={() => meditation.setIsMuted((previous) => !previous)}
          onOpenHistory={() => meditation.setIsHistoryListOpen(true)}
        />

        {/* Breathing configuration */}
        <BreathingSettings
          selectedPreset={meditation.selectedPreset}
          inhaleSeconds={meditation.inhaleSeconds}
          holdSeconds={meditation.holdSeconds}
          exhaleSeconds={meditation.exhaleSeconds}
          switchSeconds={meditation.switchSeconds}
          targetMinutes={meditation.targetMinutes}
          isSessionActive={meditation.isSessionActive}
          onPresetChange={meditation.applyBreathingPreset}
          onInhaleChange={meditation.updateInhaleSeconds}
          onHoldChange={meditation.updateHoldSeconds}
          onExhaleChange={meditation.updateExhaleSeconds}
          onSwitchChange={meditation.updateSwitchSeconds}
          onTargetMinutesChange={meditation.updateTargetMinutes}
        />

        {/* Breathing technique description */}
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium">
            Nadi Shuddhi (Alternate Nostril Breathing)
          </p>
          <p>
            A balancing pranayama practice for left and right energy channels.
            Follow the phase cues to maintain steady breathing rhythm.
          </p>
        </div>

        {/* Session save error banner */}
        {meditation.sessionSaveError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {meditation.sessionSaveError}
          </div>
        )}
      </div>

      {/* Session history list dialog */}
      <SessionHistoryDialog
        isOpen={meditation.isHistoryListOpen}
        onOpenChange={meditation.setIsHistoryListOpen}
        isHistoryEnabled={meditation.isHistoryEnabled}
        isLoading={meditation.isHistoryLoading}
        errorMessage={meditation.historyErrorMessage}
        sessionList={meditation.historySessionList}
        onRefresh={meditation.refreshHistory}
        onSelectSession={(session) => {
          meditation.setSelectedHistorySession(session);
          meditation.setIsHistoryDetailDialogOpen(true);
        }}
        formatTimestamp={meditation.formatIsoTimestamp}
        formatDuration={meditation.formatDurationAsTimestamp}
      />

      {/* Individual session detail dialog */}
      <SessionDetailDialog
        isOpen={meditation.isHistoryDetailDialogOpen}
        onOpenChange={(open) => {
          meditation.setIsHistoryDetailDialogOpen(open);
          if (!open) meditation.setSelectedHistorySession(null);
        }}
        session={meditation.selectedHistorySession}
        formatTimestamp={meditation.formatIsoTimestamp}
        formatDuration={meditation.formatDurationAsTimestamp}
        formatOptionalNumber={meditation.formatOptionalNumber}
      />
    </div>
  );
}
