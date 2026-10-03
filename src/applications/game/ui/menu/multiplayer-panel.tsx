import { useState } from "react";
import { MenuButton } from "./menu-primitives";

interface MultiplayerPanelProps {
  peerId?: string;
  onHost?: () => void;
  onJoin?: (hostId: string) => void;
}

export function MultiplayerPanel({
  peerId,
  onHost,
  onJoin,
}: MultiplayerPanelProps) {
  const [hostIdInput, setHostIdInput] = useState("");

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        <h3 className="font-bold">Host a game</h3>
        {peerId ? (
          <p className="break-all text-neutral-300">
            Share this ID with friends:{" "}
            <span className="select-all rounded bg-white px-1.5 py-0.5 text-black">
              {peerId}
            </span>
          </p>
        ) : (
          <MenuButton onClick={onHost}>Start hosting</MenuButton>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-bold">Join a game</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Host ID"
            className="min-w-0 grow rounded-md bg-white px-3 py-2 text-black"
            value={hostIdInput}
            onChange={(event) => setHostIdInput(event.target.value)}
          />
          <MenuButton
            disabled={!hostIdInput.trim()}
            onClick={() => onJoin?.(hostIdInput.trim())}
          >
            Join
          </MenuButton>
        </div>
        <p className="text-xs text-neutral-400">
          Joining replaces your current world with the host&apos;s world.
        </p>
      </div>
    </div>
  );
}
