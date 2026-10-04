import { Silkscreen } from "next/font/google";
import { useEffect, useState } from "react";
import { BlockType } from "../blocks";
import type { LoadStageStatus } from "../load-progress";
import type { StoredWorld } from "../worlds/world-store";
import { DebugInfo, DebugOverlay } from "./debug-overlay";
import { Hotbar } from "./hotbar";
import type { VideoSettingsValues } from "./menu/video-settings";
import { Inventory } from "./inventory";
import { LoadingHud } from "./menu/loading-hud";
import { PixelSandBackdrop } from "./pixel/pixel-sand-backdrop";
import { PixelButton } from "./pixel/pixel-ui";
import { PauseMenu } from "./menu/pause-menu";
import { TitleMenu } from "./menu/title-menu";
import { useProfiledRender } from "./use-profiled-render";

const DEFAULT_UI_FONT = Silkscreen({
  weight: ["400", "700"],
  subsets: ["latin"],
});

const TITLE_PILE_HEIGHT = 0.16;

export type GamePhase = "title" | "loading" | "paused" | "playing";

interface UILayerProps {
  phase: GamePhase;
  loadProgress: number;
  loadStageLabel: string;
  loadStages: LoadStageStatus[];
  activeWorldName: string;
  worlds: StoredWorld[];
  isLoadingWorlds: boolean;
  onPlayWorld: (worldId: string) => void;
  onCreateWorld: (name: string, seedText: string) => void;
  onRenameWorld: (worldId: string, name: string) => void;
  onDeleteWorld: (worldId: string) => void;
  onJoinHostedWorld: (hostId: string) => void;
  onResume: () => void;
  onOpenPauseMenu: () => void;
  onSaveNow: () => void;
  onExitToWorlds: () => void;
  onHost?: () => void;
  onJoin?: (id: string) => void;
  peerId?: string;
  selectedSlot: number;
  hotbarSlots: BlockType[];
  isInventoryOpen: boolean;
  onSelectBlock: (block: BlockType) => void;
  onSelectSlot?: (index: number) => void;
  onCloseInventory?: () => void;
  debugInfo?: DebugInfo;
  isDebugVisible?: boolean;
  isMobile?: boolean;
  brushRadius?: number;
  videoSettings: VideoSettingsValues;
  onVideoSettingsChange: (values: Partial<VideoSettingsValues>) => void;
}

export default function UILayer({
  phase,
  loadProgress,
  loadStageLabel,
  loadStages,
  activeWorldName,
  worlds,
  isLoadingWorlds,
  onPlayWorld,
  onCreateWorld,
  onRenameWorld,
  onDeleteWorld,
  onJoinHostedWorld,
  onResume,
  onOpenPauseMenu,
  onSaveNow,
  onExitToWorlds,
  onHost,
  onJoin,
  peerId,
  selectedSlot,
  hotbarSlots,
  isInventoryOpen,
  onSelectBlock,
  onSelectSlot,
  onCloseInventory,
  debugInfo,
  isDebugVisible,
  isMobile,
  brushRadius,
  videoSettings,
  onVideoSettingsChange,
}: UILayerProps) {
  useProfiledRender("uiLayer");
  const isInWorld = phase === "playing" || phase === "paused";
  const isOnBackdropScreen = phase === "title" || phase === "loading";
  const [isBackdropMounted, setIsBackdropMounted] = useState(true);

  useEffect(() => {
    if (isOnBackdropScreen) setIsBackdropMounted(true);
  }, [isOnBackdropScreen]);

  return (
    <div
      className={
        "absolute top-0 bottom-0 left-0 right-0 flex flex-col " +
        DEFAULT_UI_FONT.className
      }
    >
      {phase === "playing" && !isInventoryOpen && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none mix-blend-difference text-3xl font-normal z-1"
          id={"crosshairLayer"}
        >
          +
        </div>
      )}

      {phase === "playing" && (
        <Hotbar
          selectedSlot={selectedSlot}
          slots={hotbarSlots}
          onSelectSlot={onSelectSlot}
          brushRadius={brushRadius}
        />
      )}
      <Inventory
        isOpen={isInventoryOpen}
        onSelectBlock={onSelectBlock}
        onClose={onCloseInventory}
      />

      {debugInfo && isInWorld && (
        <DebugOverlay
          isVisible={isDebugVisible ?? false}
          debugInfo={debugInfo}
        />
      )}

      {isMobile && phase === "playing" && (
        <PixelButton
          onClick={onOpenPauseMenu}
          className="absolute right-3 top-3 z-30"
        >
          Menu
        </PixelButton>
      )}

      {isBackdropMounted && (
        <div
          className={`absolute inset-0 z-30 ${isOnBackdropScreen ? "" : "pointer-events-none"}`}
        >
          <PixelSandBackdrop
            fillTarget={phase === "loading" ? loadProgress : TITLE_PILE_HEIGHT}
            ambient={phase === "title"}
            isFinishing={!isOnBackdropScreen}
            onDissolved={() => setIsBackdropMounted(false)}
          />
        </div>
      )}

      {phase === "title" && (
        <TitleMenu
          worlds={worlds}
          isLoadingWorlds={isLoadingWorlds}
          onPlayWorld={onPlayWorld}
          onCreateWorld={onCreateWorld}
          onRenameWorld={onRenameWorld}
          onDeleteWorld={onDeleteWorld}
          onJoinHostedWorld={onJoinHostedWorld}
        />
      )}

      {phase === "paused" && (
        <PauseMenu
          worldName={activeWorldName}
          isMobile={isMobile ?? false}
          peerId={peerId}
          onResume={onResume}
          onSaveNow={onSaveNow}
          onExitToWorlds={onExitToWorlds}
          onHost={onHost}
          onJoin={onJoin}
          videoSettings={videoSettings}
          onVideoSettingsChange={onVideoSettingsChange}
        />
      )}

      {phase === "loading" && (
        <LoadingHud
          progress={loadProgress}
          stageLabel={loadStageLabel}
          stages={loadStages}
          worldName={activeWorldName}
        />
      )}
    </div>
  );
}
