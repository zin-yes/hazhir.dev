import { useState } from "react";
import type { StoredWorld } from "../../worlds/world-store";
import { MenuBackdrop, MenuButton, MenuPanel } from "./menu-primitives";

interface TitleMenuProps {
  worlds: StoredWorld[];
  isLoadingWorlds: boolean;
  onPlayWorld: (worldId: string) => void;
  onCreateWorld: (name: string, seedText: string) => void;
  onRenameWorld: (worldId: string, name: string) => void;
  onDeleteWorld: (worldId: string) => void;
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
}: TitleMenuProps) {
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
      <div className="text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">Voxel</h1>
        <p className="mt-1 text-sm text-neutral-300">
          Pick a world to jump into, or start a new one.
        </p>
      </div>

      <MenuPanel>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Your worlds</h2>
          {!isCreating && (
            <MenuButton variant="primary" onClick={() => setIsCreating(true)}>
              + New world
            </MenuButton>
          )}
        </div>

        {isCreating && (
          <form
            className="mb-4 flex flex-col gap-2 rounded-lg border border-emerald-400/40 bg-emerald-400/5 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              submitNewWorld();
            }}
          >
            <input
              autoFocus
              type="text"
              maxLength={40}
              placeholder="World name"
              className="rounded-md bg-white px-3 py-2 text-black"
              value={newWorldName}
              onChange={(event) => setNewWorldName(event.target.value)}
            />
            <input
              type="text"
              placeholder="Seed (optional, random if empty)"
              className="rounded-md bg-white px-3 py-2 text-black"
              value={newWorldSeed}
              onChange={(event) => setNewWorldSeed(event.target.value)}
            />
            <div className="flex gap-2">
              <MenuButton type="submit" variant="primary" className="grow">
                Create and play
              </MenuButton>
              <MenuButton type="button" onClick={() => setIsCreating(false)}>
                Cancel
              </MenuButton>
            </div>
          </form>
        )}

        {isLoadingWorlds ? (
          <p className="py-6 text-center text-sm text-neutral-400">
            Loading worlds...
          </p>
        ) : worlds.length === 0 && !isCreating ? (
          <p className="py-6 text-center text-sm text-neutral-400">
            No worlds yet. Create one to get started.
          </p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
            {worlds.map((world) => (
              <li
                key={world.id}
                className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 grow">
                  {renamingWorldId === world.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitRename(world.id);
                      }}
                    >
                      <input
                        autoFocus
                        type="text"
                        maxLength={40}
                        className="min-w-0 grow rounded-md bg-white px-2 py-1 text-black"
                        value={renameInput}
                        onChange={(event) => setRenameInput(event.target.value)}
                        onBlur={() => submitRename(world.id)}
                      />
                    </form>
                  ) : (
                    <p className="truncate font-bold">{world.name}</p>
                  )}
                  <p className="truncate text-xs text-neutral-400">
                    Played {formatLastPlayed(world.lastPlayedAt)} -{" "}
                    {countEditedBlocks(world)} edits - seed {world.seed}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <MenuButton
                    variant="primary"
                    onClick={() => onPlayWorld(world.id)}
                  >
                    Play
                  </MenuButton>
                  <MenuButton
                    onClick={() => {
                      setRenamingWorldId(world.id);
                      setRenameInput(world.name);
                    }}
                  >
                    Rename
                  </MenuButton>
                  {worldIdPendingDelete === world.id ? (
                    <MenuButton
                      variant="danger"
                      onClick={() => {
                        setWorldIdPendingDelete(null);
                        onDeleteWorld(world.id);
                      }}
                      onBlur={() => setWorldIdPendingDelete(null)}
                      autoFocus
                    >
                      Sure?
                    </MenuButton>
                  ) : (
                    <MenuButton
                      variant="danger"
                      onClick={() => setWorldIdPendingDelete(world.id)}
                    >
                      Delete
                    </MenuButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </MenuPanel>
    </MenuBackdrop>
  );
}
