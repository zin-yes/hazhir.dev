import { useEffect, useRef } from "react";
import { bayerThreshold } from "./bayer";
import { packColor } from "./grain-palette";
import { profiler } from "../../profiler";
import { DIMENSIONS } from "../../profiler/dimensions";
import { useProfiledRender } from "../use-profiled-render";

const VEIL_CELL_SIZE_PIXELS = 4;
const VEIL_FADE_IN_MILLISECONDS = 260;
const VEIL_COLOR = packColor(10, 8, 18);
const BYTES_PER_PIXEL = 4;

interface DitherVeilProps {
  /** Final share of pixels that are covered, 0 to 1. */
  coverage?: number;
}

/**
 * A stipple of dark pixels that dithers in over the game instead of a blur,
 * so the paused world stays crisp and readable behind the menu.
 */
export function DitherVeil({ coverage = 0.5 }: DitherVeilProps) {
  useProfiledRender("ditherVeil");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !container || !context) return;

    const fadeDuration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 1
      : VEIL_FADE_IN_MILLISECONDS;
    let animationFrameId = 0;
    let startedAt = 0;

    const render = (now: number) => {
      if (!startedAt) startedAt = now;
      const columns = Math.ceil(container.clientWidth / VEIL_CELL_SIZE_PIXELS);
      const rows = Math.ceil(container.clientHeight / VEIL_CELL_SIZE_PIXELS);
      if (columns < 1 || rows < 1) return;
      if (canvas.width !== columns || canvas.height !== rows) {
        canvas.width = columns;
        canvas.height = rows;
        profiler.addCounter("game.ui.ditherVeil.canvasResizes");
        profiler.sampleGauge("game.ui.ditherVeil.canvasPixels", columns * rows, "pixels");
      }
      const progress = Math.min(1, (now - startedAt) / fadeDuration);
      const currentCoverage = coverage * (1 - Math.pow(1 - progress, 3));
      const paintToken = profiler.begin(
        "main.ui.ditherVeil.paint",
        DIMENSIONS.uiSurface,
        "ditherVeil",
      );
      const allocateToken = profiler.begin("main.ui.ditherVeil.paint.allocateImage");
      const image = context.createImageData(columns, rows);
      const pixels = new Uint32Array(image.data.buffer);
      profiler.end(allocateToken);
      const fillToken = profiler.begin("main.ui.ditherVeil.paint.fillPixels");
      let coveredPixels = 0;
      const isProfiling = profiler.enabled;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          if (bayerThreshold(column, row) < currentCoverage) {
            pixels[row * columns + column] = VEIL_COLOR;
            if (isProfiling) coveredPixels++;
          }
        }
      }
      profiler.end(fillToken);
      const uploadToken = profiler.begin("main.ui.ditherVeil.paint.putImageData");
      context.putImageData(image, 0, 0);
      profiler.end(uploadToken);
      profiler.end(paintToken);
      profiler.addCounter("game.ui.veilPixelsPainted", columns * rows);
      profiler.addCounter("game.ui.ditherVeil.pixelsCovered", coveredPixels);
      profiler.addCounter("game.ui.ditherVeil.paints");
      profiler.recordBytes("bytes.ui.ditherVeil.putImageData", columns * rows * BYTES_PER_PIXEL);
      if (progress < 1) animationFrameId = requestAnimationFrame(render);
    };
    animationFrameId = requestAnimationFrame(render);

    const resizeObserver = new ResizeObserver(() => {
      profiler.addCounter("game.ui.ditherVeil.resizeRepaints");
      cancelAnimationFrame(animationFrameId);
      render(performance.now());
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, [coverage]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
