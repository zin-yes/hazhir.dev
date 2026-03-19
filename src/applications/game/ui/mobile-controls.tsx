"use client";

import { useEffect, useRef, useState } from "react";

interface MobileControlsProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled?: boolean;
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

const JOYSTICK_MAX_DIST = 50;
const STICK_SIZE = 40;
const DEAD_ZONE = 0.2;

export function MobileControls({
  containerRef,
  enabled = true,
  onMovement,
  onCameraRotate,
  onJumpStart,
  onJumpEnd,
  onBreak,
  onPlace,
  onToggleFly,
  onToggleInventory,
}: MobileControlsProps) {
  const joystickTouchId = useRef<number | null>(null);
  const cameraTouchId = useRef<number | null>(null);
  const joystickOrigin = useRef({ x: 0, y: 0 });
  const lastCameraPos = useRef({ x: 0, y: 0 });
  const [stickOffset, setStickOffset] = useState({ x: 0, y: 0 });
  const [joystickCenter, setJoystickCenter] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const refs = useRef({ onMovement, onCameraRotate, enabled });
  refs.current = { onMovement, onCameraRotate, enabled };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isUI = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return false;
      return !!target.closest("[data-mobile-ui]");
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (!refs.current.enabled) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (isUI(touch.target)) continue;

        e.preventDefault();

        const rect = el.getBoundingClientRect();
        const relX = (touch.clientX - rect.left) / rect.width;

        if (relX < 0.4 && joystickTouchId.current === null) {
          joystickTouchId.current = touch.identifier;
          joystickOrigin.current = { x: touch.clientX, y: touch.clientY };
          setJoystickCenter({
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top,
          });
        } else if (cameraTouchId.current === null) {
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
          const dx = touch.clientX - joystickOrigin.current.x;
          const dy = touch.clientY - joystickOrigin.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clamped = Math.min(dist, JOYSTICK_MAX_DIST);
          const angle = Math.atan2(dy, dx);
          const cx = dist > 0 ? Math.cos(angle) * clamped : 0;
          const cy = dist > 0 ? Math.sin(angle) * clamped : 0;

          setStickOffset({ x: cx, y: cy });

          const nx = cx / JOYSTICK_MAX_DIST;
          const ny = cy / JOYSTICK_MAX_DIST;
          refs.current.onMovement(
            ny < -DEAD_ZONE,
            ny > DEAD_ZONE,
            nx < -DEAD_ZONE,
            nx > DEAD_ZONE,
          );
        }

        if (touch.identifier === cameraTouchId.current) {
          e.preventDefault();
          const dx = touch.clientX - lastCameraPos.current.x;
          const dy = touch.clientY - lastCameraPos.current.y;
          lastCameraPos.current = { x: touch.clientX, y: touch.clientY };
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

    el.addEventListener("touchstart", handleTouchStart, { passive: false });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    el.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
      refs.current.onMovement(false, false, false, false);
    };
  }, [containerRef]);

  const btnClass =
    "flex items-center justify-center rounded-xl bg-black/40 border-2 border-white/30 text-white active:bg-white/20 select-none";

  if (!enabled) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-30 select-none">
      {/* Floating joystick */}
      {joystickCenter && (
        <div
          className="absolute pointer-events-none"
          style={{
            width: JOYSTICK_MAX_DIST * 2,
            height: JOYSTICK_MAX_DIST * 2,
            left: joystickCenter.x - JOYSTICK_MAX_DIST,
            top: joystickCenter.y - JOYSTICK_MAX_DIST,
          }}
        >
          <div className="absolute inset-0 rounded-full border-2 border-white/20 bg-white/5" />
          <div
            className="absolute rounded-full bg-white/40 border-2 border-white/60"
            style={{
              width: STICK_SIZE,
              height: STICK_SIZE,
              left: JOYSTICK_MAX_DIST - STICK_SIZE / 2 + stickOffset.x,
              top: JOYSTICK_MAX_DIST - STICK_SIZE / 2 + stickOffset.y,
            }}
          />
        </div>
      )}

      {/* Right-side action buttons */}
      <div
        className="absolute bottom-28 right-3 flex flex-col items-center gap-2 pointer-events-auto"
        data-mobile-ui
      >
        <div className="flex gap-2">
          <button
            className={btnClass + " w-11 h-11 text-lg"}
            onTouchStart={(e) => {
              e.stopPropagation();
              onToggleFly();
            }}
          >
            ✈
          </button>
          <button
            className={btnClass + " w-11 h-11 text-lg"}
            onTouchStart={(e) => {
              e.stopPropagation();
              onToggleInventory();
            }}
          >
            ≡
          </button>
        </div>
        <div className="flex gap-2">
          <button
            className={btnClass + " w-14 h-14 text-2xl border-red-400/40"}
            onTouchStart={(e) => {
              e.stopPropagation();
              onBreak();
            }}
          >
            ⛏
          </button>
          <button
            className={btnClass + " w-14 h-14 text-2xl border-blue-400/40"}
            onTouchStart={(e) => {
              e.stopPropagation();
              onPlace();
            }}
          >
            ▣
          </button>
        </div>
        <button
          className={btnClass + " w-16 h-16 text-2xl"}
          onTouchStart={(e) => {
            e.stopPropagation();
            onJumpStart();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            onJumpEnd();
          }}
          onTouchCancel={(e) => {
            e.stopPropagation();
            onJumpEnd();
          }}
        >
          ▲
        </button>
      </div>
    </div>
  );
}
