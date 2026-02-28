import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type DragVisualDelta = { x: number; y: number };

export type DragVisualPhase = "idle" | "dragging" | "handoff";

export type DragVisualPoint = { left: number; top: number };

export type DragVisualMotionContext = {
  id: string;
  phase: DragVisualPhase;
  delta: DragVisualDelta;
  progress: number;
};

export type DragVisualMotionEffect = (
  context: DragVisualMotionContext,
) => string | undefined;

export type DragVisualStyle = {
  left: number;
  top: number;
  transition: string;
  transform?: string;
};

type UseDragVisualHandoffOptions = {
  durationMs?: number;
  easing?: string;
  motionEffect?: DragVisualMotionEffect;
};

function emptyPointMap(): Record<string, DragVisualPoint> {
  return {};
}

export function useDragVisualHandoff(options?: UseDragVisualHandoffOptions) {
  const durationMs = options?.durationMs ?? 180;
  const easing = options?.easing ?? "ease-out";

  const [phase, setPhase] = useState<DragVisualPhase>("idle");
  const [ids, setIds] = useState<string[]>([]);
  const [sourcePoints, setSourcePoints] = useState<Record<string, DragVisualPoint>>(
    emptyPointMap,
  );
  const [targetPoints, setTargetPoints] = useState<Record<string, DragVisualPoint>>(
    emptyPointMap,
  );
  const [delta, setDelta] = useState<DragVisualDelta>({ x: 0, y: 0 });
  const [handoffAnimating, setHandoffAnimating] = useState(false);

  const phaseRef = useRef<DragVisualPhase>("idle");
  const idsRef = useRef<string[]>([]);
  const sourcePointsRef = useRef<Record<string, DragVisualPoint>>(emptyPointMap());
  const deltaRef = useRef<DragVisualDelta>({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    idsRef.current = ids;
  }, [ids]);

  useEffect(() => {
    sourcePointsRef.current = sourcePoints;
  }, [sourcePoints]);

  useEffect(() => {
    deltaRef.current = delta;
  }, [delta]);

  const clearTimers = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setIds([]);
    setSourcePoints(emptyPointMap());
    setTargetPoints(emptyPointMap());
    setDelta({ x: 0, y: 0 });
    setHandoffAnimating(false);
  }, [clearTimers]);

  const startDrag = useCallback(
    (dragIds: string[], sources: Record<string, DragVisualPoint>) => {
      clearTimers();
      setPhase("dragging");
      setIds(dragIds);
      setSourcePoints(sources);
      setTargetPoints(emptyPointMap());
      setDelta({ x: 0, y: 0 });
      setHandoffAnimating(false);
    },
    [clearTimers],
  );

  const updateDelta = useCallback((nextDelta: DragVisualDelta) => {
    setDelta(nextDelta);
  }, []);

  const startHandoff = useCallback(
    (nextTargets: Record<string, DragVisualPoint>) => {
      if (phaseRef.current !== "dragging" || idsRef.current.length === 0) {
        clear();
        return;
      }

      const resolvedTargets = idsRef.current.reduce<Record<string, DragVisualPoint>>(
        (accumulator, id) => {
          const target = nextTargets[id];
          const source = sourcePointsRef.current[id];
          if (!source || !target) return accumulator;

          accumulator[id] = target;
          return accumulator;
        },
        {},
      );

      if (Object.keys(resolvedTargets).length === 0) {
        clear();
        return;
      }

      clearTimers();
      setTargetPoints(resolvedTargets);
      setPhase("handoff");
      setHandoffAnimating(false);

      rafRef.current = window.requestAnimationFrame(() => {
        setHandoffAnimating(true);
      });

      timeoutRef.current = window.setTimeout(() => {
        clear();
      }, durationMs + 32);
    },
    [clear, clearTimers, durationMs],
  );

  const getOverlayItemStyle = useCallback(
    (id: string): DragVisualStyle | null => {
      const source = sourcePoints[id];
      if (!source) return null;

      const effectTransform = options?.motionEffect?.({
        id,
        phase,
        delta,
        progress: phase === "handoff" ? (handoffAnimating ? 1 : 0) : 0,
      });

      if (phase === "dragging") {
        return {
          left: source.left + delta.x,
          top: source.top + delta.y,
          transition: "none",
          transform: effectTransform,
        };
      }

      if (phase === "handoff") {
        const target = targetPoints[id];
        if (!target) return null;

        return {
          left: handoffAnimating ? target.left : source.left + delta.x,
          top: handoffAnimating ? target.top : source.top + delta.y,
          transition: handoffAnimating
            ? `left ${durationMs}ms ${easing}, top ${durationMs}ms ${easing}`
            : "none",
          transform: effectTransform,
        };
      }

      return null;
    },
    [delta, durationMs, easing, handoffAnimating, options, phase, sourcePoints, targetPoints],
  );

  const hiddenIds = useMemo(() => {
    if (phase === "idle") return new Set<string>();
    return new Set(ids);
  }, [ids, phase]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return {
    phase,
    overlayIds: ids,
    isOverlayVisible: phase !== "idle" && ids.length > 0,
    getOverlayItemStyle,
    isBaseHidden: (id: string) => hiddenIds.has(id),
    startDrag,
    updateDelta,
    startHandoff,
    clear,
  };
}
