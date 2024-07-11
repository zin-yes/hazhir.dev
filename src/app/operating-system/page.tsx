"use client";

const MockCalculatorApplication = dynamic(
  () => import("@/components/mock-applications/calculator"),
  { ssr: false }
);
const MockSettingsApplication = dynamic(
  () => import("@/components/mock-applications/settings"),
  { ssr: false }
);
const TerminalApplication = dynamic(
  () => import("@/components/applications/terminal"),
  { ssr: false }
);
const MockFileExplorerApplication = dynamic(
  () => import("@/components/mock-applications/file-explorer"),
  { ssr: false }
);

import Pane from "@/components/pane";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuItem,
  ContextMenuContent,
} from "@/components/ui/context-menu";
import {
  Calculator,
  FolderClosed,
  Settings,
  TerminalSquare,
} from "lucide-react";
import dynamic from "next/dynamic";
import React, { useState } from "react";

export default function OperatingSystemPage() {
  const [panes, setPanes] = useState<React.ReactNode[]>([
    // <MockCalculatorApplicationPane key={0} />,
    <TerminalApplicationPane key={1} />,
    // <MockSettingsApplicationPane key={2} />,
    // <MockFileExplorerApplicationPane key={3} />,
  ]);

  const addPane = (pane: React.ReactNode) => {
    let _panes = panes;
    _panes.push(pane);
    setPanes(_panes);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <main className="w-[100vw] h-[100vh]" id="operating-system-container">
            {panes.map((item, index) => {
              return <React.Fragment key={index}>{item}</React.Fragment>;
            })}
          </main>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={() => {
              addPane(<TerminalApplicationPane key={panes.length + 1} />);
            }}
          >
            Placeholder option #1
          </ContextMenuItem>
          <ContextMenuItem>Placeholder option #2</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}

function MockCalculatorApplicationPane() {
  return (
    <Pane
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
    </Pane>
  );
}

function MockSettingsApplicationPane() {
  return (
    <Pane
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
    </Pane>
  );
}

function MockFileExplorerApplicationPane() {
  return (
    <Pane
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
    </Pane>
  );
}

function TerminalApplicationPane() {
  return (
    <Pane
      action_bar={{
        title: "Terminal",
        icon: {
          svg: <TerminalSquare />,
        },
      }}
      settings={{
        min_width: 400,
        min_height: 300,
        starting_width: 917,
        starting_height: 485,
        allow_overflow: false,
      }}
    >
      <TerminalApplication />
    </Pane>
  );
}
