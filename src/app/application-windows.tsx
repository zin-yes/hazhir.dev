"use client";

import {
  BookOpen,
  BookText,
  Calculator,
  EditIcon,
  FileText,
  FolderClosed,
  Gamepad2,
  Heart,
  ImageIcon,
  Settings,
  TerminalSquare,
} from "lucide-react";

import ApplicationWindow from "@/operating-system/application/window";

import { getHomePath } from "@/lib/system-user";
import LoadingWindow from "@/operating-system/application/window/loading";
import dynamic from "next/dynamic";
import { ReactNode, useMemo } from "react";
import { v4 } from "uuid";

const MeditationApplication = dynamic(
  () => import("@/applications/meditation"),
  { loading: () => <LoadingWindow />, ssr: false },
);

const CalculatorApplication = dynamic(
  () => import("@/applications/calculator"),
  { loading: () => <LoadingWindow />, ssr: false },
);

const SettingsApplication = dynamic(() => import("@/applications/settings"), {
  loading: () => <LoadingWindow />,
  ssr: false,
});

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
  { loading: () => <LoadingWindow />, ssr: false },
);

const DocumentViewerApplication = dynamic(
  () => import("@/applications/document-viewer"),
  { loading: () => <LoadingWindow />, ssr: false },
);

const TextEditorApplication = dynamic(
  () => import("@/applications/text-editor"),
  { loading: () => <LoadingWindow />, ssr: false },
);

const VisualNovelApplication = dynamic(
  () => import("@/applications/visual-novel"),
  { loading: () => <LoadingWindow />, ssr: false },
);

const ImageViewerApplication = dynamic(
  () => import("@/applications/image-viewer"),
  { loading: () => <LoadingWindow />, ssr: false },
);

const FilePropertiesApplication = dynamic(
  () => import("@/applications/file-properties"),
  { loading: () => <LoadingWindow />, ssr: false },
);

