import { useState, type CSSProperties } from "react";
import { profiler } from "../../profiler";
import { profileUiHandler } from "../ui-profiling";
import { useProfiledRender } from "../use-profiled-render";
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
  useProfiledRender("touchButton");
  const [isPressed, setIsPressed] = useState(false);
  const iconPixels = Math.max(2, Math.floor((sizePixels * 0.55) / ICON_GRID_SIZE)) * ICON_GRID_SIZE;

  const release = (event: React.TouchEvent) => {
    event.stopPropagation();
    profiler.addCounter("game.input.touch.buttonReleases");
    setIsPressed(false);
    if (onRelease) profileUiHandler("touchButton.release", icon, onRelease);
  };

  return (
    <button
      type="button"
      aria-label={label}
      className={`${styles.button} ${isPressed ? styles.pressed : ""}`}
      style={{ width: sizePixels, height: sizePixels, "--accent": accentColor } as CSSProperties}
      onTouchStart={(event) => {
        event.stopPropagation();
        profiler.addCounter("game.input.touch.buttonPresses");
        setIsPressed(true);
        profileUiHandler("touchButton.press", icon, onPress);
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
