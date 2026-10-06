import { PixelButton, PixelSlider, PixelToggle } from "../pixel/pixel-ui";
import { profileSettingChange } from "../ui-profiling";
import { useProfiledRender } from "../use-profiled-render";

export function SettingsHint({ children }: { children: string }) {
  return <p className="text-center text-[0.65rem] leading-relaxed text-[#6e6590]">{children}</p>;
}

export function SettingsHeading({ children }: { children: string }) {
  return <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[#9a91bd]">{children}</h3>;
}

interface SliderSettingProps {
  label: string;
  valueText: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

export function SliderSetting({ label, valueText, onChange, ...sliderProps }: SliderSettingProps) {
  useProfiledRender("sliderSetting");
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm text-[#d8d2f0]">
        <span>{label}</span>
        <span className="text-[#b6f24a]">{valueText}</span>
      </div>
      <PixelSlider
        label={label}
        {...sliderProps}
        onChange={(value) => profileSettingChange(label, () => onChange(value))}
      />
    </div>
  );
}

interface ToggleSettingProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleSetting({ label, description, checked, onChange }: ToggleSettingProps) {
  useProfiledRender("toggleSetting");
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1 text-sm text-[#d8d2f0]">
        <span>{label}</span>
        {description && <span className="text-[0.65rem] leading-relaxed text-[#6e6590]">{description}</span>}
      </div>
      <PixelToggle
        label={label}
        checked={checked}
        onChange={(nextChecked) => profileSettingChange(label, () => onChange(nextChecked))}
      />
    </div>
  );
}

interface ChoiceSettingProps<Choice extends string> {
  label: string;
  choices: readonly { value: Choice; label: string }[];
  value: Choice;
  onChange: (value: Choice) => void;
}

export function ChoiceSetting<Choice extends string>({ label, choices, value, onChange }: ChoiceSettingProps<Choice>) {
  useProfiledRender("choiceSetting");
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-[#d8d2f0]">{label}</span>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
        {choices.map((choice) => (
          <PixelButton
            key={choice.value}
            tone={choice.value === value ? "tabActive" : "tab"}
            aria-pressed={choice.value === value}
            onClick={() => profileSettingChange(label, () => onChange(choice.value))}
          >
            {choice.label}
          </PixelButton>
        ))}
      </div>
    </div>
  );
}
