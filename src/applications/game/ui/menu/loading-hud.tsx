import type { LoadStageStatus } from "../../load-progress";
import {
  PixelFrame,
  PixelSegmentBar,
  PixelStageMarker,
} from "../pixel/pixel-ui";

interface LoadingHudProps {
  progress: number;
  stageLabel: string;
  stages: LoadStageStatus[];
  worldName: string;
}

export function LoadingHud({
  progress,
  stageLabel,
  stages,
  worldName,
}: LoadingHudProps) {
  const activeStageIndex = stages.findIndex((stage) => stage.fraction < 1);

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
          <span className="tabular-nums">{Math.floor(progress * 100)}%</span>
        </div>

        <ul className="mt-4 flex flex-col gap-1.5 text-[0.65rem]">
          {stages.map((stage, index) => {
            const state =
              stage.fraction >= 1
                ? "done"
                : stage.fraction > 0 || index === activeStageIndex
                  ? "active"
                  : "pending";
            return (
              <li
                key={stage.id}
                className={`flex items-center gap-2 ${
                  state === "pending" ? "text-[#6e6590]" : "text-[#f1ecff]"
                }`}
              >
                <PixelStageMarker state={state} />
                <span className="grow">{stage.label}</span>
                {state === "active" && (
                  <span className="tabular-nums text-[#b6f24a]">
                    {Math.floor(stage.fraction * 100)}%
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </PixelFrame>
    </div>
  );
}
