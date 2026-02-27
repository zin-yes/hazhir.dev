"use client";

import { Button } from "@/components/ui/button";
import {
  BookOpen,
  BookText,
  Calculator,
  Circle,
  ExternalLink,
  File,
  FileSymlink,
  FolderClosed,
  Gamepad2,
  Heart,
  ImageIcon,
  LogOut,
  Search,
  Settings,
  TerminalSquare,
  User2,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  signInAsGuest,
  signInWithCredentials,
  signInWithGoogle,
  signOut,
  signUpWithCredentials,
  useSession,
} from "@/auth/client";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuthPillar } from "@/hooks/use-auth-pillar";
import { useFileSystem } from "@/hooks/use-file-system";
import { OS_LAUNCH_APPLICATION_EVENT } from "@/lib/application-launcher";
import { executeFilePath } from "@/lib/file-execution";
import {
  FILE_PATH_DROP_EVENT,
  hasFileDragType,
  readDroppedPathsFromDataTransfer,
} from "@/lib/file-transfer-dnd";
import { type ShortcutDefinition, parseShortcut } from "@/lib/shortcut";
import {
  type ClockFormat,
  getClockFormat,
  subscribeSystemPreferenceChanges,
} from "@/lib/system-preferences";
import { getHomePath, setCurrentSystemUsername } from "@/lib/system-user";
import Image from "next/image";
import { v4 } from "uuid";
import {
  CalculatorApplicationWindow,
  DocumentViewerApplicationWindow,
  FileExplorerApplicationWindow,
  FilePropertiesApplicationWindow,
  GameApplicationWindow,
  ImageViewerApplicationWindow,
  MeditationApplicationWindow,
  SettingsApplicationWindow,
  SingleDocumentApplicationWindow,
  TerminalApplicationWindow,
  TextEditorApplicationWindow,
} from "./application-windows";
import Desktop from "./desktop";
import Wallpaper from "./wallpaper";

const OS_WINDOW_CURSOR_CHANGE_EVENT = "os-window-cursor-change";

type MenuShortcutItem = {
  path: string;
  shortcut: ShortcutDefinition;
  label: string;
  description: string;
  iconName: string;
};

type WindowEntry = {
  id: string;
  node: React.ReactNode;
};

