"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { memo } from "react";

import type { MeditationSessionRecord } from "../logic/breathing-presets";

interface SessionDetailDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  session: MeditationSessionRecord | null;
  formatTimestamp: (iso: string) => string;
  formatDuration: (seconds: number) => string;
  formatOptionalNumber: (
    value: number | null | undefined,
    suffix?: string,
  ) => string;
}

/** Dialog showing full details of a single meditation session */
const SessionDetailDialog = memo(function SessionDetailDialog({
  isOpen,
  onOpenChange,
  session,
  formatTimestamp,
  formatDuration,
  formatOptionalNumber,
}: SessionDetailDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session details</DialogTitle>
          <DialogDescription>
            Extended session info for your meditation practice.
          </DialogDescription>
        </DialogHeader>
        {session && (
          <div className="grid gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Started</p>
              <p>{formatTimestamp(session.startedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ended</p>
              <p>{formatTimestamp(session.endedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Duration</p>
              <p>{formatDuration(session.durationSeconds)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Preset</p>
              <p>{session.preset ?? "custom"}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Inhale</p>
                <p>{formatOptionalNumber(session.inhaleSeconds, "s")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hold</p>
                <p>{formatOptionalNumber(session.holdSeconds, "s")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Exhale</p>
                <p>{formatOptionalNumber(session.exhaleSeconds, "s")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Switch</p>
                <p>{formatOptionalNumber(session.switchSeconds, "s")}</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Target</p>
                <p>{formatOptionalNumber(session.targetMinutes, " min")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Rounds</p>
                <p>{formatOptionalNumber(session.roundCount)}</p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

export default SessionDetailDialog;
