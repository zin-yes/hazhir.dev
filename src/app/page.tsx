"use client";

import { Button } from "@/components/ui/button";
import { Gamepad2, TerminalSquare } from "lucide-react";
import React, { useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { v4 } from "uuid";
import Desktop from "./desktop";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
  CalendarDropdown,
  GameApplicationPane,
  TerminalApplicationPane,
} from "./application-windows";

export default function OperatingSystemPage() {
  const [panes, setPanes] = useState<React.ReactNode[]>([
    // <MockCalculatorApplicationPane key={0} />,
    // <TerminalApplicationPane key={1} />,
    // <MockSettingsApplicationPane key={2} />,
    // <MockFileExplorerApplicationPane key={3} />,
    // <GameApplicationPane key={4} />,
  ]);

  const addPane = (pane: React.ReactNode) => {
    setPanes([...panes, pane]);
  };

  const [time, setTime] = useState<string>(new Date().toLocaleTimeString());

  useEffect(() => {
    setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);
  }, []);

  const session = useSession();

  return (
    <>
      {/* <ContextMenu>
         <ContextMenuTrigger> */}
      <main className="w-[100vw] h-[100vh] absolute top-0 bottom-0 left-0 right-0 overflow-hidden">
        <Desktop addPane={addPane} />
        <div
          className={
            "absolute top-0 left-0 right-0 z-[1] flex flex-row justify-between m-2 p-1 text-white rounded-xl shadow-md bg-primary"
          }
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={"ghost"}
                className="h-7 rounded-[10px] px-4 text-base bg-black/20 hover:bg-white hover:text-primary"
                disabled
              >
                Activites
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="ml-2 mt-2 w-80 p-1 rounded-xl bg-background/40 backdrop-blur-xl flex flex-col gap-1 z-[9999]">
              <DropdownMenuItem
                className="rounded-[10px] p-3.5 py-2 text-base"
                onClick={() => {
                  addPane(
                    <TerminalApplicationPane
                      identifier={v4()}
                      key={panes.length + 1}
                    />
                  );
                }}
              >
                Start new terminal window
                <DropdownMenuShortcut>
                  <TerminalSquare size={18} />
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-[10px] p-3.5 py-2 text-base"
                onClick={() => {
                  addPane(<GameApplicationPane key={panes.length + 1} />);
                }}
              >
                Start new voxel game window
                <DropdownMenuShortcut>
                  <Gamepad2 size={18} />
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              {/* <DropdownMenuItem
                className="rounded-[10px] p-3.5 py-2 text-base"
                onClick={() => {
                  addPane(
                    <ApplicationWindow
                      action_bar={{
                        title: "Loading",
                      }}
                      settings={{
                        min_width: 300,
                        min_height: 440,
                        starting_width: 350,
                        starting_height: 460,
                        allow_overflow: false,
                      }}
                      key={panes.length + 1}
                    >
                      <LoadingWindow />
                    </ApplicationWindow>
                  );
                }}
              >
                Start new loading window
                <DropdownMenuShortcut>
                  <AppWindow size={18} />
                </DropdownMenuShortcut>
              </DropdownMenuItem> */}
            </DropdownMenuContent>
          </DropdownMenu>
          <CalendarDropdown time={time} />
          <div className="h-fit flex flex-row gap-2">
            <Button
              variant={"ghost"}
              className="h-7 rounded-[10px] px-4 text-base bg-black/20 hover:bg-white hover:text-primary"
              disabled
            >
              Settings
            </Button>
            {session.data?.user.image && (
              <div>
                <Image
                  width={28}
                  height={28}
                  src={session.data?.user.image}
                  alt={"Profile picture."}
                  className="rounded-full m-0 p-0"
                />
              </div>
            )}
          </div>
        </div>

        <div className="w-[100vw] h-[100vh]" id="operating-system-container">
          {panes.map((item, index) => {
            return <React.Fragment key={index}>{item}</React.Fragment>;
          })}
        </div>
      </main>
      {/* </ContextMenuTrigger>
      <ContextMenuContent className="z-[10000] rounded-xl bg-background/40 backdrop-blur-xl">
        <ContextMenuItem
          className="rounded-[10px] p-3.5 py-2 text-base"
          onClick={() => {
            addPane(
              <TerminalApplicationPane
                identifier={v4()}
                key={panes.length + 1}
              />
            );
          }}
        >
          Open new terminal instance
        </ContextMenuItem>
        <ContextMenuItem
          className="rounded-[10px] p-3.5 py-2 text-base"
          onClick={() => {
            addPane(<GameApplicationPane key={panes.length + 1} />);
          }}
        >
          Open new voxel game instance
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu> */}
    </>
  );
}
