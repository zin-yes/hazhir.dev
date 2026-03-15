"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { memo } from "react";

import type { BreathingPresetName } from "../logic/breathing-presets";

interface BreathingSettingsProps {
  selectedPreset: BreathingPresetName;
  inhaleSeconds: number;
  holdSeconds: number;
  exhaleSeconds: number;
  switchSeconds: number;
  targetMinutes: number;
  isSessionActive: boolean;
  onPresetChange: (preset: BreathingPresetName) => void;
  onInhaleChange: (value: number) => void;
  onHoldChange: (value: number) => void;
  onExhaleChange: (value: number) => void;
  onSwitchChange: (value: number) => void;
  onTargetMinutesChange: (value: number) => void;
}

/** Breathing configuration panel: preset selector, phase durations, and target timer */
const BreathingSettings = memo(function BreathingSettings({
  selectedPreset,
  inhaleSeconds,
  holdSeconds,
  exhaleSeconds,
  switchSeconds,
  targetMinutes,
  isSessionActive,
  onPresetChange,
  onInhaleChange,
  onHoldChange,
  onExhaleChange,
  onSwitchChange,
  onTargetMinutesChange,
}: BreathingSettingsProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Breathing Preset</Label>
          <Select
            value={selectedPreset}
            onValueChange={(value) =>
              onPresetChange(value as BreathingPresetName)
            }
            disabled={isSessionActive}
          >
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
            onChange={(event) =>
              onTargetMinutesChange(parseInt(event.target.value) || 0)
            }
            disabled={isSessionActive}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-2">
          <Label className="text-xs">Inhale (s)</Label>
          <Input
            type="number"
            min={0}
            value={inhaleSeconds}
            onChange={(event) =>
              onInhaleChange(parseInt(event.target.value) || 0)
            }
            disabled={isSessionActive}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Hold (s)</Label>
          <Input
            type="number"
            min={0}
            value={holdSeconds}
            onChange={(event) =>
              onHoldChange(parseInt(event.target.value) || 0)
            }
            disabled={isSessionActive}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Exhale (s)</Label>
          <Input
            type="number"
            min={0}
            value={exhaleSeconds}
            onChange={(event) =>
              onExhaleChange(parseInt(event.target.value) || 0)
            }
            disabled={isSessionActive}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Switch (s)</Label>
          <Input
            type="number"
            min={0}
            value={switchSeconds}
            onChange={(event) =>
              onSwitchChange(parseInt(event.target.value) || 0)
            }
            disabled={isSessionActive}
          />
        </div>
      </div>
    </div>
  );
});

export default BreathingSettings;
