import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
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
