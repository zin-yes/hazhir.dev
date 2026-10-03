import { useEffect, useRef } from "react";
import { bayerThreshold } from "./bayer";
import { loadGrainPalette, packColor } from "./grain-palette";
import { SandGrid } from "./sand-grid";

const CELL_SIZE_PIXELS = 6;
const SIMULATION_STEPS_PER_FRAME = 2;
const INTRO_DURATION_MILLISECONDS = 600;
const DISSOLVE_DURATION_MILLISECONDS = 1000;
const MAX_FILL_WAIT_MILLISECONDS = 1600;
const FILLED_ENOUGH_TO_DISSOLVE = 0.88;
const SWEEP_WEIGHT = 0.45;

const BACKGROUND_TOP = packColor(13, 11, 20);
const BACKGROUND_BOTTOM = packColor(40, 31, 74);

type BackdropStage = "intro" | "live" | "dissolving" | "done";

interface PixelSandBackdropProps {
  /** How much of the screen height the pile should reach, 0 to 1. */
  fillTarget: number;
  /** Keeps a slow trickle of grains moving while nothing else animates. */
  ambient: boolean;
  /** Fill the screen, then dither away to reveal what is underneath. */
  isFinishing: boolean;
  onDissolved?: () => void;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function brighten(color: number, amount: number): number {
  const red = Math.min(255, (color & 255) + amount);
  const green = Math.min(255, ((color >> 8) & 255) + amount);
  const blue = Math.min(255, ((color >> 16) & 255) + amount);
  return packColor(red, green, blue);
}

export function PixelSandBackdrop({
  fillTarget,
  ambient,
  isFinishing,
  onDissolved,
}: PixelSandBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ fillTarget, ambient, isFinishing, onDissolved });
  propsRef.current = { fillTarget, ambient, isFinishing, onDissolved };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !container || !context) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const introDuration = prefersReducedMotion ? 1 : INTRO_DURATION_MILLISECONDS;
    const dissolveDuration = prefersReducedMotion
      ? 1
      : DISSOLVE_DURATION_MILLISECONDS;

    let grid: SandGrid | null = null;
    let image: ImageData | null = null;
    let pixels: Uint32Array | null = null;
    let stage: BackdropStage = "intro";
    let stageStartedAt = performance.now();
    let finishRequestedAt: number | null = null;
    let animationFrameId = 0;
    let isDisposed = false;
    let frameCounter = 0;
    let palette: Awaited<ReturnType<typeof loadGrainPalette>> | null = null;

    const rebuildGrid = () => {
      const columns = Math.max(
        8,
        Math.ceil(container.clientWidth / CELL_SIZE_PIXELS),
      );
      const rows = Math.max(
        8,
        Math.ceil(container.clientHeight / CELL_SIZE_PIXELS),
      );
      canvas.width = columns;
      canvas.height = rows;
      image = context.createImageData(columns, rows);
      pixels = new Uint32Array(image.data.buffer);
      grid = palette ? new SandGrid(columns, rows, palette) : null;
    };

    const resizeObserver = new ResizeObserver(rebuildGrid);
    resizeObserver.observe(container);
    rebuildGrid();
    loadGrainPalette().then((loadedPalette) => {
      palette = loadedPalette;
      rebuildGrid();
    });

    const isPixelVisible = (
      column: number,
      row: number,
      columns: number,
      rows: number,
      now: number,
    ) => {
      if (stage === "live") return true;
      const sweep = (column / columns + row / rows) / 2;
      const value =
        (1 - SWEEP_WEIGHT) * bayerThreshold(column, row) + SWEEP_WEIGHT * sweep;
      if (stage === "intro") {
        const progress = Math.min(1, (now - stageStartedAt) / introDuration);
        return value < easeOutCubic(progress);
      }
      const progress = Math.min(1, (now - stageStartedAt) / dissolveDuration);
      return value >= easeOutCubic(progress);
    };

    const advanceStage = (now: number) => {
      const { isFinishing: finishing } = propsRef.current;
      if (stage === "intro" && now - stageStartedAt >= introDuration) {
        stage = "live";
      }
      if (stage === "live" && finishing) {
        finishRequestedAt ??= now;
        const isFullEnough =
          !!grid &&
          grid.grainCount >= grid.capacity * FILLED_ENOUGH_TO_DISSOLVE;
        if (isFullEnough || now - finishRequestedAt > MAX_FILL_WAIT_MILLISECONDS) {
          stage = "dissolving";
          stageStartedAt = now;
        }
      }
      if (stage === "dissolving" && !finishing) {
        stage = "live";
        finishRequestedAt = null;
      }
      if (stage === "dissolving" && now - stageStartedAt >= dissolveDuration) {
        stage = "done";
        propsRef.current.onDissolved?.();
      }
    };

    const simulate = () => {
      if (!grid) return;
      const { fillTarget: target, ambient: isAmbient, isFinishing: finishing } =
        propsRef.current;
      const effectiveTarget = finishing ? 1 : target;
      const wantedGrains = Math.floor(effectiveTarget * grid.capacity * 0.97);
      const deficit = wantedGrains - grid.grainCount;
      if (deficit > 0) {
        grid.spawnGrains(Math.min(deficit, Math.ceil(grid.columns / 4)));
      }
      if (isAmbient && !prefersReducedMotion && frameCounter % 3 === 0) {
        grid.drainBottomGrain();
      }
      for (let step = 0; step < SIMULATION_STEPS_PER_FRAME; step++) grid.step();
    };

    const draw = (now: number) => {
      if (!image || !pixels) return;
      const columns = image.width;
      const rows = image.height;
      const cells = grid?.cells;
      for (let row = 0; row < rows; row++) {
        const gradient = (row / rows) * 0.95;
        for (let column = 0; column < columns; column++) {
          const index = row * columns + column;
          if (!isPixelVisible(column, row, columns, rows, now)) {
            pixels[index] = 0;
            continue;
          }
          const grain = cells ? cells[index] : 0;
          if (grain !== 0) {
            const isSurface = row > 0 && cells![index - columns] === 0;
            pixels[index] = isSurface ? brighten(grain, 28) : grain;
          } else {
            pixels[index] =
              bayerThreshold(column, row) < gradient
                ? BACKGROUND_BOTTOM
                : BACKGROUND_TOP;
          }
        }
      }
      context.putImageData(image, 0, 0);
    };

    const frame = (now: number) => {
      if (isDisposed) return;
      frameCounter++;
      advanceStage(now);
      if (stage === "done") return;
      simulate();
      draw(now);
      animationFrameId = requestAnimationFrame(frame);
    };
    animationFrameId = requestAnimationFrame(frame);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 h-full w-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
