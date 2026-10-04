import { useState } from "react";
import type { StoredWorld } from "../../worlds/world-store";
import {
  PixelButton,
  PixelFrame,
  PixelInput,
  PixelLogo,
} from "../pixel/pixel-ui";
import { MenuBackdrop } from "./menu-primitives";
import { WorldAvatar } from "./world-avatar";
import { useProfiledRender } from "../use-profiled-render";

interface TitleMenuProps {
  worlds: StoredWorld[];
  isLoadingWorlds: boolean;
  onPlayWorld: (worldId: string) => void;
  onCreateWorld: (name: string, seedText: string) => void;
  onRenameWorld: (worldId: string, name: string) => void;
  onDeleteWorld: (worldId: string) => void;
  onJoinHostedWorld: (hostId: string) => void;
}

function formatLastPlayed(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function countEditedBlocks(world: StoredWorld): number {
  return world.modifiedChunks.reduce(
    (total, [, edits]) => total + edits.length,
    0,
  );
}

export function TitleMenu({
  worlds,
  isLoadingWorlds,
  onPlayWorld,
  onCreateWorld,
  onRenameWorld,
  onDeleteWorld,
  onJoinHostedWorld,
}: TitleMenuProps) {
  useProfiledRender("titleMenu");
  const [hostIdInput, setHostIdInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newWorldName, setNewWorldName] = useState("");
  const [newWorldSeed, setNewWorldSeed] = useState("");
  const [renamingWorldId, setRenamingWorldId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [worldIdPendingDelete, setWorldIdPendingDelete] = useState<
    string | null
  >(null);

  const submitNewWorld = () => {
    onCreateWorld(newWorldName, newWorldSeed);
    setIsCreating(false);
    setNewWorldName("");
    setNewWorldSeed("");
  };

  const submitRename = (worldId: string) => {
    if (renameInput.trim()) onRenameWorld(worldId, renameInput.trim());
    setRenamingWorldId(null);
  };

  return (
    <MenuBackdrop>
      <div className="mt-2 text-center">
        <PixelLogo>VOXEL</PixelLogo>
        <p className="mt-5 text-xs text-[#9a91bd]">
          Pick a world, or dig a new one.
        </p>
      </div>

      <PixelFrame className="w-full max-w-xl" innerClassName="p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#b6f24a]">
            Worlds
          </h2>
          {!isCreating && (
            <PixelButton tone="primary" onClick={() => setIsCreating(true)}>
              + New
            </PixelButton>
          )}
        </div>

        {isCreating && (
          <form
            className="mb-4 flex flex-col gap-2 border-4 border-dashed border-[#b6f24a]/50 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              submitNewWorld();
            }}
          >
            <PixelInput
              autoFocus
              type="text"
              maxLength={40}
              placeholder="World name"
              value={newWorldName}
              onChange={(event) => setNewWorldName(event.target.value)}
            />
            <PixelInput
              type="text"
              placeholder="Seed (optional)"
              value={newWorldSeed}
              onChange={(event) => setNewWorldSeed(event.target.value)}
            />
            <div className="flex gap-2">
              <PixelButton type="submit" tone="primary" className="grow">
                Create and play
              </PixelButton>
              <PixelButton type="button" onClick={() => setIsCreating(false)}>
                Cancel
              </PixelButton>
            </div>
          </form>
        )}

        {isLoadingWorlds ? (
          <p className="py-6 text-center text-xs text-[#6e6590]">
            Reading saves...
          </p>
        ) : worlds.length === 0 && !isCreating ? (
          <p className="py-6 text-center text-xs text-[#6e6590]">
            Nothing here yet. Hit + New to start.
          </p>
        ) : (
          <ul className="flex max-h-[44vh] flex-col gap-3 overflow-y-auto pr-1">
            {worlds.map((world) => (
              <li
                key={world.id}
                className="flex flex-col gap-3 border-4 border-[#2b2447] bg-[#0d0b14] p-3 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 grow items-center gap-3">
                  <WorldAvatar seed={world.seed} />
                  <div className="min-w-0 grow">
                    {renamingWorldId === world.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitRename(world.id);
                        }}
                      >
                        <PixelInput
                          autoFocus
                          type="text"
                          maxLength={40}
                          value={renameInput}
                          onChange={(event) => setRenameInput(event.target.value)}
                          onBlur={() => submitRename(world.id)}
                        />
                      </form>
                    ) : (
                      <p className="truncate text-sm font-bold">{world.name}</p>
                    )}
                    <p className="text-[0.65rem] leading-relaxed text-[#6e6590]">
                      {formatLastPlayed(world.lastPlayedAt)}
                      <br />
                      {countEditedBlocks(world)} edits - seed {world.seed}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <PixelButton
                    tone="primary"
                    onClick={() => onPlayWorld(world.id)}
                  >
                    Play
                  </PixelButton>
                  <PixelButton
                    onClick={() => {
                      setRenamingWorldId(world.id);
                      setRenameInput(world.name);
                    }}
                  >
                    Edit
                  </PixelButton>
                  {worldIdPendingDelete === world.id ? (
                    <PixelButton
                      tone="danger"
                      autoFocus
                      onClick={() => {
                        setWorldIdPendingDelete(null);
                        onDeleteWorld(world.id);
                      }}
                      onBlur={() => setWorldIdPendingDelete(null)}
                    >
                      Sure?
                    </PixelButton>
                  ) : (
                    <PixelButton
                      tone="danger"
                      onClick={() => setWorldIdPendingDelete(world.id)}
                    >
                      Del
                    </PixelButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PixelFrame>

      <PixelFrame className="w-full max-w-xl" innerClassName="p-5 sm:p-6">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#b6f24a]">
          Join a friend
        </h2>
        <p className="mb-3 mt-1 text-[0.65rem] text-[#6e6590]">
          Paste a host ID to drop into their world. Nothing is saved to yours.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (hostIdInput.trim()) onJoinHostedWorld(hostIdInput.trim());
          }}
        >
          <PixelInput
            type="text"
            placeholder="Host ID"
            value={hostIdInput}
            onChange={(event) => setHostIdInput(event.target.value)}
          />
          <PixelButton type="submit" disabled={!hostIdInput.trim()}>
            Join
          </PixelButton>
        </form>
      </PixelFrame>
    </MenuBackdrop>
  );
}
