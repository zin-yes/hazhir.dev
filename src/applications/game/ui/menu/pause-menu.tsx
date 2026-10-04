import { useState } from "react";
import { PixelButton, PixelFrame } from "../pixel/pixel-ui";
import { ControlsList } from "./controls-list";
import { MenuBackdrop } from "./menu-primitives";
import { MultiplayerPanel } from "./multiplayer-panel";
import { useProfiledRender } from "../use-profiled-render";
import { VideoSettings, type VideoSettingsValues } from "./video-settings";

type PauseMenuTab = "game" | "video" | "controls" | "multiplayer";

const TAB_LABELS: Record<PauseMenuTab, string> = {
  game: "Game",
  video: "Video",
  controls: "Keys",
  multiplayer: "Friends",
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
  videoSettings: VideoSettingsValues;
  onVideoSettingsChange: (values: Partial<VideoSettingsValues>) => void;
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
  videoSettings,
  onVideoSettingsChange,
}: PauseMenuProps) {
  useProfiledRender("pauseMenu");
  const [activeTab, setActiveTab] = useState<PauseMenuTab>("game");

  return (
    <MenuBackdrop withVeil onBackdropClick={isMobile ? undefined : onResume}>
      <PixelFrame className="w-full max-w-lg" innerClassName="p-5 sm:p-6">
        <header className="mb-5 text-center">
          <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[#6e6590]">
            Paused
          </p>
          <h2 className="mt-1 truncate text-2xl font-bold text-[#b6f24a]">
            {worldName}
          </h2>
        </header>

        <div className="mb-5 grid grid-cols-4 gap-2">
          {(Object.keys(TAB_LABELS) as PauseMenuTab[]).map((tab) => (
            <PixelButton
              key={tab}
              tone={activeTab === tab ? "tabActive" : "tab"}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </PixelButton>
          ))}
        </div>

        {activeTab === "game" && (
          <div className="flex flex-col gap-3">
            <PixelButton tone="primary" className="w-full" onClick={onResume}>
              {isMobile ? "Tap to resume" : "Click to resume"}
            </PixelButton>
            <PixelButton className="w-full" onClick={onSaveNow}>
              Save now
            </PixelButton>
            <PixelButton className="w-full" onClick={onExitToWorlds}>
              Save and switch world
            </PixelButton>
            <p className="pt-1 text-center text-[0.65rem] leading-relaxed text-[#6e6590]">
              Autosaves every time you pause. The world is frozen while this
              menu is open.
            </p>
          </div>
        )}
        {activeTab === "video" && (
          <VideoSettings initialValues={videoSettings} onChange={onVideoSettingsChange} />
        )}
        {activeTab === "controls" && <ControlsList />}
        {activeTab === "multiplayer" && (
          <MultiplayerPanel peerId={peerId} onHost={onHost} onJoin={onJoin} />
        )}
      </PixelFrame>
    </MenuBackdrop>
  );
}
