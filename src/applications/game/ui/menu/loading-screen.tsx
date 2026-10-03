interface LoadingScreenProps {
  progress: number;
  worldName: string;
  tileTextures: string[];
}

const TILE_COUNT = 40;

export function LoadingScreen({
  progress,
  worldName,
  tileTextures,
}: LoadingScreenProps) {
  const visibleTileCount = Math.floor(progress * TILE_COUNT);

  return (
    <div
      data-mobile-ui
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black"
    >
      <div className="absolute inset-0 flex h-fit flex-row flex-wrap opacity-60">
        {Array.from({ length: visibleTileCount }, (_, tileIndex) => (
          <div
            key={tileIndex}
            className="aspect-square w-[10%]"
            style={{
              imageRendering: "pixelated",
              backgroundImage: `url(/game/${tileTextures[(tileIndex * 7) % tileTextures.length]})`,
              backgroundSize: "100% 100%",
            }}
          />
        ))}
      </div>
      <div className="z-10 flex w-64 max-w-[80vw] flex-col items-center gap-3">
        <h1 className="truncate text-xl font-bold">{worldName}</h1>
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
