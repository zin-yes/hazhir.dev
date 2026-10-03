import { useState } from "react";
import { ControlsList } from "./controls-list";
import { MenuBackdrop, MenuButton, MenuPanel } from "./menu-primitives";
import { MultiplayerPanel } from "./multiplayer-panel";

type PauseMenuTab = "game" | "controls" | "multiplayer";

const TAB_LABELS: Record<PauseMenuTab, string> = {
  game: "Game",
  controls: "Controls",
  multiplayer: "Multiplayer",
};

interface PauseMenuProps {
  worldName: string;
  isMobile: boolean;
  peerId?: string;
  onResume: () => void;
  onSaveNow: () => void;
  onExitToWorlds: () => void;
  onHost?: () => void;
  onJoin?: (hostId: string) => void;
}

export function PauseMenu({
  worldName,
  isMobile,
  peerId,
  onResume,
  onSaveNow,
  onExitToWorlds,
  onHost,
  onJoin,
}: PauseMenuProps) {
  const [activeTab, setActiveTab] = useState<PauseMenuTab>("game");

  return (
    <MenuBackdrop onBackdropClick={isMobile ? undefined : onResume}>
      <MenuPanel>
        <div className="mb-4 text-center">
          <p className="text-xs uppercase tracking-widest text-neutral-400">
            Paused
          </p>
          <h2 className="truncate text-2xl font-bold">{worldName}</h2>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1">
          {(Object.keys(TAB_LABELS) as PauseMenuTab[]).map((tab) => (
            <button
              key={tab}
              data-mobile-ui
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-2 py-2 text-xs font-bold transition sm:text-sm ${
                activeTab === tab
                  ? "bg-white text-black"
                  : "text-neutral-300 hover:bg-white/10"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {activeTab === "game" && (
          <div className="flex flex-col gap-2">
            <MenuButton variant="primary" className="py-3 text-base" onClick={onResume}>
              {isMobile ? "Tap to resume" : "Click to resume"}
            </MenuButton>
            <MenuButton onClick={onSaveNow}>Save now</MenuButton>
            <MenuButton onClick={onExitToWorlds}>Save and switch world</MenuButton>
            <p className="mt-2 text-center text-xs text-neutral-400">
              Your world autosaves whenever you pause. The game is frozen while
              this menu is open.
            </p>
          </div>
        )}
        {activeTab === "controls" && <ControlsList />}
        {activeTab === "multiplayer" && (
          <MultiplayerPanel peerId={peerId} onHost={onHost} onJoin={onJoin} />
        )}
      </MenuPanel>
    </MenuBackdrop>
  );
}
