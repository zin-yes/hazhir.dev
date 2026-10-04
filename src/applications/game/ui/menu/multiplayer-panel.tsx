import { useState } from "react";
import { PixelButton, PixelInput } from "../pixel/pixel-ui";
import { useProfiledRender } from "../use-profiled-render";
import { SettingsHeading, SettingsHint } from "./setting-rows";

interface MultiplayerPanelProps {
  peerId?: string;
  connectedPlayerCount: number;
  isConnectedToHost: boolean;
  onHost?: () => Promise<unknown> | void;
  onJoin?: (hostId: string) => Promise<unknown> | void;
}

type RequestState = "idle" | "pending" | "failed";

export function MultiplayerPanel({
  peerId,
  connectedPlayerCount,
  isConnectedToHost,
  onHost,
  onJoin,
}: MultiplayerPanelProps) {
  useProfiledRender("multiplayerPanel");
  const [hostIdInput, setHostIdInput] = useState("");
  const [hostRequest, setHostRequest] = useState<RequestState>("idle");
  const [joinRequest, setJoinRequest] = useState<RequestState>("idle");
  const [hasCopiedId, setHasCopiedId] = useState(false);

  const hostIdToJoin = hostIdInput.trim();

  const startHosting = async () => {
    setHostRequest("pending");
    try {
      await onHost?.();
      setHostRequest("idle");
    } catch {
      setHostRequest("failed");
    }
  };

  const joinHost = async () => {
    if (!hostIdToJoin || joinRequest === "pending") return;
    setJoinRequest("pending");
    try {
      await onJoin?.(hostIdToJoin);
      setJoinRequest("idle");
    } catch {
      setJoinRequest("failed");
    }
  };

  const copyPeerId = async () => {
    if (!peerId) return;
    try {
      await navigator.clipboard.writeText(peerId);
      setHasCopiedId(true);
      setTimeout(() => setHasCopiedId(false), 1500);
    } catch {
      // The id stays selectable for a manual copy.
    }
  };

  if (isConnectedToHost) {
    return (
      <div className="flex flex-col gap-3 text-xs">
        <SettingsHeading>Connected</SettingsHeading>
        <p className="text-[#d8d2f0]">You are playing in a friend&apos;s world.</p>
        <SettingsHint>To go back to your own worlds, pick Save and switch world on the Game tab.</SettingsHint>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 text-xs">
      <section className="flex flex-col gap-3">
        <SettingsHeading>Host a room</SettingsHeading>
        {peerId ? (
          <>
            <p className="text-[#9a91bd]">
              {connectedPlayerCount === 0
                ? "Room is open. Waiting for friends."
                : `${connectedPlayerCount} ${connectedPlayerCount === 1 ? "friend" : "friends"} connected.`}
            </p>
            <div className="flex gap-2">
              <span className="min-w-0 flex-1 select-all break-all bg-[#0d0b14] px-3 py-2 text-[#f1ecff]">{peerId}</span>
              <PixelButton onClick={copyPeerId}>{hasCopiedId ? "Copied" : "Copy"}</PixelButton>
            </div>
            <SettingsHint>Send this room ID to a friend. They paste it under Join a room.</SettingsHint>
          </>
        ) : (
          <>
            <PixelButton tone="primary" disabled={hostRequest === "pending"} onClick={startHosting}>
              {hostRequest === "pending" ? "Opening room..." : "Start hosting"}
            </PixelButton>
            {hostRequest === "failed" && (
              <p className="text-[#ff6b7a]">Could not open a room. Check your connection and try again.</p>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SettingsHeading>Join a room</SettingsHeading>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void joinHost();
          }}
        >
          <PixelInput
            type="text"
            placeholder="Paste room ID"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={hostIdInput}
            onChange={(event) => {
              setHostIdInput(event.target.value);
              setJoinRequest("idle");
            }}
          />
          <PixelButton type="submit" disabled={!hostIdToJoin || joinRequest === "pending"}>
            {joinRequest === "pending" ? "Joining..." : "Join"}
          </PixelButton>
        </form>
        {joinRequest === "failed" && (
          <p className="text-[#ff6b7a]">Could not reach that room. Check the ID and try again.</p>
        )}
        <SettingsHint>Joining swaps your world for the host&apos;s.</SettingsHint>
      </section>
    </div>
  );
}
