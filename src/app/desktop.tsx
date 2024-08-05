"use client";

import {
  Calculator,
  FolderClosed,
  FolderIcon,
  Gamepad2,
  SquareTerminal,
  TerminalSquare,
  TerminalSquareIcon,
} from "lucide-react";

import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";

import { ReactNode } from "react";
import { v4 } from "uuid";
import dynamic from "next/dynamic";
import {
  CalculatorApplicationWindow,
  FileExplorerApplicationWindow,
  GameApplicationWindow,
  TerminalApplicationWindow,
} from "./application-windows";

const Wallpaper = dynamic(() => import("./wallpaper"), {
  ssr: false,
});

export default function Desktop({
  addWindow,
}: {
  addWindow: (node: ReactNode) => void;
}) {
  return (
    <div className="w-[100vw] h-[100vh] absolute top-0 bottom-0 left-0 right-0 overflow-hidden z-0">
      <Wallpaper />
      <div className="h-[calc(100vh-52px)] w-full bottom-0 left-0 right-0 absolute p-4">
        <div className="w-full  flex flex-row gap-4 items-start ">
          <div>
            <DesktopIcon
              icon={<SquareTerminal size={30} />}
              title="Terminal"
              onClick={() =>
                addWindow(<TerminalApplicationWindow identifier={v4()} />)
              }
            />
          </div>
          <div>
            <DesktopIcon
              icon={<Gamepad2 size={30} />}
              title="Voxel Game"
              onClick={() => addWindow(<GameApplicationWindow />)}
            />
          </div>
          <div className="h-fit">
            <DesktopIcon
              icon={<FolderClosed size={30} />}
              title="File Explorer"
              onClick={() =>
                addWindow(
                  <FileExplorerApplicationWindow addWindow={addWindow} />
                )
              }
            />
          </div>
          <div className="h-fit">
            <DesktopIcon
              icon={<Calculator size={30} />}
              title="Calculator"
              onClick={() => addWindow(<CalculatorApplicationWindow />)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopIcon({
  icon,
  title,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <CardContainer
      className="transition-all duration-500 w-fit h-fit cursor-pointer"
      onClick={onClick}
    >
      <CardBody className="max-h-28 h-fit bg-white/15 mt-[-80px] hover:bg-white/110 backdrop-blur-xl transition-all duration-500 rounded-2xl p-4 flex flex-col gap-2 justify-start items-center hover:scale-105 active:scale-[1.15] active:bg-white/25 text-white">
        <CardItem className="h-[30px] w-20 flex justify-center items-center ">
          {icon}
        </CardItem>
        <CardItem className="font-medium w-[85px] text-center break-words">
          {title}
        </CardItem>
      </CardBody>
    </CardContainer>
  );
}