export function TextEditorApplicationWindow({
  filePath,
}: {
  filePath?: string;
}) {
  const identifier = useMemo(() => v4(), []);
  const fileName = filePath?.split("/").pop() || "Text Editor";
  return (
    <ApplicationWindow
      action_bar={{
        title: `Text Editor - ${fileName}`,
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
      <TextEditorApplication filePath={filePath} identifier={identifier} />
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

export function SettingsApplicationWindow({
  initialTab,
}: {
  initialTab?: string;
}) {
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
      <SettingsApplication initialTab={initialTab} />
    </ApplicationWindow>
  );
}

export function FileExplorerApplicationWindow({
  addWindow,
  initialPath,
}: {
  addWindow: (node: ReactNode) => void;
  initialPath?: string;
}) {
  return (
    <ApplicationWindow
      action_bar={{
        title: "Files",
        icon: {
          svg: <FolderClosed />,
        },
      }}
      settings={{
        min_width: 800,
        min_height: 500,
        starting_width: Math.min(950, window.innerWidth - 40),
        starting_height: Math.min(600, window.innerHeight - 40),
        allow_overflow: false,
      }}
    >
      <FileExplorerApplication initialPath={initialPath} />
    </ApplicationWindow>
  );
}

export function DocumentViewerApplicationWindow({
  filePath,
  articleId,
}: {
  filePath?: string;
  articleId?: string;
}) {
  const resolvedFilePath = filePath ?? articleId;
  const homePath = getHomePath();
  const displayPath = resolvedFilePath
    ? resolvedFilePath.replace(homePath, "~")
    : "~/Documents";
  return (
    <ApplicationWindow
      action_bar={{
        title: `Document Viewer - ${displayPath}`,
        icon: {
          svg: <BookOpen />,
        },
      }}
      type="DOCUMENT_VIEWER"
      settings={{
        min_width: 640,
        min_height: 420,
        starting_width: Math.min(980, window.innerWidth - 40),
        starting_height: Math.min(620, window.innerHeight - 40),
        allow_overflow: true,
      }}
    >
      <DocumentViewerApplication filePath={resolvedFilePath} />
    </ApplicationWindow>
  );
}

export function SingleDocumentApplicationWindow({
  filePath,
  title,
  articleId,
}: {
  filePath?: string;
  title: string;
  articleId?: string;
}) {
  const resolvedFilePath = filePath ?? articleId;
  const homePath = getHomePath();
  const displayPath = resolvedFilePath
    ? resolvedFilePath.replace(homePath, "~")
    : title;
  return (
    <ApplicationWindow
      action_bar={{
        title: `Document Viewer - ${displayPath}`,
        icon: {
          svg: <BookOpen />,
        },
      }}
      type="DOCUMENT_VIEWER"
      settings={{
        min_width: 600,
        min_height: 420,
        starting_width: Math.min(820, window.innerWidth - 40),
        starting_height: Math.min(620, window.innerHeight - 40),
        allow_overflow: true,
      }}
    >
      <DocumentViewerApplication filePath={resolvedFilePath} mode="single" />
    </ApplicationWindow>
  );
}

export function ImageViewerApplicationWindow({
  filePath,
}: {
  filePath?: string;
}) {
  const homePath = getHomePath();
  const displayPath = filePath ? filePath.replace(homePath, "~") : "~/Images";
  return (
    <ApplicationWindow
      action_bar={{
        title: `Image Viewer - ${displayPath}`,
        icon: {
          svg: <ImageIcon />,
        },
      }}
      type="IMAGE_VIEWER"
      settings={{
        min_width: 720,
        min_height: 460,
        starting_width: Math.min(1000, window.innerWidth - 40),
        starting_height: Math.min(680, window.innerHeight - 40),
        allow_overflow: true,
      }}
    >
      <ImageViewerApplication initialFilePath={filePath} />
    </ApplicationWindow>
  );
}

export function FilePropertiesApplicationWindow({
  filePath,
}: {
  filePath?: string;
}) {
  const homePath = getHomePath();
  const displayPath = filePath ? filePath.replace(homePath, "~") : "No item";
  return (
    <ApplicationWindow
      action_bar={{
        title: `Properties - ${displayPath}`,
        icon: {
          svg: <FileText />,
        },
      }}
      type="FILE_PROPERTIES"
      settings={{
        min_width: 300,
        min_height: 500,
        starting_width: Math.min(300, window.innerWidth - 40),
        starting_height: Math.min(500, window.innerHeight - 40),
        allow_overflow: false,
      }}
    >
      <FilePropertiesApplication filePath={filePath} />
    </ApplicationWindow>
  );
}

export function TerminalApplicationWindow({
  identifier,
  initialPath,
}: {
  identifier: string;
  initialPath?: string;
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
      <TerminalApplication
        windowIdentifier={identifier}
        initialPath={initialPath}
      />
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

export function VisualNovelApplicationWindow() {
  return (
    <ApplicationWindow
      action_bar={{
        title: "Visual Novel",
        icon: {
          svg: <BookText />,
        },
      }}
      type={"VISUAL_NOVEL"}
      settings={{
        min_width: Math.min(800, window.innerWidth - 40),
        min_height: Math.min(600, window.innerHeight - 40),
        starting_width: Math.min(1000, window.innerWidth - 40),
        starting_height: Math.min(700, window.innerHeight - 40),
        allow_overflow: false,
      }}
    >
      <VisualNovelApplication />
    </ApplicationWindow>
  );
}

export function MeditationApplicationWindow() {
  return (
    <ApplicationWindow
      action_bar={{
        title: "Nadi Shuddhi Meditation",
        icon: {
          svg: <Heart />,
        },
      }}
      type={"MEDITATION"}
      settings={{
        min_width: Math.min(400, window.innerWidth - 40),
        min_height: Math.min(500, window.innerHeight - 40),
        starting_width: Math.min(700, window.innerWidth - 40),
        starting_height: Math.min(600, window.innerHeight - 40),
        allow_overflow: true,
      }}
    >
      <MeditationApplication />
    </ApplicationWindow>
  );
}
