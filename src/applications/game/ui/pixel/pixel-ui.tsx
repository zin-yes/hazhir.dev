import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";
import styles from "./pixel-ui.module.css";

type PixelButtonTone = "default" | "primary" | "danger" | "tab" | "tabActive";

const TONE_CLASS: Record<PixelButtonTone, string> = {
  default: "",
  primary: styles.primary,
  danger: styles.danger,
  tab: styles.tab,
  tabActive: styles.tabActive,
};

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: PixelButtonTone;
}

export function PixelButton({
  tone = "default",
  className = "",
  children,
  ...buttonProps
}: PixelButtonProps) {
  return (
    <button
      data-mobile-ui
      {...buttonProps}
      className={`${styles.button} ${TONE_CLASS[tone]} ${className}`}
    >
      <span>{children}</span>
    </button>
  );
}

interface PixelFrameProps {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}

export function PixelFrame({
  children,
  className = "",
  innerClassName = "",
}: PixelFrameProps) {
  return (
    <div data-mobile-ui className={`${styles.frame} ${className}`}>
      <div className={`${styles.frameFill} ${innerClassName}`}>{children}</div>
    </div>
  );
}

export function PixelInput({
  className = "",
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...inputProps} className={`${styles.field} ${className}`} />;
}

interface PixelSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onChange: (value: number) => void;
}

export function PixelSlider({ value, min, max, step, label, onChange }: PixelSliderProps) {
  const filledPercent = ((value - min) / (max - min)) * 100;
  return (
    <input
      data-mobile-ui
      type="range"
      aria-label={label}
      className={styles.slider}
      style={{ "--filled": `${filledPercent}%` } as CSSProperties}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

interface PixelToggleProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

export function PixelToggle({ checked, label, onChange }: PixelToggleProps) {
  return (
    <button
      data-mobile-ui
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleKnob} />
    </button>
  );
}

export function PixelKey({ children }: { children: ReactNode }) {
  return <span className={styles.keycap}>{children}</span>;
}

export function PixelLogo({ children }: { children: ReactNode }) {
  return <h1 className={`${styles.logo} text-5xl sm:text-7xl`}>{children}</h1>;
}

export function PixelSegmentBar({ progress }: { progress: number }) {
  const segmentCount = 20;
  const litSegments = Math.floor(progress * segmentCount);
  return (
    <div className={styles.segments} role="progressbar" aria-valuenow={Math.round(progress * 100)}>
      {Array.from({ length: segmentCount }, (_, index) => (
        <div
          key={index}
          className={`${styles.segment} ${index < litSegments ? styles.segmentLit : ""}`}
        />
      ))}
    </div>
  );
}

type StageState = "done" | "active" | "pending";

const STAGE_MARKER_CLASS: Record<StageState, string> = {
  done: styles.stageMarkerDone,
  active: styles.stageMarkerActive,
  pending: "",
};

export function PixelStageMarker({ state }: { state: StageState }) {
  return (
    <span className={`${styles.stageMarker} ${STAGE_MARKER_CLASS[state]}`} />
  );
}
