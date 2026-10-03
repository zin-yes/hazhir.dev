import { useEffect, useRef, useState } from "react";

interface LoadingScreenProps {
  progress: number;
  worldName: string;
  tileTextures: string[];
}

const TARGET_TILE_SIZE_PIXELS = 72;

interface TileGrid {
  columns: number;
  tileSizePixels: number;
  totalTiles: number;
}

function computeTileGrid(width: number, height: number): TileGrid {
  const columns = Math.max(1, Math.ceil(width / TARGET_TILE_SIZE_PIXELS));
  const tileSizePixels = width / columns;
  const rows = Math.ceil(height / tileSizePixels);
  return { columns, tileSizePixels, totalTiles: columns * rows };
}

export function LoadingScreen({
  progress,
  worldName,
  tileTextures,
}: LoadingScreenProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const [tileGrid, setTileGrid] = useState<TileGrid>(() =>
    computeTileGrid(1280, 720),
  );

  useEffect(() => {
    const screenElement = screenRef.current;
    if (!screenElement) return;
    const measureScreen = () =>
      setTileGrid(
        computeTileGrid(screenElement.clientWidth, screenElement.clientHeight),
      );
    measureScreen();
    const resizeObserver = new ResizeObserver(measureScreen);
    resizeObserver.observe(screenElement);
    return () => resizeObserver.disconnect();
  }, []);

  const visibleTileCount = Math.ceil(progress * tileGrid.totalTiles);

  return (
    <div
      ref={screenRef}
      data-mobile-ui
      className="absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-black"
    >
      <div
        className="absolute inset-0 grid content-start opacity-60"
        style={{
          gridTemplateColumns: `repeat(${tileGrid.columns}, 1fr)`,
        }}
      >
        {Array.from({ length: visibleTileCount }, (_, tileIndex) => (
          <div
            key={tileIndex}
            className="aspect-square w-full"
            style={{
              imageRendering: "pixelated",
              backgroundImage: `url(/game/${tileTextures[(tileIndex * 7) % tileTextures.length]})`,
              backgroundSize: "100% 100%",
            }}
          />
        ))}
      </div>
      <div className="z-10 flex w-64 max-w-[80vw] flex-col items-center gap-3 rounded-xl bg-black/70 p-5">
        <h1 className="max-w-full truncate text-xl font-bold">{worldName}</h1>
        <p className="text-sm text-neutral-300">Generating world...</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full bg-emerald-400 transition-[width] duration-200"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <p className="text-sm">{Math.round(progress * 100)}%</p>
      </div>
    </div>
  );
}
