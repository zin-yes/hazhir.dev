import styles from "./touch.module.css";

interface TouchJoystickProps {
  radius: number;
  stickSize: number;
  stickOffset: { x: number; y: number };
  /** Where the base sits; floating sticks pass left and top, fixed ones a bottom and a side inset. */
  position: { left?: number; right?: number; top?: number; bottom?: number };
}

export function TouchJoystick({ radius, stickSize, stickOffset, position }: TouchJoystickProps) {
  return (
    <div className={styles.joystickBase} style={{ width: radius * 2, height: radius * 2, ...position }}>
      <div
        className={styles.joystickStick}
        style={{
          width: stickSize,
          height: stickSize,
          left: radius - stickSize / 2 + stickOffset.x,
          top: radius - stickSize / 2 + stickOffset.y,
        }}
      />
    </div>
  );
}
