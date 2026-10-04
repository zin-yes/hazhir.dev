import {
  LOOK_SENSITIVITY_MAXIMUM,
  LOOK_SENSITIVITY_MINIMUM,
  type GameSettings,
} from "../../settings/game-settings";
import { ControlsList } from "./controls-list";
import { SettingsHeading, SettingsHint, SliderSetting } from "./setting-rows";

interface ControlsSettingsProps {
  lookSensitivity: GameSettings["lookSensitivity"];
  onLookSensitivityChange: (sensitivity: number) => void;
  isMobile: boolean;
}

export function ControlsSettings({ lookSensitivity, onLookSensitivityChange, isMobile }: ControlsSettingsProps) {
  return (
    <div className="flex flex-col gap-5">
      <SliderSetting
        label="Look sensitivity"
        valueText={`${lookSensitivity.toFixed(2)}x`}
        min={LOOK_SENSITIVITY_MINIMUM}
        max={LOOK_SENSITIVITY_MAXIMUM}
        step={0.05}
        value={lookSensitivity}
        onChange={onLookSensitivityChange}
      />
      <SettingsHint>Applies to mouse and touch look.</SettingsHint>
      {!isMobile && (
        <>
          <SettingsHeading>Keys</SettingsHeading>
          <ControlsList />
        </>
      )}
    </div>
  );
}
