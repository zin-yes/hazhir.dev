import { useState, type CSSProperties } from "react";
import { TouchIcon, type TouchIconName } from "./touch-icons";
import styles from "./touch.module.css";

interface TouchButtonProps {
  icon: TouchIconName;
  label: string;
  sizePixels: number;
  accentColor: string;
  onPress: () => void;
  onRelease?: () => void;
}

const ICON_GRID_SIZE = 8;

export function TouchButton({ icon, label, sizePixels, accentColor, onPress, onRelease }: TouchButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  const iconPixels = Math.max(2, Math.floor((sizePixels * 0.55) / ICON_GRID_SIZE)) * ICON_GRID_SIZE;

  const release = (event: React.TouchEvent) => {
    event.stopPropagation();
    setIsPressed(false);
    onRelease?.();
  };

  return (
    <button
      type="button"
      aria-label={label}
      className={`${styles.button} ${isPressed ? styles.pressed : ""}`}
      style={{ width: sizePixels, height: sizePixels, "--accent": accentColor } as CSSProperties}
      onTouchStart={(event) => {
        event.stopPropagation();
        setIsPressed(true);
        onPress();
      }}
      onTouchEnd={release}
      onTouchCancel={release}
    >
      <span>
        <TouchIcon name={icon} size={iconPixels} />
      </span>
    </button>
  );
}
