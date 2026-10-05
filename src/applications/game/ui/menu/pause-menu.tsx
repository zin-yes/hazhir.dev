import { useState } from "react";
import type { GameSettings } from "../../settings/game-settings";
import { PixelButton, PixelFrame } from "../pixel/pixel-ui";
import { ControlsSettings } from "./controls-settings";
import { MenuBackdrop } from "./menu-primitives";
import { MultiplayerPanel } from "./multiplayer-panel";
import { SettingsHint } from "./setting-rows";
import { TouchSettings } from "./touch-settings";
import { useProfiledRender } from "../use-profiled-render";
import { VideoSettings, type VideoSettingsValues } from "./video-settings";

type PauseMenuTab = "game" | "video" | "controls" | "touch" | "multiplayer";

const TAB_LABELS: Record<PauseMenuTab, string> = {
  game: "Game",
  video: "Video",
  controls: "Input",
  touch: "Touch",
  multiplayer: "Friends",
};

interface PauseMenuProps {
  worldName: string;
  isMobile: boolean;
  peerId?: string;
  connectedPlayerCount: number;
  isConnectedToHost: boolean;
  onResume: () => void;
  onSaveNow: () => void;
  onExitToWorlds: () => void;
  onHost?: () => Promise<unknown> | void;
  onJoin?: (hostId: string) => Promise<unknown> | void;
  videoSettings: VideoSettingsValues;
  onVideoSettingsChange: (values: Partial<VideoSettingsValues>) => void;
  gameSettings: GameSettings;
  onGameSettingsChange: (changes: Partial<GameSettings>) => void;
}

export function PauseMenu({
  worldName,
  isMobile,
  peerId,
  connectedPlayerCount,
  isConnectedToHost,
  onResume,
  onSaveNow,
  onExitToWorlds,
  onHost,
  onJoin,
  videoSettings,
  onVideoSettingsChange,
  gameSettings,
  onGameSettingsChange,
}: PauseMenuProps) {
  useProfiledRender("pauseMenu");
  const [activeTab, setActiveTab] = useState<PauseMenuTab>("game");
  // Video values live in the game as a ref, so the menu keeps its own copy for the sliders to follow.
  const [videoValues, setVideoValues] = useState(videoSettings);
  const visibleTabs = (Object.keys(TAB_LABELS) as PauseMenuTab[]).filter((tab) => tab !== "touch" || isMobile);

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

        <div className="mb-5 flex flex-wrap gap-2">
          {visibleTabs.map((tab) => (
            <PixelButton
              key={tab}
              className="min-w-[5.5rem] flex-1"
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
            <SettingsHint>
              Autosaves every time you pause. The world is frozen while this menu is open.
            </SettingsHint>
          </div>
        )}
        {activeTab === "video" && (
          <VideoSettings
            values={videoValues}
            onChange={(changes) => {
              setVideoValues((previous) => ({ ...previous, ...changes }));
              onVideoSettingsChange(changes);
            }}
            fieldOfViewDegrees={gameSettings.fieldOfViewDegrees}
            onFieldOfViewChange={(fieldOfViewDegrees) => onGameSettingsChange({ fieldOfViewDegrees })}
            shadowQuality={gameSettings.shadowQuality}
            onShadowQualityChange={(shadowQuality) => onGameSettingsChange({ shadowQuality })}
            bloomEnabled={gameSettings.bloomEnabled}
            onBloomEnabledChange={(bloomEnabled) => onGameSettingsChange({ bloomEnabled })}
          />
        )}
        {activeTab === "controls" && (
          <ControlsSettings
            lookSensitivity={gameSettings.lookSensitivity}
            onLookSensitivityChange={(lookSensitivity) => onGameSettingsChange({ lookSensitivity })}
            isMobile={isMobile}
          />
        )}
        {activeTab === "touch" && <TouchSettings settings={gameSettings} onChange={onGameSettingsChange} />}
        {activeTab === "multiplayer" && (
          <MultiplayerPanel
            peerId={peerId}
            connectedPlayerCount={connectedPlayerCount}
            isConnectedToHost={isConnectedToHost}
            onHost={onHost}
            onJoin={onJoin}
          />
        )}
      </PixelFrame>
    </MenuBackdrop>
  );
}
