"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { memo } from "react";

import type { MeditationSessionRecord } from "../logic/breathing-presets";

interface SessionHistoryDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isHistoryEnabled: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  sessionList: MeditationSessionRecord[];
  onRefresh: () => void;
  onSelectSession: (session: MeditationSessionRecord) => void;
  formatTimestamp: (iso: string) => string;
  formatDuration: (seconds: number) => string;
}

/** Dialog listing all saved meditation sessions with a detail button for each */
const SessionHistoryDialog = memo(function SessionHistoryDialog({
  isOpen,
  onOpenChange,
  isHistoryEnabled,
  isLoading,
  errorMessage,
  sessionList,
  onRefresh,
  onSelectSession,
  formatTimestamp,
  formatDuration,
}: SessionHistoryDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
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
                onClick={onRefresh}
                disabled={isLoading}
              >
                Refresh
              </Button>
            )}
          </div>

          {!isHistoryEnabled ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Sign in to save and view your meditation history.
            </p>
          ) : isLoading ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Loading sessions...
            </p>
          ) : errorMessage ? (
            <p className="mt-3 text-xs text-destructive">{errorMessage}</p>
          ) : sessionList.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No sessions saved yet.
            </p>
          ) : (
            <div className="mt-3 max-h-[340px] space-y-2 overflow-y-auto pr-2">
              {sessionList.map((sessionItem) => (
                <div
                  key={sessionItem.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/70 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {formatTimestamp(sessionItem.startedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Duration: {formatDuration(sessionItem.durationSeconds)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectSession(sessionItem)}
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
  );
});

export default SessionHistoryDialog;
