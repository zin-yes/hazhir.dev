"use client";

import { useEffect, useRef, useState } from "react";
import { profiler } from "../profiler";
import { finishInputEvent, startInputEvent, type InputKind } from "../input-profiling";
import { DIMENSIONS } from "../profiler/dimensions";
import type { GameSettings } from "../settings/game-settings";
import { TouchButton } from "./touch/touch-button";
import { TouchJoystick } from "./touch/touch-joystick";
import {
  FIXED_JOYSTICK_BOTTOM_INSET,
  FIXED_JOYSTICK_EDGE_INSET,
  isJoystickSide,
  touchLayoutFor,
} from "./touch/touch-layout";
import { uiEventProps } from "./ui-profiling";
import { useProfiledRender } from "./use-profiled-render";

type TouchSettings = Pick<
  GameSettings,
  "touchControlSize" | "touchHandedness" | "touchOpacity" | "touchJoystickMode"
>;

interface MobileControlsProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled?: boolean;
  settings: TouchSettings;
  onMovement: (
    forward: boolean,
    backward: boolean,
    left: boolean,
    right: boolean,
  ) => void;
  onCameraRotate: (deltaX: number, deltaY: number) => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
  onBreak: () => void;
  onPlace: () => void;
  onToggleFly: () => void;
  onToggleInventory: () => void;
}

const DEAD_ZONE = 0.2;
/** In fixed mode only touches this many joystick radii from the base steer; the rest of that side looks around. */
const FIXED_JOYSTICK_GRAB_RADII = 1.6;

const ACTION_COLORS = {
  fly: "#6ec6ff",
  inventory: "#ffc857",
  break: "#ff6b7a",
  place: "#b6f24a",
  jump: "#f1ecff",
};

/** Where the fixed joystick's center is on screen, in client coordinates. */
function fixedJoystickCenter(
  rect: DOMRect,
  handedness: TouchSettings["touchHandedness"],
  radius: number,
) {
  const horizontalInset = FIXED_JOYSTICK_EDGE_INSET + radius;
  return {
    x: handedness === "right" ? rect.left + horizontalInset : rect.right - horizontalInset,
    y: rect.bottom - FIXED_JOYSTICK_BOTTOM_INSET - radius,
  };
}

