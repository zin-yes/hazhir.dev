"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";

import {
  Calculator,
  FolderClosed,
  Gamepad2,
  Settings,
  TerminalSquare,
} from "lucide-react";

import ApplicationWindow from "@/operating-system/application/window";

import LoadingWindow from "@/operating-system/application/window/loading";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";

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

export function CalendarDropdown({ time }: { time: string }) {
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

export function MockCalculatorApplicationPane() {
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

export function MockSettingsApplicationPane() {
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

export function MockFileExplorerApplicationPane() {
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

export function TerminalApplicationPane({
  identifier,
}: {
  identifier: string;
}) {
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
        min_height: Math.min(290, window.innerHeight - 40),
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

export function GameApplicationPane() {
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
