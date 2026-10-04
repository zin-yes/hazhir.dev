import { useState } from "react";
import { PixelButton, PixelInput } from "../pixel/pixel-ui";
import { useProfiledRender } from "../use-profiled-render";

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
  useProfiledRender("multiplayerPanel");
  const [hostIdInput, setHostIdInput] = useState("");

  return (
    <div className="flex flex-col gap-5 text-xs">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[#b6f24a]">
          Host
        </h3>
        {peerId ? (
          <p className="break-all text-[#9a91bd]">
            Share this ID:{" "}
            <span className="select-all bg-[#f1ecff] px-1.5 py-0.5 text-[#171327]">
              {peerId}
            </span>
          </p>
        ) : (
          <PixelButton onClick={onHost}>Start hosting</PixelButton>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[#b6f24a]">
          Join
        </h3>
        <div className="flex gap-2">
          <PixelInput
            type="text"
            placeholder="Host ID"
            value={hostIdInput}
            onChange={(event) => setHostIdInput(event.target.value)}
          />
          <PixelButton
            disabled={!hostIdInput.trim()}
            onClick={() => onJoin?.(hostIdInput.trim())}
          >
            Join
          </PixelButton>
        </div>
        <p className="text-[#6e6590]">
          Joining swaps your world for the host&apos;s.
        </p>
      </section>
    </div>
  );
}
