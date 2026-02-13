"use client";

import {
  BookText,
  Calculator,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  FolderClosed,
  Gamepad2,
  SquareTerminal,
} from "lucide-react";

import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useFileSystem, type FileSystemNode } from "@/hooks/use-file-system";
import { cn } from "@/lib/utils";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 } from "uuid";
import {
  CalculatorApplicationWindow,
  FileExplorerApplicationWindow,
  GameApplicationWindow,
  SingleDocumentApplicationWindow,
  TerminalApplicationWindow,
  TextEditorApplicationWindow,
  VisualNovelApplicationWindow,
} from "./application-windows";

type DesktopItem = {
  id: string;
  title: string;
  icon: ReactNode;
  kind: "app" | "file" | "folder";
  onOpen?: (() => void) | null;
  fileNode?: FileSystemNode;
};

export default function Desktop({
  addWindow,
}: {
  addWindow: (node: ReactNode) => void;
}) {
  const fs = useFileSystem();
  const fsRef = useRef(fs);
  const desktopRootPath = "/home/user/Desktop";
  const containerRef = useRef<HTMLDivElement>(null);
  const iconRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [desktopNodes, setDesktopNodes] = useState<FileSystemNode[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const isSelectingRef = useRef(false);
  const selectionOriginRef = useRef<{ x: number; y: number } | null>(null);
  const selectionBaseRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fsRef.current = fs;
  }, [fs]);

  const loadDesktopNodes = useCallback(() => {
    setDesktopNodes(fsRef.current.getChildren(desktopRootPath));
  }, [desktopRootPath]);

  useEffect(() => {
    loadDesktopNodes();
    window.addEventListener("storage", loadDesktopNodes);
    return () => window.removeEventListener("storage", loadDesktopNodes);
  }, [loadDesktopNodes]);

  const getFileIcon = useCallback((node: FileSystemNode) => {
    if (node.type === "directory") {
      return <FolderClosed size={30} className="text-blue-200" />;
    }

    const ext = node.name.split(".").pop()?.toLowerCase();
    const iconConfig: { icon: typeof File; color: string } = (() => {
      switch (ext) {
        case "txt":
        case "md":
        case "pdf":
          return { icon: FileText, color: "text-slate-200" };
        case "js":
        case "ts":
        case "jsx":
        case "tsx":
        case "json":
        case "css":
        case "html":
        case "yml":
        case "yaml":
        case "xml":
        case "toml":
          return { icon: FileCode, color: "text-emerald-200" };
        case "png":
        case "jpg":
        case "jpeg":
        case "gif":
        case "svg":
        case "webp":
          return { icon: FileImage, color: "text-pink-200" };
        case "mp3":
        case "wav":
        case "flac":
        case "ogg":
        case "m4a":
          return { icon: FileAudio, color: "text-violet-200" };
        case "mp4":
        case "mkv":
        case "avi":
        case "mov":
        case "webm":
          return { icon: FileVideo, color: "text-rose-200" };
        default:
          return { icon: File, color: "text-slate-200" };
      }
    })();

    const IconComponent = iconConfig.icon;
    return <IconComponent size={30} className={iconConfig.color} />;
  }, []);

  const getFileOpenAction = useCallback(
    (node: FileSystemNode) => {
      if (node.type !== "file") return null;
      const ext = node.name.split(".").pop()?.toLowerCase();
      const textExtensions = new Set([
        "txt",
        "md",
        "js",
        "ts",
        "jsx",
        "tsx",
        "json",
        "css",
        "html",
        "yml",
        "yaml",
        "xml",
        "toml",
      ]);
      if (textExtensions.has(ext || "")) {
        return () => addWindow(<TextEditorApplicationWindow filePath={node.path} />);
      }
      if (ext === "pdf") {
        return () =>
          addWindow(
            <SingleDocumentApplicationWindow articleId={node.name} title={node.name} />
          );
      }
      return null;
    },
    [addWindow]
  );

  const desktopItems = useMemo<DesktopItem[]>(() => {
    const shortcuts = [
      {
        id: "app-terminal",
        title: "Terminal",
        icon: <SquareTerminal size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<TerminalApplicationWindow identifier={v4()} />),
      },
      {
        id: "app-voxel-game",
        title: "Voxel Game",
        icon: <Gamepad2 size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<GameApplicationWindow />),
      },
      {
        id: "app-visual-novel",
        title: "Visual Novel",
        icon: <BookText size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<VisualNovelApplicationWindow />),
      },
      {
        id: "app-file-explorer",
        title: "File Explorer",
        icon: <FolderClosed size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<FileExplorerApplicationWindow addWindow={addWindow} />),
      },
      {
        id: "app-calculator",
        title: "Calculator",
        icon: <Calculator size={30} />,
        kind: "app" as const,
        onOpen: () => addWindow(<CalculatorApplicationWindow />),
      },
      {
        id: "file-cv",
        title: "CV.pdf",
        icon: <FileText size={30} />,
        kind: "file" as const,
        onOpen: () =>
          addWindow(
            <SingleDocumentApplicationWindow articleId="CV.pdf" title="CV.pdf" />
          ),
      },
    ];

    const nodes = desktopNodes.map((node) => {
      const openAction =
        node.type === "directory"
          ? () => addWindow(<FileExplorerApplicationWindow addWindow={addWindow} />)
          : getFileOpenAction(node);

      return {
        id: node.path,
        title: node.name,
        icon: getFileIcon(node),
        kind: node.type === "directory" ? ("folder" as const) : ("file" as const),
        fileNode: node,
        onOpen: openAction,
      };
    });

    return [...shortcuts, ...nodes];
  }, [addWindow, desktopNodes, getFileIcon, getFileOpenAction]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const updateSelection = useCallback((nextSelection: Set<string>) => {
    setSelectedIds(Array.from(nextSelection));
  }, []);

  const selectRange = useCallback(
    (fromId: string, toId: string) => {
      const fromIndex = desktopItems.findIndex((item) => item.id === fromId);
      const toIndex = desktopItems.findIndex((item) => item.id === toId);
      if (fromIndex === -1 || toIndex === -1) return;
      const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const next = new Set<string>();
      for (let i = start; i <= end; i += 1) {
        next.add(desktopItems[i].id);
      }
      updateSelection(next);
    },
    [desktopItems, updateSelection]
  );

  const handleIconMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, id: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();

      if (event.shiftKey && lastSelectedId) {
        selectRange(lastSelectedId, id);
        setLastSelectedId(id);
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const next = new Set(selectedSet);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        updateSelection(next);
        setLastSelectedId(id);
        return;
      }

      updateSelection(new Set([id]));
      setLastSelectedId(id);
    },
    [lastSelectedId, selectRange, selectedSet, updateSelection]
  );

  const handleIconContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, id: string) => {
      event.stopPropagation();
      if (!selectedSet.has(id)) {
        updateSelection(new Set([id]));
        setLastSelectedId(id);
      }
    },
    [selectedSet, updateSelection]
  );

  const startMarquee = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-desktop-icon='true']")) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const origin = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      selectionOriginRef.current = origin;
      isSelectingRef.current = true;
      selectionBaseRef.current = event.ctrlKey || event.metaKey ? new Set(selectedSet) : new Set();
      setMarquee({ x: origin.x, y: origin.y, width: 0, height: 0 });
      if (!event.ctrlKey && !event.metaKey) {
        updateSelection(new Set());
      }
    },
    [selectedSet, updateSelection]
  );

  const endSelection = useCallback(() => {
    if (!isSelectingRef.current) return;
    isSelectingRef.current = false;
    selectionOriginRef.current = null;
    selectionBaseRef.current = new Set();
    setMarquee(null);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isSelectingRef.current || !selectionOriginRef.current) return;
      if (event.buttons === 0) {
        endSelection();
        return;
      }

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const origin = selectionOriginRef.current;
      const x = Math.min(origin.x, current.x);
      const y = Math.min(origin.y, current.y);
      const width = Math.abs(origin.x - current.x);
      const height = Math.abs(origin.y - current.y);
      setMarquee({ x, y, width, height });

      const selectionRect = { left: x, top: y, right: x + width, bottom: y + height };
      const nextSelection = new Set(selectionBaseRef.current);
      desktopItems.forEach((item) => {
        const element = iconRefs.current.get(item.id);
        if (!element) return;
        const hitTarget = element.querySelector(
          "[data-desktop-hit='true']"
        ) as HTMLElement | null;
        const iconRect = (hitTarget ?? element).getBoundingClientRect();
        const relative = {
          left: iconRect.left - rect.left,
          top: iconRect.top - rect.top,
          right: iconRect.right - rect.left,
          bottom: iconRect.bottom - rect.top,
        };
        const intersects =
          selectionRect.left <= relative.right &&
          selectionRect.right >= relative.left &&
          selectionRect.top <= relative.bottom &&
          selectionRect.bottom >= relative.top;
        if (intersects) {
          nextSelection.add(item.id);
        }
      });

      updateSelection(nextSelection);
    };

    const handleMouseUp = () => {
      endSelection();
    };

    const handleBlur = () => {
      endSelection();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [desktopItems, endSelection, updateSelection]);

  const handleDesktopContextMenu = useCallback(() => {
    return;
  }, []);

  const createUniqueName = useCallback(
    (baseName: string) => {
      if (!fs.exists(`${desktopRootPath}/${baseName}`)) return baseName;
      let counter = 1;
      let candidate = baseName;
      const nameParts = baseName.split(".");
      const hasExtension = nameParts.length > 1;
      const extension = hasExtension ? `.${nameParts.pop()}` : "";
      const prefix = nameParts.join(".");
      while (fs.exists(`${desktopRootPath}/${candidate}`)) {
        candidate = `${prefix} (${counter})${extension}`;
        counter += 1;
      }
      return candidate;
    },
    [desktopRootPath, fs]
  );

  const handleCreateFolder = useCallback(() => {
    const name = window.prompt("Folder name", "New Folder");
    if (!name) return;
    const unique = createUniqueName(name);
    fs.createDirectory(desktopRootPath, unique);
  }, [createUniqueName, desktopRootPath, fs]);

  const handleCreateTextFile = useCallback(() => {
    const name = window.prompt("File name", "New Text Document.txt");
    if (!name) return;
    const unique = createUniqueName(name);
    fs.createFile(desktopRootPath, unique, "");
  }, [createUniqueName, desktopRootPath, fs]);

  const handleDeleteSelected = useCallback(() => {
    const targets = desktopItems.filter((item) => selectedSet.has(item.id));
    targets.forEach((item) => {
      if (item.fileNode?.path) {
        fs.deleteNode(item.fileNode.path);
      }
    });
    updateSelection(new Set());
  }, [desktopItems, fs, selectedSet, updateSelection]);

  const handleRename = useCallback(
    (itemId: string) => {
      const item = desktopItems.find((entry) => entry.id === itemId);
      if (!item?.fileNode) return;
      const name = window.prompt("Rename", item.fileNode.name);
      if (!name) return;
      fs.rename(item.fileNode.path, name);
    },
    [desktopItems, fs]
  );

  const moveSelectionByOffset = useCallback(
    (offset: number, extendRange: boolean) => {
      if (desktopItems.length === 0) return;

      const currentId =
        (lastSelectedId && selectedSet.has(lastSelectedId)
          ? lastSelectedId
          : selectedIds[0]) ?? null;

      let currentIndex = currentId
        ? desktopItems.findIndex((item) => item.id === currentId)
        : -1;

      if (currentIndex === -1) {
        currentIndex = offset > 0 ? -1 : desktopItems.length;
      }

      const nextIndex = Math.max(
        0,
        Math.min(desktopItems.length - 1, currentIndex + offset)
      );
      const nextId = desktopItems[nextIndex]?.id;
      if (!nextId) return;

      if (extendRange && lastSelectedId) {
        selectRange(lastSelectedId, nextId);
      } else {
        updateSelection(new Set([nextId]));
      }

      setLastSelectedId(nextId);
      iconRefs.current
        .get(nextId)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    },
    [desktopItems, lastSelectedId, selectRange, selectedIds, selectedSet, updateSelection]
  );

  const handleOpenSelected = useCallback(() => {
    const activeId =
      (lastSelectedId && selectedSet.has(lastSelectedId)
        ? lastSelectedId
        : selectedIds[0]) ?? null;
    if (!activeId) return;
    desktopItems.find((item) => item.id === activeId)?.onOpen?.();
  }, [desktopItems, lastSelectedId, selectedIds, selectedSet]);

  const handleDesktopKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        const isEditable =
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          target.isContentEditable ||
          Boolean(target.closest(".monaco-editor"));
        if (isEditable) return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelectionByOffset(-1, event.shiftKey);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelectionByOffset(1, event.shiftKey);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        handleOpenSelected();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0) {
        event.preventDefault();
        handleDeleteSelected();
      }
    },
    [handleDeleteSelected, handleOpenSelected, moveSelectionByOffset, selectedIds.length]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          tabIndex={0}
          className="w-screen h-screen absolute top-0 bottom-0 left-0 right-0 overflow-hidden z-0 select-none"
          onMouseDownCapture={() => {
            containerRef.current?.focus();
          }}
          onMouseDown={startMarquee}
          onKeyDown={handleDesktopKeyDown}
          onContextMenu={handleDesktopContextMenu}
        >
          <div className="h-[calc(100vh-52px)] w-full bottom-0 left-0 right-0 absolute p-4">
            <div className="w-full flex flex-row flex-wrap gap-4 items-start">
              {desktopItems.map((item) => (
                <ContextMenu key={item.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      data-desktop-icon="true"
                      ref={(node) => {
                        if (node) {
                          iconRefs.current.set(item.id, node);
                        } else {
                          iconRefs.current.delete(item.id);
                        }
                      }}
                      onMouseDown={(event) => handleIconMouseDown(event, item.id)}
                      onDoubleClick={() => item.onOpen?.()}
                      onContextMenu={(event) => handleIconContextMenu(event, item.id)}
                    >
                      <DesktopIcon
                        icon={item.icon}
                        title={item.title}
                        selected={selectedSet.has(item.id)}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52">
                    <ContextMenuItem
                      onClick={() => item.onOpen?.()}
                      disabled={!item.onOpen}
                    >
                      Open
                    </ContextMenuItem>
                    {item.kind === "file" && item.fileNode && (
                      <>
                        {(() => {
                          const ext = item.fileNode!.name.split(".").pop()?.toLowerCase();
                          const textExtensions = new Set([
                            "txt",
                            "md",
                            "js",
                            "ts",
                            "jsx",
                            "tsx",
                            "json",
                            "css",
                            "html",
                            "yml",
                            "yaml",
                            "xml",
                            "toml",
                          ]);
                          return textExtensions.has(ext || "");
                        })() ? (
                          <ContextMenuItem
                            onClick={() =>
                              addWindow(
                                <TextEditorApplicationWindow
                                  filePath={item.fileNode!.path}
                                />
                              )
                            }
                          >
                            Open in Text Editor
                          </ContextMenuItem>
                        ) : null}
                        {item.fileNode.name.toLowerCase().endsWith(".pdf") ? (
                          <ContextMenuItem
                            onClick={() =>
                              addWindow(
                                <SingleDocumentApplicationWindow
                                  articleId={item.fileNode!.name}
                                  title={item.fileNode!.name}
                                />
                              )
                            }
                          >
                            Open in Document Viewer
                          </ContextMenuItem>
                        ) : null}
                      </>
                    )}
                    {item.kind === "folder" && (
                      <ContextMenuItem onClick={() => item.onOpen?.()}>
                        Open in File Explorer
                      </ContextMenuItem>
                    )}
                    {item.fileNode ? (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => handleRename(item.id)}>
                          Rename
                        </ContextMenuItem>
                        <ContextMenuItem onClick={handleDeleteSelected}>
                          Delete
                        </ContextMenuItem>
                      </>
                    ) : null}
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          </div>
          {marquee ? (
            <div
              className="absolute border border-white/60 bg-white/15 pointer-events-none rounded-sm"
              style={{
                left: `${marquee.x}px`,
                top: `${marquee.y}px`,
                width: `${marquee.width}px`,
                height: `${marquee.height}px`,
              }}
            />
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={handleCreateFolder}>New Folder</ContextMenuItem>
        <ContextMenuItem onClick={handleCreateTextFile}>
          New Text Document
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={loadDesktopNodes}>Refresh</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DesktopIcon({
  icon,
  title,
  selected = false,
}: {
  icon: ReactNode;
  title: string;
  selected?: boolean;
}) {
  return (
    <CardContainer
      className="transition-all duration-500 w-fit h-fit cursor-pointer"
    >
      <CardBody
        data-desktop-hit="true"
        className={cn(
          "max-h-28 h-fit bg-white/15 mt-[-80px] hover:bg-white/110 backdrop-blur-xl transition-all duration-500 rounded-2xl p-4 flex flex-col gap-2 justify-start items-center hover:scale-105 active:scale-[1.15] active:bg-white/25 text-white",
          selected && "bg-white/30 ring-2 ring-white/70"
        )}
      >
        <CardItem className="h-[30px] w-20 flex justify-center items-center ">
          {icon}
        </CardItem>
        <CardItem className="font-medium w-[85px] text-center wrap-break-word">
          {title}
        </CardItem>
      </CardBody>
    </CardContainer>
  );
}
