import { Silkscreen } from "next/font/google";
import { useRef, useState } from "react";
import { BlockType } from "../blocks";
import { Hotbar } from "./hotbar";
import { Inventory } from "./inventory";

const DEFAULT_UI_FONT = Silkscreen({
  weight: ["400", "700"],
  subsets: ["latin"],
});

interface UILayerProps {
  onHost?: () => void;
  onJoin?: (id: string) => void;
  onSave?: () => void;
  onLoad?: () => void;
  peerId?: string;
  selectedSlot: number;
  hotbarSlots: BlockType[];
  isInventoryOpen: boolean;
  onSelectBlock: (block: BlockType) => void;
}

export default function UILayer({
  onHost,
  onJoin,
  onSave,
  onLoad,
  peerId,
  selectedSlot,
  hotbarSlots,
  isInventoryOpen,
  onSelectBlock,
}: UILayerProps) {
  const uiLayerRef = useRef<HTMLDivElement>(null);
  const [joinId, setJoinId] = useState("");

  return (
    <div
      className={
        "absolute top-0 bottom-0 left-0 right-0 flex flex-col " +
        DEFAULT_UI_FONT.className
      }
      ref={uiLayerRef}
    >
      <div
        className="w-full h-full flex justify-center items-center flex-col transition-all duration-1000 bg-black z-10"
        id={"loadingLayer"}
      >
        <div
          className="absolute top-0 bottom-0 left-0 right-0 z-10 flex flex-row flex-wrap h-fit"
          id={"loadingLayerBackground"}
        ></div>
        <div className="z-10 flex flex-col justify-center items-center">
          <h1 className="text-2xl">Generating world...</h1>
          <p className="text-xl" id="initialLoadCompletion">
            0%
          </p>
        </div>
      </div>

      {!isInventoryOpen && (
        <div
          className={
            "absolute top-0 bottom-0 right-0 left-0 flex items-center justify-center pointer-events-none mix-blend-difference text-3xl font-normal z-1"
          }
          id={"crosshairLayer"}
        >
          +
        </div>
      )}

      <Hotbar selectedSlot={selectedSlot} slots={hotbarSlots} />
      <Inventory isOpen={isInventoryOpen} onSelectBlock={onSelectBlock} />

      <div
        className={
          "absolute top-0 bottom-0 right-0 left-0 flex flex-col items-center justify-center pointer-events-none text-md font-normal z-2"
        }
        id={"infoLayer"}
      >
        <div className="w-[70%] flex flex-col justify-center gap-4">
          <div className="bg-black p-6 px-8">
            <h2 className="text-center font-bold text-lg">Controls</h2>
            <p>
              You can look around using your mouse, use{" "}
              <span className="bg-white text-black px-2">LEFT CLICK</span> to
              break a block and{" "}
              <span className="bg-white text-black px-2">RIGHT CLICK</span> to
              place a block. Use your
              <span className="bg-white text-black px-2">WASD</span> keys to
              move around.
            </p>
          </div>
          <div className="bg-black p-6 px-8">
            <h2 className="text-center font-bold text-lg">
              To start playing...
            </h2>
            <p>
              Focus the window by clicking, then press escape to start playing
              (and do the same if you want to have your mouse back).
            </p>
          </div>
          <div className="bg-black p-6 px-8 pointer-events-auto">
            <h2 className="text-center font-bold text-lg">World Management</h2>
            <div className="flex flex-col gap-2 mt-2">
              <button
                onClick={onSave}
                className="bg-white text-black px-4 py-2 hover:bg-gray-200"
              >
                Save World
              </button>
              <button
                onClick={onLoad}
                className="bg-white text-black px-4 py-2 hover:bg-gray-200"
              >
                Load World
              </button>
            </div>
          </div>
          <div className="bg-black p-6 px-8 pointer-events-auto">
            <h2 className="text-center font-bold text-lg">Multiplayer</h2>
            <div className="flex flex-col gap-2 mt-2">
              {peerId ? (
                <p>
                  Your ID:{" "}
                  <span className="select-all bg-white text-black px-1">
                    {peerId}
                  </span>
                </p>
              ) : (
                <button
                  onClick={onHost}
                  className="bg-white text-black px-4 py-2 hover:bg-gray-200"
                >
                  Host Game
                </button>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter Host ID"
                  className="text-black px-2 py-1 flex-grow"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                />
                <button
                  onClick={() => onJoin && onJoin(joinId)}
                  className="bg-white text-black px-4 py-1 hover:bg-gray-200"
                >
                  Join
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