export function MobileControls({
  containerRef,
  enabled = true,
  settings,
  onMovement,
  onCameraRotate,
  onJumpStart,
  onJumpEnd,
  onBreak,
  onPlace,
  onToggleFly,
  onToggleInventory,
}: MobileControlsProps) {
  useProfiledRender("mobileControls");
  const joystickTouchId = useRef<number | null>(null);
  const cameraTouchId = useRef<number | null>(null);
  const joystickOrigin = useRef({ x: 0, y: 0 });
  const lastCameraPos = useRef({ x: 0, y: 0 });
  const [stickOffset, setStickOffset] = useState({ x: 0, y: 0 });
  const [joystickCenter, setJoystickCenter] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const layout = touchLayoutFor(settings.touchControlSize);
  const refs = useRef({ onMovement, onCameraRotate, enabled, settings, layout });
  refs.current = { onMovement, onCameraRotate, enabled, settings, layout };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isUI = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return false;
      return !!target.closest("[data-mobile-ui]");
    };

    const updateStick = (clientX: number, clientY: number) => {
      const maxDistance = refs.current.layout.joystickRadius;
      const dx = clientX - joystickOrigin.current.x;
      const dy = clientY - joystickOrigin.current.y;
      profiler.addCounter("game.input.touch.joystickUpdates");
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clamped = Math.min(dist, maxDistance);
      const angle = Math.atan2(dy, dx);
      const cx = dist > 0 ? Math.cos(angle) * clamped : 0;
      const cy = dist > 0 ? Math.sin(angle) * clamped : 0;

      setStickOffset({ x: cx, y: cy });

      const nx = cx / maxDistance;
      const ny = cy / maxDistance;
      refs.current.onMovement(
        ny < -DEAD_ZONE,
        ny > DEAD_ZONE,
        nx < -DEAD_ZONE,
        nx > DEAD_ZONE,
      );
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (!refs.current.enabled) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (isUI(touch.target)) {
          profiler.addCounter("game.input.touch.uiTouchesIgnored");
          continue;
        }

        e.preventDefault();

        const rect = el.getBoundingClientRect();
        const { settings: touchSettings, layout: touchLayout } = refs.current;
        const isFixedJoystick = touchSettings.touchJoystickMode === "fixed";
        const horizontalFraction = (touch.clientX - rect.left) / rect.width;

        let joystickOriginPoint = { x: touch.clientX, y: touch.clientY };
        let startsJoystick =
          joystickTouchId.current === null &&
          isJoystickSide(horizontalFraction, touchSettings.touchHandedness);
        if (startsJoystick && isFixedJoystick) {
          joystickOriginPoint = fixedJoystickCenter(
            rect,
            touchSettings.touchHandedness,
            touchLayout.joystickRadius,
          );
          const distanceFromBase = Math.hypot(
            touch.clientX - joystickOriginPoint.x,
            touch.clientY - joystickOriginPoint.y,
          );
          startsJoystick =
            distanceFromBase <= touchLayout.joystickRadius * FIXED_JOYSTICK_GRAB_RADII;
        }

        if (startsJoystick) {
          profiler.addCounter("game.input.touch.joystickGrabs");
          joystickTouchId.current = touch.identifier;
          joystickOrigin.current = joystickOriginPoint;
          if (isFixedJoystick) {
            updateStick(touch.clientX, touch.clientY);
          } else {
            setJoystickCenter({
              x: touch.clientX - rect.left,
              y: touch.clientY - rect.top,
            });
          }
        } else if (cameraTouchId.current === null) {
          profiler.addCounter("game.input.touch.cameraGrabs");
          cameraTouchId.current = touch.identifier;
          lastCameraPos.current = { x: touch.clientX, y: touch.clientY };
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!refs.current.enabled) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (touch.identifier === joystickTouchId.current) {
          e.preventDefault();
          updateStick(touch.clientX, touch.clientY);
        }

        if (touch.identifier === cameraTouchId.current) {
          e.preventDefault();
          const dx = touch.clientX - lastCameraPos.current.x;
          const dy = touch.clientY - lastCameraPos.current.y;
          lastCameraPos.current = { x: touch.clientX, y: touch.clientY };
          profiler.addCounter("game.input.touch.cameraDrags");
          refs.current.onCameraRotate(dx, dy);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (touch.identifier === joystickTouchId.current) {
          joystickTouchId.current = null;
          setStickOffset({ x: 0, y: 0 });
          setJoystickCenter(null);
          refs.current.onMovement(false, false, false, false);
        }

        if (touch.identifier === cameraTouchId.current) {
          cameraTouchId.current = null;
        }
      }
    };

    const withTouchScope =
      (
        scopeName: string,
        inputKind: InputKind,
        handler: (event: TouchEvent) => void,
      ) =>
      (event: TouchEvent) => {
        const startedAtMs = startInputEvent();
        if (startedAtMs >= 0) {
          profiler.addCounter("game.input.touch.points", event.changedTouches.length);
        }
        const scopeToken = profiler.begin(
          scopeName,
          DIMENSIONS.simulationSystem,
          "input.touch",
        );
        try {
          handler(event);
        } finally {
          profiler.end(scopeToken);
          finishInputEvent(inputKind, startedAtMs);
        }
      };
    const onTouchStart = withTouchScope("main.input.touchStart", "touchStart", handleTouchStart);
    const onTouchMove = withTouchScope("main.input.touchMove", "touchMove", handleTouchMove);
    const onTouchEnd = withTouchScope("main.input.touchEnd", "touchEnd", handleTouchEnd);
    const onTouchCancel = withTouchScope("main.input.touchCancel", "touchCancel", handleTouchEnd);

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
      refs.current.onMovement(false, false, false, false);
    };
  }, [containerRef]);

  if (!enabled) return null;

  const isFixedJoystick = settings.touchJoystickMode === "fixed";
  const buttonsOnRight = settings.touchHandedness === "right";
  const joystickPosition = isFixedJoystick
    ? {
        bottom: FIXED_JOYSTICK_BOTTOM_INSET,
        ...(buttonsOnRight
          ? { left: FIXED_JOYSTICK_EDGE_INSET }
          : { right: FIXED_JOYSTICK_EDGE_INSET }),
      }
    : joystickCenter && {
        left: joystickCenter.x - layout.joystickRadius,
        top: joystickCenter.y - layout.joystickRadius,
      };

  return (
    <div
      className="absolute inset-0 pointer-events-none z-30 select-none"
      style={{ opacity: settings.touchOpacity }}
      {...uiEventProps("mobileControls")}
    >
      {joystickPosition && (
        <TouchJoystick
          radius={layout.joystickRadius}
          stickSize={layout.stickSize}
          stickOffset={stickOffset}
          position={joystickPosition}
        />
      )}

      <div
        className={`absolute bottom-28 flex flex-col items-center gap-2 pointer-events-auto ${
          buttonsOnRight ? "right-3" : "left-3"
        }`}
        data-mobile-ui
      >
        <div className="flex gap-2">
          <TouchButton
            icon="fly"
            label="Toggle flying"
            sizePixels={layout.smallButton}
            accentColor={ACTION_COLORS.fly}
            onPress={onToggleFly}
          />
          <TouchButton
            icon="inventory"
            label="Inventory"
            sizePixels={layout.smallButton}
            accentColor={ACTION_COLORS.inventory}
            onPress={onToggleInventory}
          />
        </div>
        <div className="flex gap-2">
          <TouchButton
            icon="break"
            label="Break block"
            sizePixels={layout.mediumButton}
            accentColor={ACTION_COLORS.break}
            onPress={onBreak}
          />
          <TouchButton
            icon="place"
            label="Place block"
            sizePixels={layout.mediumButton}
            accentColor={ACTION_COLORS.place}
            onPress={onPlace}
          />
        </div>
        <TouchButton
          icon="jump"
          label="Jump"
          sizePixels={layout.jumpButton}
          accentColor={ACTION_COLORS.jump}
          onPress={onJumpStart}
          onRelease={onJumpEnd}
        />
      </div>
    </div>
  );
}
