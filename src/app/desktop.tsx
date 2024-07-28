"use client";

import {
  Gamepad2,
  SquareTerminal,
  TerminalSquare,
  TerminalSquareIcon,
} from "lucide-react";

import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";

import { GameApplicationPane, TerminalApplicationPane } from "./page";
import { ReactNode } from "react";
import { v4 } from "uuid";
import dynamic from "next/dynamic";

const Wallpaper = dynamic(() => import("./wallpaper"), {
  ssr: false,
});

export default function Desktop({
  addPane,
}: {
  addPane: (node: ReactNode) => void;
}) {
  return (
    <div className="w-[100vw] h-[100vh] absolute top-0 bottom-0 left-0 right-0 overflow-hidden z-0">
      <Wallpaper />
      <div className="h-[calc(100vh-52px)] w-full bottom-0 left-0 right-0 absolute p-4">
        <div className="w-full h-full flex flex-row gap-4 items-start ">
          <div
            onClick={() =>
              addPane(<TerminalApplicationPane identifier={v4()} />)
            }
          >
            <DesktopIcon icon={<SquareTerminal size={30} />} title="Terminal" />
          </div>
          <div onClick={() => addPane(<GameApplicationPane />)}>
            <DesktopIcon icon={<Gamepad2 size={30} />} title="Voxel Game" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopIcon({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <CardContainer className=" transition-all duration-500 w-fit h-fit mt-[-80px]  cursor-pointer">
      <CardBody className="max-w-25 max-h-28 bg-white/15 hover:bg-white/110 backdrop-blur-xl transition-all duration-500 rounded-2xl p-4 flex flex-col gap-2 justify-start items-center hover:scale-105 active:scale-[1.15] active:bg-white/25 text-white">
        <CardItem className="h-[30px] w-20 flex justify-center items-center ">
          {icon}
        </CardItem>
        <CardItem className="font-medium w-20 text-center ">{title}</CardItem>
      </CardBody>
    </CardContainer>
  );
}
