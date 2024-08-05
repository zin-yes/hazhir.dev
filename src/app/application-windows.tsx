"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";

import {
  Calculator,
  EditIcon,
  FolderClosed,
  Gamepad2,
  Settings,
  TerminalSquare,
} from "lucide-react";

import ApplicationWindow from "@/operating-system/application/window";

import LoadingWindow from "@/operating-system/application/window/loading";
import dynamic from "next/dynamic";
import { OperatingSystemFile } from "@/hooks/use-operating-system";
import { ReactNode } from "react";
import { v4 } from "uuid";

const CalculatorApplication = dynamic(
  () => import("@/applications/calculator"),
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

const FileExplorerApplication = dynamic(
  () => import("@/applications/file-explorer"),
  { loading: () => <LoadingWindow />, ssr: false }
);

const TextEditorApplication = dynamic(
  () => import("@/applications/text-editor"),
  {
    ssr: false,
  }
);

export function TextEditorApplicationWindow({
  file,
}: {
  file: OperatingSystemFile;
}) {
  const identifier = v4();
  return (
    <ApplicationWindow
      action_bar={{
        title: "Text Editor",
        icon: {
          svg: <EditIcon />,
        },
      }}
      identifier={identifier}
      type={"TEXT_EDITOR"}
      settings={{
        min_width: Math.min(400, window.innerWidth - 40),
        min_height: Math.min(300, window.innerHeight - 40),
        starting_width: Math.min(940, window.innerWidth - 40),
        starting_height: Math.min(485, window.innerHeight - 40),
        allow_overflow: false,
      }}
    >
      <TextEditorApplication file={file} identifier={identifier} />
    </ApplicationWindow>
  );
}

export function CalculatorApplicationWindow() {
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
      <CalculatorApplication />
    </ApplicationWindow>
  );
}

export function MockSettingsApplicationWindow() {
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

export function FileExplorerApplicationWindow({
  addWindow,
}: {
  addWindow: (node: ReactNode) => void;
}) {
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
      <FileExplorerApplication />
    </ApplicationWindow>
  );
}

export function TerminalApplicationWindow({
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

export function GameApplicationWindow() {
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
