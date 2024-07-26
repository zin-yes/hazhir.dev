import { Silkscreen } from "next/font/google";
import { NON_SOLID_BLOCKS, LOADING_SCREEN_TEXTURES } from "../blocks";
import Image from "next/image";
import { useRef } from "react";
const DEFAULT_UI_FONT = Silkscreen({
  weight: ["400", "700"],
  subsets: ["latin"],
});

export default function UILayer({}) {
  const uiLayerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={
        "absolute top-0 bottom-0 left-0 right-0 flex flex-col " +
        DEFAULT_UI_FONT.className
      }
      ref={uiLayerRef}
    >
      <div
        className="w-full h-full flex justify-center items-center flex-col transition-all duration-1000 bg-black z-4"
        id={"loadingLayer"}
      >
        <div
          className="absolute top-0 bottom-0 left-0 right-0 z-9 flex flex-row flex-wrap h-fit"
          id={"loadingLayerBackground"}
        ></div>
        <div className="z-10 flex flex-col justify-center items-center">
          <h1 className="text-2xl">Generating world...</h1>
          <p className="text-xl" id="initialLoadCompletion">
            0%
          </p>
        </div>
      </div>

      <div
        className={
          "absolute top-0 bottom-0 right-0 left-0 flex items-center justify-center pointer-events-none mix-blend-difference text-3xl font-normal z- 1"
        }
        id={"crosshairLayer"}
      >
        +
      </div>
    </div>
  );
}
