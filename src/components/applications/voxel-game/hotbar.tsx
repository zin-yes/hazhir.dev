"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Silkscreen } from "next/font/google";

const font = Silkscreen({ subsets: ["latin"], weight: ["400"] });

export default function Hotbar({
  setBlock,
}: {
  setBlock: (value: number) => void;
}) {
  const [currentBlock, setCurrentBlock] = useState<number>(0);
  let block = 0;

  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      const onKeyDown = function (event: KeyboardEvent) {
        switch (event.code) {
          case "Digit1":
            setCurrentBlock(0);
            setBlock(0);
            break;
          case "Digit2":
            setCurrentBlock(1);
            setBlock(1);
            break;
          case "Digit3":
            setCurrentBlock(2);
            setBlock(2);
            break;
          case "Digit4":
            setCurrentBlock(3);
            setBlock(3);
            break;
          case "Digit5":
            setCurrentBlock(4);
            setBlock(4);
            break;
          case "Digit6":
            setCurrentBlock(5);
            setBlock(5);
          case "Digit7":
            setCurrentBlock(6);
            setBlock(6);
            break;
          case "Digit8":
            setCurrentBlock(7);
            setBlock(7);
            break;
        }
      };
      document.addEventListener("wheel", onScroll);
      document.addEventListener("keydown", onKeyDown);
    }
  }, [initialized]);

  const onScroll = function (event: WheelEvent) {
    const deltaY = Math.round(event.deltaY / 100);

    block = (block + deltaY) % 8;
    if (block <= -1) block = 7;

    setCurrentBlock(block);
    setBlock(block);
  };

  return (
    <>
      <div className="absolute bottom-0 right-0 left-0 flex items-center justify-center pointer-events-none">
        <div className="flex flex-row justify-center items-center gap-2 p-2 m-1">
          <div
            className={
              (currentBlock === 0 ? "bg-slate-100" : "") +
              " transition-all duration-200 block rounded-xl  p-1.5"
            }
          >
            <div
              className={
                "w-[5vw] aspect-square max-w-16 text-right p-1 pr-2 text-xl rounded-xl " +
                font.className
              }
              style={{
                imageRendering: "pixelated",
                background: "url('/voxel-game/blocks/cobblestone.png')",
                backgroundSize: "100%",
                backgroundPosition: "center center",
              }}
            >
              <div className={currentBlock === 0 ? "text-black" : "text-white"}>
                1
              </div>
            </div>
          </div>
          <div
            className={
              (currentBlock === 1 ? "bg-slate-100" : "") +
              " transition-all duration-200 block rounded-xl p-1.5"
            }
          >
            <div
              className={
                "w-[5vw] aspect-square max-w-16 text-right p-1 pr-2 text-xl rounded-xl text-black " +
                font.className
              }
              style={{
                imageRendering: "pixelated",
                background: "url('/voxel-game/blocks/dirt.png')",
                backgroundSize: "100%",
                backgroundPosition: "center center",
              }}
            >
              <div className={currentBlock === 1 ? "text-black" : "text-white"}>
                2
              </div>
            </div>
          </div>
          <div
            className={
              (currentBlock === 2 ? "bg-slate-100" : "") +
              " transition-all duration-200 block rounded-xl  p-1.5"
            }
          >
            <div
              className={
                "w-[5vw] aspect-square max-w-16 text-right p-1 pr-2 text-xl rounded-xl text-black " +
                font.className
              }
              style={{
                imageRendering: "pixelated",
                background: "url('/voxel-game/blocks/sand.png')",
                backgroundSize: "100%",
                backgroundPosition: "center center",
              }}
            >
              <div className={currentBlock === 2 ? "text-black" : "text-white"}>
                3
              </div>
            </div>
          </div>
          <div
            className={
              (currentBlock === 3 ? "bg-slate-100" : "") +
              " transition-all duration-200 block rounded-xl  p-1.5"
            }
          >
            <div
              className={
                "w-[5vw] aspect-square max-w-16 text-right p-1 pr-2 text-xl rounded-xl text-black " +
                font.className
              }
              style={{
                imageRendering: "pixelated",
                background: "url('/voxel-game/blocks/planks.png')",
                backgroundSize: "100%",
                backgroundPosition: "center center",
              }}
            >
              <div className={currentBlock === 3 ? "text-black" : "text-white"}>
                4
              </div>
            </div>
          </div>
          <div
            className={
              (currentBlock === 4 ? "bg-slate-100" : "") +
              " transition-all duration-200 block rounded-xl p-1.5"
            }
          >
            <div
              className={
                "w-[5vw] aspect-square max-w-16 text-right p-1 pr-2 text-xl rounded-xl text-black " +
                font.className
              }
              style={{
                imageRendering: "pixelated",
                background: "url('/voxel-game/blocks/grass_side.png')",
                backgroundSize: "100%",
                backgroundPosition: "center center",
              }}
            >
              <div
                className={currentBlock === 4 ? "text-black" : "text-white "}
              >
                5
              </div>
            </div>
          </div>
          <div
            className={
              (currentBlock === 5 ? "bg-slate-100" : "") +
              " transition-all duration-200 block rounded-xl p-1.5"
            }
          >
            <div
              className={
                "w-[5vw] aspect-square max-w-16 text-right p-1 pr-2 text-xl rounded-xl text-black " +
                font.className
              }
              style={{
                imageRendering: "pixelated",
                background: "url('/voxel-game/blocks/glass.png')",
                backgroundSize: "100%",
                backgroundPosition: "center center",
              }}
            >
              <div
                className={currentBlock === 5 ? "text-black" : "text-white "}
              >
                6
              </div>
            </div>
          </div>
          <div
            className={
              (currentBlock === 6 ? "bg-slate-100" : "") +
              " transition-all duration-200 block rounded-xl p-1.5"
            }
          >
            <div
              className={
                "w-[5vw] aspect-square max-w-16 text-right p-1 pr-2 text-xl rounded-xl text-black " +
                font.className
              }
              style={{
                imageRendering: "pixelated",
                background: "url('/voxel-game/blocks/log_side.png')",
                backgroundSize: "100%",
                backgroundPosition: "center center",
              }}
            >
              <div
                className={currentBlock === 6 ? "text-black" : "text-white "}
              >
                7
              </div>
            </div>
          </div>
          <div
            className={
              (currentBlock === 7 ? "bg-slate-100" : "") +
              " transition-all duration-200 block rounded-xl p-1.5"
            }
          >
            <div
              className={
                "w-[5vw] aspect-square max-w-16 text-right p-1 pr-2 text-xl rounded-xl text-black " +
                font.className
              }
              style={{
                imageRendering: "pixelated",
                background: "url('/voxel-game/blocks/leaves.png')",
                backgroundSize: "100%",
                backgroundPosition: "center center",
              }}
            >
              <div
                className={currentBlock === 7 ? "text-black" : "text-white "}
              >
                8
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
