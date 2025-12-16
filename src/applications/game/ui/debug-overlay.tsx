import { Silkscreen } from "next/font/google";

const DEBUG_FONT = Silkscreen({
  weight: ["400"],
  subsets: ["latin"],
});

export interface DebugInfo {
  fps: number;
  playerPosition: { x: number; y: number; z: number };
  currentChunk: { x: number; y: number; z: number };
  loadedChunks: number;
  blockAtCursor?: { type: number; light: number } | null;
  lookingAt?: { x: number; y: number; z: number } | null;
  seed: number;
}

interface DebugOverlayProps {
  isVisible: boolean;
  debugInfo: DebugInfo;
}

export function DebugOverlay({ isVisible, debugInfo }: DebugOverlayProps) {
  if (!isVisible) return null;

  const {
    fps,
    playerPosition,
    currentChunk,
    loadedChunks,
    blockAtCursor,
    lookingAt,
    seed,
  } = debugInfo;

  return (
    <div
      className={
        "absolute top-2 left-2 z-50 text-white text-xs bg-black/70 p-3 rounded pointer-events-none " +
        DEBUG_FONT.className
      }
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <div className="text-green-400 font-bold mb-2">Debug Info (F3)</div>

      <div className="space-y-1">
        <div className="text-yellow-300">
          FPS:{" "}
          <span
            className={
              fps < 30
                ? "text-red-400"
                : fps < 60
                ? "text-yellow-400"
                : "text-green-400"
            }
          >
            {fps}
          </span>
        </div>

        <div className="border-t border-gray-600 my-2"></div>

        <div className="text-cyan-300 font-bold">Position:</div>
        <div>X: {playerPosition.x.toFixed(2)}</div>
        <div>Y: {playerPosition.y.toFixed(2)}</div>
        <div>Z: {playerPosition.z.toFixed(2)}</div>

        <div className="border-t border-gray-600 my-2"></div>

        <div className="text-cyan-300 font-bold">Chunk:</div>
        <div>
          Chunk XYZ: ({currentChunk.x}, {currentChunk.y}, {currentChunk.z})
        </div>
        <div>Loaded Chunks: {loadedChunks}</div>

        <div className="border-t border-gray-600 my-2"></div>

        <div className="text-cyan-300 font-bold">World:</div>
        <div>Seed: {seed}</div>

        {lookingAt && (
          <>
            <div className="border-t border-gray-600 my-2"></div>
            <div className="text-cyan-300 font-bold">Looking At:</div>
            <div>
              Block: ({lookingAt.x}, {lookingAt.y}, {lookingAt.z})
            </div>
            {blockAtCursor && (
              <>
                <div>Block Type: {blockAtCursor.type}</div>
                <div
                  className={
                    blockAtCursor.light < 8 ? "text-orange-400" : "text-white"
                  }
                >
                  Sky Light: {blockAtCursor.light}
                  {blockAtCursor.light === 15
                    ? " (Full)"
                    : blockAtCursor.light === 0
                    ? " (Dark)"
                    : ""}
                </div>
              </>
            )}
          </>
        )}

        <div className="border-t border-gray-600 my-2"></div>

        <div className="text-gray-400 text-[10px]">Lighting bug fix: v1.0</div>
      </div>
    </div>
  );
}
