import { Silkscreen } from "next/font/google";
import { BlockType, LOADING_SCREEN_TEXTURES } from "../blocks";
import type { StoredWorld } from "../worlds/world-store";
import { DebugInfo, DebugOverlay } from "./debug-overlay";
import { Hotbar } from "./hotbar";
import { Inventory } from "./inventory";
import { LoadingScreen } from "./menu/loading-screen";
import { PauseMenu } from "./menu/pause-menu";
import { TitleMenu } from "./menu/title-menu";

const DEFAULT_UI_FONT = Silkscreen({
  weight: ["400", "700"],
  subsets: ["latin"],
});

export type GamePhase = "title" | "loading" | "paused" | "playing";

interface UILayerProps {
  phase: GamePhase;
  loadProgress: number;
  activeWorldName: string;
  worlds: StoredWorld[];
  isLoadingWorlds: boolean;
  onPlayWorld: (worldId: string) => void;
  onCreateWorld: (name: string, seedText: string) => void;
  onRenameWorld: (worldId: string, name: string) => void;
  onDeleteWorld: (worldId: string) => void;
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
}

export default function UILayer({
  phase,
  loadProgress,
  activeWorldName,
  worlds,
  isLoadingWorlds,
  onPlayWorld,
  onCreateWorld,
  onRenameWorld,
  onDeleteWorld,
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
}: UILayerProps) {
  const isInWorld = phase === "playing" || phase === "paused";

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

      {isInWorld && (
        <Hotbar
          selectedSlot={selectedSlot}
          slots={hotbarSlots}
          onSelectSlot={onSelectSlot}
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
        <button
          data-mobile-ui
          onClick={onOpenPauseMenu}
          className="absolute right-3 top-3 z-30 rounded-md bg-black/50 px-3 py-2 text-xs font-bold"
        >
          Menu
        </button>
      )}

      {phase === "title" && (
        <TitleMenu
          worlds={worlds}
          isLoadingWorlds={isLoadingWorlds}
          onPlayWorld={onPlayWorld}
          onCreateWorld={onCreateWorld}
          onRenameWorld={onRenameWorld}
          onDeleteWorld={onDeleteWorld}
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
        />
      )}

      {phase === "loading" && (
        <LoadingScreen
          progress={loadProgress}
          worldName={activeWorldName}
          tileTextures={LOADING_SCREEN_TEXTURES}
        />
      )}
    </div>
  );
}
