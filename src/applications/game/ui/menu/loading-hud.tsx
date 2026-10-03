import { PixelFrame, PixelSegmentBar } from "../pixel/pixel-ui";

interface LoadingHudProps {
  progress: number;
  stageLabel: string;
  worldName: string;
}

export function LoadingHud({ progress, stageLabel, worldName }: LoadingHudProps) {
  return (
    <div
      data-mobile-ui
      className="absolute inset-0 z-50 flex items-center justify-center p-4"
    >
      <PixelFrame className="w-full max-w-sm" innerClassName="p-5">
        <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[#6e6590]">
          Entering
        </p>
        <h2 className="mb-4 mt-1 truncate text-xl font-bold text-[#b6f24a]">
          {worldName}
        </h2>
        <PixelSegmentBar progress={progress} />
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-[#9a91bd]">{stageLabel}...</span>
          <span className="tabular-nums">{Math.round(progress * 100)}%</span>
        </div>
      </PixelFrame>
    </div>
  );
}