function renderShortcutIcon(iconName?: string) {
  switch (iconName) {
    case "TerminalSquare":
      return <TerminalSquare size={16} className="text-white/90" />;
    case "FolderClosed":
      return <FolderClosed size={16} className="text-white/90" />;
    case "Heart":
      return <Heart size={16} className="text-white/90" />;
    case "Gamepad2":
      return <Gamepad2 size={16} className="text-white/90" />;
    case "Calculator":
      return <Calculator size={16} className="text-white/90" />;
    case "BookText":
      return <BookText size={16} className="text-white/90" />;
    case "BookOpen":
      return <BookOpen size={16} className="text-white/90" />;
    case "Settings":
      return <Settings size={16} className="text-white/90" />;
    case "Image":
      return <ImageIcon size={16} className="text-white/90" />;
    case "Info":
      return <Circle size={16} className="text-white/90" />;
    case "FileSymlink":
      return <FileSymlink size={16} className="text-white/90" />;
    default:
      return <File size={16} className="text-white/90" />;
  }
}
export default function OperatingSystemPage() {
  const fs = useFileSystem();
  const fsRef = useRef(fs);
  const [hasMounted, setHasMounted] = useState(false);
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [authError, setAuthError] = useState<string>("");
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [authView, setAuthView] = useState<"sign-in" | "register">("sign-in");
  const [isSystemUserReady, setIsSystemUserReady] = useState(false);
  const [isFileTransferDragActive, setIsFileTransferDragActive] =
    useState(false);
  const [isOverDropZone, setIsOverDropZone] = useState(false);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isDesktopBackgroundBlurred, setIsDesktopBackgroundBlurred] =
    useState(false);
  const fileDragDepthRef = useRef(0);

  const addWindow = useCallback((pane: React.ReactNode, id?: string) => {
    const windowId = id ?? v4();
    setWindows((previous) => [...previous, { id: windowId, node: pane }]);
    return windowId;
  }, []);

  const removeWindow = useCallback((windowId: string) => {
    setWindows((previous) =>
      previous.filter((window) => window.id !== windowId),
    );
  }, []);

  const openSettingsWindow = useCallback(
    (initialTab?: string) => {
      addWindow(<SettingsApplicationWindow initialTab={initialTab} />);
    },
    [addWindow],
  );

  useEffect(() => {
    fsRef.current = fs;
  }, [fs]);

  const [menuSearchValue, setMenuSearchValue] = useState("");
  const [menuItems, setMenuItems] = useState<MenuShortcutItem[]>([]);
  const [menuHoveredDescription, setMenuHoveredDescription] = useState("");

  const loadMenuItems = useCallback(() => {
    const menuPath = `${getHomePath()}/.menu`;
    const children = fsRef.current.getChildren(menuPath, true);

    const nextItems = children
      .filter((node) => node.type === "file" && node.name.endsWith(".shortcut"))
      .map((node) => {
        const parsed = parseShortcut(
          fsRef.current.getFileContents(node.path) ?? "",
        );
        if (!parsed) return null;
        const label =
          parsed.name ??
          parsed.iconDisplayText ??
          node.name.replace(/\.shortcut$/i, "");

        return {
          path: node.path,
          shortcut: parsed,
          label,
          description: parsed.description ?? "",
          iconName: parsed.icon ?? "",
        } satisfies MenuShortcutItem;
      })
      .filter(Boolean) as MenuShortcutItem[];

    nextItems.sort((a, b) => a.label.localeCompare(b.label));
    setMenuItems(nextItems);
  }, []);

  useEffect(() => {
    loadMenuItems();
    window.addEventListener("storage", loadMenuItems);
    return () => window.removeEventListener("storage", loadMenuItems);
  }, [loadMenuItems]);

  const filteredMenuItems = useMemo(() => {
    const query = menuSearchValue.trim().toLowerCase();
    if (!query) return menuItems;
    return menuItems.filter((item) => {
      const haystack = `${item.label} ${item.description}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [menuItems, menuSearchValue]);

  const [clockFormat, setClockFormatState] = useState<ClockFormat>("12h");
  const [time, setTime] = useState<string>(() =>
    new Date().toLocaleTimeString([], { hour12: true }),
  );

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    const syncClockPreferences = () => {
      setClockFormatState(getClockFormat());
    };

    syncClockPreferences();
    return subscribeSystemPreferenceChanges(syncClockPreferences);
  }, []);

  useEffect(() => {
    const updateTime = () => {
      setTime(
        new Date().toLocaleTimeString([], {
          hour12: clockFormat === "12h",
        }),
      );
    };

    updateTime();
    const timer = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(timer);
  }, [clockFormat]);

  const session = useSession();
  const { isSignInModalRequested, dismissSignInModal } = useAuthPillar();
  const showLoginScreen =
    hasMounted &&
    (isSignInModalRequested ||
      (session.status !== "loading" && session.status !== "authenticated"));
  const shouldShowOperatingSystem = !showLoginScreen;
  const [operatingSystemVisible, setOperatingSystemVisible] = useState(false);

  useEffect(() => {
    if (shouldShowOperatingSystem) {
      setOperatingSystemVisible(false);
      const frame = requestAnimationFrame(() => {
        setOperatingSystemVisible(true);
      });
      return () => cancelAnimationFrame(frame);
    }

    setOperatingSystemVisible(false);
  }, [shouldShowOperatingSystem]);

  useEffect(() => {
    if (session.status === "authenticated" && session.data?.user) {
      const user = session.data.user as {
        username?: string;
        name?: string;
        id?: string;
      };
      const username = user.username ?? user.name ?? user.id ?? "guest";
      setCurrentSystemUsername(String(username));
      setIsSystemUserReady(true);
      return;
    }

    if (session.status !== "loading") {
      setIsSystemUserReady(true);
    }
  }, [session]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ appId: string; args?: string[] }>)
        .detail;
      if (!detail?.appId) return;

      switch (detail.appId) {
        case "terminal":
          addWindow(
            <TerminalApplicationWindow
              identifier={v4()}
              initialPath={detail.args?.[0]}
            />,
          );
          break;
        case "file-explorer":
          addWindow(
            <FileExplorerApplicationWindow
              addWindow={addWindow}
              initialPath={detail.args?.[0]}
            />,
          );
          break;
        case "meditation":
          addWindow(<MeditationApplicationWindow />);
          break;
        case "voxel-game":
          addWindow(<GameApplicationWindow />);
          break;
        case "calculator":
          addWindow(<CalculatorApplicationWindow />);
          break;
        case "document-viewer": {
          const requested = detail.args?.[0];
          if (!requested) {
            addWindow(<DocumentViewerApplicationWindow />);
            break;
          }

          const filePath =
            requested === "CV"
              ? `${getHomePath()}/Documents/CV.document`
              : requested;
          const title =
            detail.args?.[1] ?? (filePath.split("/").pop() || "Document");
          addWindow(
            <SingleDocumentApplicationWindow
              filePath={filePath}
              title={title}
            />,
          );
          break;
        }
        case "image-viewer": {
          addWindow(
            <ImageViewerApplicationWindow filePath={detail.args?.[0]} />,
          );
          break;
        }
        case "text-editor": {
          const filePath = detail.args?.[0];
          const windowId = v4();
          addWindow(
            <TextEditorApplicationWindow
              identifier={windowId}
              filePath={filePath}
              onClose={() => removeWindow(windowId)}
            />,
            windowId,
          );
          break;
        }
        case "settings": {
          openSettingsWindow(detail.args?.[0]);
          break;
        }
        case "file-properties": {
          addWindow(
            <FilePropertiesApplicationWindow filePath={detail.args?.[0]} />,
          );
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener(OS_LAUNCH_APPLICATION_EVENT, handler);
    return () =>
      window.removeEventListener(OS_LAUNCH_APPLICATION_EVENT, handler);
  }, [addWindow, openSettingsWindow, removeWindow]);

  useEffect(() => {
    const updateDropZoneState = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y) as HTMLElement | null;
      setIsOverDropZone(
        Boolean(element?.closest("[data-file-drop-zone='true']")),
      );
    };

    const onDragEnter = (event: DragEvent) => {
      if (!hasFileDragType(event.dataTransfer)) return;
      fileDragDepthRef.current += 1;
      setIsFileTransferDragActive(true);
      setDragCursor({ x: event.clientX, y: event.clientY });
      updateDropZoneState(event.clientX, event.clientY);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFileDragType(event.dataTransfer)) return;
      setIsFileTransferDragActive(true);
      setDragCursor({ x: event.clientX, y: event.clientY });
      updateDropZoneState(event.clientX, event.clientY);
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFileDragType(event.dataTransfer)) return;
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) {
        setIsFileTransferDragActive(false);
        setIsOverDropZone(false);
      } else {
        setDragCursor({ x: event.clientX, y: event.clientY });
      }
    };

    const onDrop = (event: DragEvent) => {
      const target = document.elementFromPoint(
        event.clientX,
        event.clientY,
      ) as HTMLElement | null;
      const dropZone = target?.closest(
        "[data-file-drop-zone='true']",
      ) as HTMLElement | null;

      if (dropZone?.dataset.fileDropKind === "terminal") {
        const paths = readDroppedPathsFromDataTransfer(event.dataTransfer);
        if (paths.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          dropZone.dispatchEvent(
            new CustomEvent(FILE_PATH_DROP_EVENT, {
              bubbles: true,
              detail: { paths },
            }),
          );
        }
      }

      fileDragDepthRef.current = 0;
      setIsFileTransferDragActive(false);
      setIsOverDropZone(false);
    };

    const onMouseUp = () => {
      fileDragDepthRef.current = 0;
      setIsFileTransferDragActive(false);
      setIsOverDropZone(false);
    };

    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragend", onDrop, true);
    window.addEventListener("mouseup", onMouseUp, true);

    return () => {
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("dragend", onDrop, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    };
  }, []);

  useEffect(() => {
    const handleWindowCursorChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{ isCursorOnFocusedWindow?: boolean }>
      ).detail;
      setIsDesktopBackgroundBlurred(Boolean(detail?.isCursorOnFocusedWindow));
    };

    window.addEventListener(
      OS_WINDOW_CURSOR_CHANGE_EVENT,
      handleWindowCursorChange,
    );

    return () => {
      window.removeEventListener(
        OS_WINDOW_CURSOR_CHANGE_EVENT,
        handleWindowCursorChange,
      );
    };
  }, []);

  return (
    <>
      {/* <ContextMenu>
         <ContextMenuTrigger> */}
      <main className="w-screen h-screen absolute top-0 bottom-0 left-0 right-0 overflow-hidden">
        <Wallpaper />

        {shouldShowOperatingSystem && isSystemUserReady && (
          <div
            className={`absolute inset-0 transition-all duration-1000 ease-out will-change-transform ${
              operatingSystemVisible
                ? "opacity-100 translate-y-0 blur-0"
                : "opacity-0 -translate-y-[5%] blur-[3px]"
            }`}
          >
            <Desktop addWindow={addWindow} />
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 z-5 transition-all duration-300 ${
                isDesktopBackgroundBlurred
                  ? "backdrop-blur-[1px] bg-black/20"
                  : "backdrop-blur-0 bg-black/0"
              }`}
            />
            <div
              className={
                "absolute top-0 left-0 right-0 z-1 flex flex-row justify-between m-2 p-1 text-white rounded-xl shadow-md bg-primary"
              }
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={"ghost"}
                    size="icon"
                    className="h-7 w-7 rounded-full bg-black/20 hover:bg-white/20"
                    aria-label="Open menu"
                  >
                    <Circle className="size-3.5 fill-white text-white stroke-none" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={8}
                  className="ml-2 mt-1 w-[420px] rounded-2xl border border-white/10 bg-background/85 p-3 backdrop-blur-2xl z-9999"
                >
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 flex items-center gap-2 text-sm text-white/75">
                    <Search size={14} className="opacity-80" />
                    <Input
                      value={menuSearchValue}
                      onChange={(event) =>
                        setMenuSearchValue(event.target.value)
                      }
                      onKeyDown={(event) => event.stopPropagation()}
                      placeholder="Search apps"
                      className="h-6 border-0 bg-transparent p-0 text-sm text-white placeholder:text-white/50 focus-visible:ring-0"
                    />
                  </div>

                  <div className="mt-3 px-1 text-xs font-medium text-white/70">
                    Apps
                  </div>

                  <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/15 p-1">
                    {filteredMenuItems.length > 0 ? (
                      filteredMenuItems.map((item) => (
                        <DropdownMenuItem
                          key={item.path}
                          title={item.description}
                          className="rounded-lg px-2.5 py-2 text-sm text-white data-[highlighted]:bg-white/15"
                          onMouseEnter={() =>
                            setMenuHoveredDescription(item.description)
                          }
                          onClick={() => {
                            const result = executeFilePath(
                              item.path,
                              fsRef.current,
                            );
                            if (!result.ok) {
                              console.warn(result.message);
                            }
                            setMenuSearchValue("");
                          }}
                        >
                          {renderShortcutIcon(item.iconName)}
                          <span className="truncate">{item.label}</span>
                          {item.shortcut.type === "link" ? (
                            <ExternalLink
                              size={14}
                              className="ml-auto text-white/70"
                            />
                          ) : null}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-sm text-white/60">
                        No matching apps.
                      </div>
                    )}
                  </div>

                  <div className="mt-2 rounded-lg border border-white/10 bg-black/10 px-2.5 py-2 text-xs text-white/70 min-h-8">
                    {menuHoveredDescription ||
                      "Hover an item to view its description."}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              <CalendarDropdown time={time} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={"ghost"}
                    size="icon"
                    className="h-7 w-7 rounded-full bg-black/20 hover:bg-white/20"
                    aria-label="Open profile menu"
                  >
                    {session.data?.user.image ? (
                      <Image
                        loader={({ src, width, quality }) =>
                          `${src}?w=${width}&q=${quality || 75}`
                        }
                        width={28}
                        height={28}
                        src={session.data?.user.image}
                        alt={"Profile picture."}
                        className="rounded-full m-0 p-0"
                      />
                    ) : (
                      <User2 className="size-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={8}
                  className="w-52 rounded-xl border border-white/10 bg-background/85 p-1 backdrop-blur-2xl z-9999"
                >
                  <DropdownMenuItem
                    className="rounded-lg px-2.5 py-2 text-sm text-white data-[highlighted]:bg-white/15"
                    onClick={() => openSettingsWindow("system")}
                  >
                    <Settings size={14} className="text-white/80" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem
                    className="rounded-lg px-2.5 py-2 text-sm text-white data-[highlighted]:bg-white/15"
                    onClick={async () => {
                      await signOut({ callbackUrl: "/" });
                    }}
                  >
                    <LogOut size={14} className="text-white/80" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="relative z-10 w-screen h-screen" id="operating-system-container">
              {windows.map((window) => {
                return (
                  <React.Fragment key={window.id}>{window.node}</React.Fragment>
                );
              })}
            </div>

            {isFileTransferDragActive && (
              <div
                className="pointer-events-none fixed z-[2147483647] transition-transform"
                style={{
                  left: dragCursor.x + 10,
                  top: dragCursor.y - 34,
                }}
              >
                <div
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold border ${
                    isOverDropZone
                      ? "bg-emerald-700 border-emerald-200 text-white shadow-lg shadow-emerald-950/50"
                      : "bg-rose-800 border-rose-200 text-white shadow-lg shadow-rose-950/60"
                  }`}
                >
                  <FileSymlink size={12} />
                  <span>{isOverDropZone ? "Drop" : "No drop"}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {showLoginScreen && (
          <div className="absolute inset-0 z-[10000] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl border border-white/15 bg-background/85 p-5 shadow-2xl backdrop-blur-xl">
              <div className="space-y-1 text-center text-white">
                <h1 className="text-2xl font-semibold tracking-wide">
                  hazhir.dev
                </h1>
                <p className="text-sm text-white/70">Welcome to your desktop</p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                <Button
                  type="button"
                  variant={authView === "sign-in" ? "secondary" : "ghost"}
                  className="h-8"
                  disabled={isAuthPending}
                  onClick={() => {
                    setAuthError("");
                    setAuthView("sign-in");
                  }}
                >
                  Sign in
                </Button>
                <Button
                  type="button"
                  variant={authView === "register" ? "secondary" : "ghost"}
                  className="h-8"
                  disabled={isAuthPending}
                  onClick={() => {
                    setAuthError("");
                    setAuthView("register");
                  }}
                >
                  Register
                </Button>
              </div>

              {authView === "sign-in" ? (
                <div className="mt-4 space-y-3">
                  <Button
                    className="w-full"
                    disabled={isAuthPending}
                    onClick={async () => {
                      setAuthError("");
                      setIsAuthPending(true);
                      try {
                        await signInWithGoogle({ callbackUrl: "/" });
                        dismissSignInModal();
                      } catch {
                        setAuthError(
                          "Google sign-in failed. Please try again.",
                        );
                      } finally {
                        setIsAuthPending(false);
                      }
                    }}
                  >
                    Continue with Google
                  </Button>

                  <div className="relative py-1">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
                    <p className="relative mx-auto w-fit bg-background/85 px-2 text-[11px] uppercase tracking-wide text-white/50">
                      or use credentials
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Input
                      type="email"
                      placeholder="Email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={isAuthPending}
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={isAuthPending}
                    />
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={isAuthPending || !email || !password}
                      onClick={async () => {
                        setAuthError("");
                        setIsAuthPending(true);
                        try {
                          const result = await signInWithCredentials({
                            email,
                            password,
                            callbackUrl: "/",
                          });

                          if (result.error) {
                            setAuthError(
                              result.error.message || "Invalid credentials.",
                            );
                          } else {
                            dismissSignInModal();
                          }
                        } catch {
                          setAuthError(
                            "Credentials sign-in failed. Please try again.",
                          );
                        } finally {
                          setIsAuthPending(false);
                        }
                      }}
                    >
                      Sign in
                    </Button>
                  </div>

                  <Button
                    variant="ghost"
                    className="w-full text-white/80 hover:text-white"
                    disabled={isAuthPending}
                    onClick={() => {
                      setAuthError("");
                      signInAsGuest();
                      dismissSignInModal();
                    }}
                  >
                    Continue as Guest
                  </Button>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  <Input
                    type="text"
                    placeholder="Name"
                    value={registerName}
                    onChange={(event) => setRegisterName(event.target.value)}
                    disabled={isAuthPending}
                  />
                  <Input
                    type="email"
                    placeholder="Email"
                    value={registerEmail}
                    onChange={(event) => setRegisterEmail(event.target.value)}
                    disabled={isAuthPending}
                  />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={registerPassword}
                    onChange={(event) =>
                      setRegisterPassword(event.target.value)
                    }
                    disabled={isAuthPending}
                  />
                  <Input
                    type="password"
                    placeholder="Confirm password"
                    value={registerPasswordConfirm}
                    onChange={(event) =>
                      setRegisterPasswordConfirm(event.target.value)
                    }
                    disabled={isAuthPending}
                  />

                  <Button
                    className="w-full"
                    disabled={
                      isAuthPending ||
                      !registerName ||
                      !registerEmail ||
                      !registerPassword ||
                      !registerPasswordConfirm
                    }
                    onClick={async () => {
                      setAuthError("");

                      if (registerPassword !== registerPasswordConfirm) {
                        setAuthError("Passwords do not match.");
                        return;
                      }

                      setIsAuthPending(true);
                      try {
                        const result = await signUpWithCredentials({
                          name: registerName,
                          email: registerEmail,
                          password: registerPassword,
                          callbackUrl: "/",
                        });

                        if (result.error) {
                          setAuthError(
                            result.error.message || "Registration failed.",
                          );
                        } else {
                          dismissSignInModal();
                        }
                      } catch {
                        setAuthError("Registration failed. Please try again.");
                      } finally {
                        setIsAuthPending(false);
                      }
                    }}
                  >
                    Create account
                  </Button>
                </div>
              )}

              {authError && (
                <p className="mt-3 text-sm text-red-300 text-center">
                  {authError}
                </p>
              )}
            </div>
          </div>
        )}
      </main>
      {/* </ContextMenuTrigger>
      <ContextMenuContent className="z-10000 rounded-xl bg-background/40 backdrop-blur-xl">
        <ContextMenuItem
          className="rounded-[10px] p-3.5 py-2 text-base"
          onClick={() => {
            addWindow(
              <TerminalApplicationWindow
                identifier={v4()}
                key={windows.length + 1}
              />
            );
          }}
        >
          Open new terminal instance
        </ContextMenuItem>
        <ContextMenuItem
          className="rounded-[10px] p-3.5 py-2 text-base"
          onClick={() => {
            addWindow(<GameApplicationWindow key={windows.length + 1} />);
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
      <DropdownMenuContent className="ml-2 mt-2 w-fit p-1 rounded-xl shadow-md flex flex-col gap-1 transition-all duration-500 bg-background/40 backdrop-blur-xl z-9999">
        <Calendar
          mode="single"
          className="rounded-[8px] text-base transition-all duration-500"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
