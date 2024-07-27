"use client";

const MockCalculatorApplication = dynamic(
  () => import("@/mock-applications/calculator"),
  { loading: () => <LoadingWindow />, ssr: false }
);

const MockSettingsApplication = dynamic(
  () => import("@/mock-applications/settings"),
  { loading: () => <LoadingWindow />, ssr: false }
);

const TerminalApplication = dynamic(() => import("@/applications/terminal"), {
  loading: () => <LoadingWindow />,
  ssr: false,
});

const GameApplication = dynamic(() => import("@/applications/game"), {
  loading: () => <LoadingWindow />,
  ssr: false,
});

const MockFileExplorerApplication = dynamic(
  () => import("@/mock-applications/file-explorer"),
  { loading: () => <LoadingWindow />, ssr: false }
);

import ApplicationWindow from "@/operating-system/application/window";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuItem,
  ContextMenuContent,
} from "@/components/ui/context-menu";
import {
  AppWindow,
  Calculator,
  FolderClosed,
  Gamepad2,
  Settings,
  TerminalSquare,
} from "lucide-react";
import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";

import LoadingWindow from "@/operating-system/application/window/loading";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { BackgroundGradientAnimation } from "@/components/ui/background-gradient-animation";
import { Calendar } from "@/components/ui/calendar";
import { v4 } from "uuid";
import UseOperatingSystem from "@/hooks/use-operating-system";
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

  return (
    <>
      {/* <ContextMenu>
         <ContextMenuTrigger> */}
      <main className="w-[100vw] h-[100vh] absolute top-0 bottom-0 left-0 right-0 overflow-hidden">
        <div
          className={
            "absolute top-0 left-0 right-0 z-[1] flex flex-row justify-between m-2 p-1 text-white rounded-xl shadow-md bg-primary"
          }
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={"ghost"}
                className="h-7 rounded-[10px] px-4 text-base hover:bg-white hover:text-primary"
              >
                Applications
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
          <Button
            variant={"ghost"}
            className="h-7 rounded-[10px] px-4 text-base bg-black/20 hover:bg-white hover:text-primary"
            disabled
          >
            Settings
          </Button>
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

function CalendarDropdown({ time }: { time: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={"ghost"}
          className="h-7 rounded-[10px] px-4 text-base hover:bg-white hover:text-primary"
          suppressHydrationWarning
        >
          {time}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="ml-2 mt-2 w-fit p-1 rounded-xl shadow-md flex flex-col gap-1 transition-all duration-500 bg-background/40 backdrop-blur-xl z-[9999]">
        <Calendar
          mode="default"
          className="rounded-[8px] text-base transition-all duration-500"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MockCalculatorApplicationPane() {
  return (
    <ApplicationWindow
      action_bar={{
        title: "Calculator",
        icon: {
          svg: <Calculator />,
        },
      }}
      settings={{
        min_width: 300,
        min_height: 440,
        starting_width: 350,
        starting_height: 460,
        allow_overflow: false,
      }}
    >
      <MockCalculatorApplication />
    </ApplicationWindow>
  );
}

function MockSettingsApplicationPane() {
  return (
    <ApplicationWindow
      action_bar={{
        title: "Settings",
        icon: {
          svg: <Settings />,
        },
      }}
      settings={{
        min_width: 700,
        min_height: 460,
        starting_width: 700,
        starting_height: 450,
        allow_overflow: false,
      }}
    >
      <MockSettingsApplication />
    </ApplicationWindow>
  );
}

function MockFileExplorerApplicationPane() {
  return (
    <ApplicationWindow
      action_bar={{
        title: "File Explorer",
        icon: {
          svg: <FolderClosed />,
        },
      }}
      settings={{
        min_width: 700,
        min_height: 460,
        starting_width: 700,
        starting_height: 450,
        allow_overflow: false,
      }}
    >
      <MockFileExplorerApplication />
    </ApplicationWindow>
  );
}

function TerminalApplicationPane({ identifier }: { identifier: string }) {
  return (
    <ApplicationWindow
      action_bar={{
        title: "Terminal",
        icon: {
          svg: <TerminalSquare />,
        },
      }}
      type={"TERMINAL"}
      settings={{
        min_width: Math.min(400, window.innerWidth - 40),
        min_height: Math.min(300, window.innerHeight - 40),
        starting_width: Math.min(940, window.innerWidth - 40),
        starting_height: Math.min(485, window.innerHeight - 40),
        allow_overflow: false,
      }}
      identifier={identifier}
    >
      <TerminalApplication windowIdentifier={identifier} />
    </ApplicationWindow>
  );
}

function GameApplicationPane() {
  return (
    <ApplicationWindow
      action_bar={{
        title: "Voxel Game",
        icon: {
          svg: <Gamepad2 />,
        },
      }}
      type={"VOXEL_GAME"}
      settings={{
        min_width: Math.min(400, window.innerWidth - 40),
        min_height: Math.min(300, window.innerHeight - 40),
        starting_width: Math.min(940, window.innerWidth - 40),
        starting_height: Math.min(485, window.innerHeight - 40),
        allow_overflow: false,
      }}
    >
      <GameApplication />
    </ApplicationWindow>
  );
}
