import {
  TOUCH_OPACITY_MAXIMUM,
  TOUCH_OPACITY_MINIMUM,
  type GameSettings,
  type TouchControlSize,
  type TouchHandedness,
  type TouchJoystickMode,
} from "../../settings/game-settings";
import { uiEventProps } from "../ui-profiling";
import { useProfiledRender } from "../use-profiled-render";
import { ChoiceSetting, SettingsHint, SliderSetting } from "./setting-rows";

const SIZE_CHOICES: readonly { value: TouchControlSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const HANDEDNESS_CHOICES: readonly { value: TouchHandedness; label: string }[] = [
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
];

const JOYSTICK_CHOICES: readonly { value: TouchJoystickMode; label: string }[] = [
  { value: "floating", label: "Floating" },
  { value: "fixed", label: "Fixed" },
];

interface TouchSettingsProps {
  settings: GameSettings;
  onChange: (changes: Partial<GameSettings>) => void;
}

export function TouchSettings({ settings, onChange }: TouchSettingsProps) {
  useProfiledRender("touchSettings");
  return (
    <div className="flex flex-col gap-5" {...uiEventProps("touchSettings")}>
      <ChoiceSetting
        label="Button size"
        choices={SIZE_CHOICES}
        value={settings.touchControlSize}
        onChange={(touchControlSize) => onChange({ touchControlSize })}
      />
      <ChoiceSetting
        label="Hand for buttons"
        choices={HANDEDNESS_CHOICES}
        value={settings.touchHandedness}
        onChange={(touchHandedness) => onChange({ touchHandedness })}
      />
      <ChoiceSetting
        label="Joystick"
        choices={JOYSTICK_CHOICES}
        value={settings.touchJoystickMode}
        onChange={(touchJoystickMode) => onChange({ touchJoystickMode })}
      />
      <SliderSetting
        label="Opacity"
        valueText={`${Math.round(settings.touchOpacity * 100)}%`}
        min={TOUCH_OPACITY_MINIMUM}
        max={TOUCH_OPACITY_MAXIMUM}
        step={0.05}
        value={settings.touchOpacity}
        onChange={(touchOpacity) => onChange({ touchOpacity })}
      />
      <SettingsHint>
        Floating puts the joystick wherever your thumb lands. Fixed keeps it in the bottom corner opposite the buttons.
      </SettingsHint>
    </div>
  );
}
