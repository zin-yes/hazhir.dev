"use client";

import { Button } from "@/components/ui/button";
import { FileSymlink, Gamepad2, TerminalSquare } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import {
    signInAsGuest,
    signInWithCredentials,
    signInWithGoogle,
    useSession,
} from "@/auth/client";
import { Calendar } from "@/components/ui/calendar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuthPillar } from "@/hooks/use-auth-pillar";
import UseOperatingSystem from "@/hooks/use-operating-system";
import { OS_LAUNCH_APPLICATION_EVENT } from "@/lib/application-launcher";
import {
    FILE_PATH_DROP_EVENT,
    hasFileDragType,
    readDroppedPathsFromDataTransfer,
} from "@/lib/file-transfer-dnd";
import { setCurrentSystemUsername } from "@/lib/system-user";
import Image from "next/image";
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
import Desktop from "./desktop";
import Wallpaper from "./wallpaper";

export default function OperatingSystemPage() {
  const [windows, setWindows] = useState<React.ReactNode[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string>("");
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [isSystemUserReady, setIsSystemUserReady] = useState(false);
  const [isFileTransferDragActive, setIsFileTransferDragActive] = useState(false);
  const [isOverDropZone, setIsOverDropZone] = useState(false);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const fileDragDepthRef = useRef(0);

  const addWindow = useCallback((pane: React.ReactNode) => {
    setWindows((previous) => [...previous, pane]);
  }, []);

  const [time, setTime] = useState<string>(new Date().toLocaleTimeString());

  useEffect(() => {
    setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);
  }, []);

  const session = useSession();
  const { isSignInModalRequested, dismissSignInModal } = useAuthPillar();
  const showLoginScreen =
    isSignInModalRequested ||
    (session.status !== "loading" && session.status !== "authenticated");
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

  const operatingSystem = UseOperatingSystem();

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
      const detail = (event as CustomEvent<{ appId: string; args?: string[] }>).detail;
      if (!detail?.appId) return;

      switch (detail.appId) {
        case "terminal":
          addWindow(<TerminalApplicationWindow identifier={v4()} />);
          break;
        case "file-explorer":
          addWindow(<FileExplorerApplicationWindow addWindow={addWindow} />);
          break;
        case "voxel-game":
          addWindow(<GameApplicationWindow />);
          break;
        case "calculator":
          addWindow(<CalculatorApplicationWindow />);
          break;
        case "visual-novel":
          addWindow(<VisualNovelApplicationWindow />);
          break;
        case "document-viewer": {
          const articleId = detail.args?.[0] ?? "CV.pdf";
          const title = detail.args?.[1] ?? articleId;
          addWindow(
            <SingleDocumentApplicationWindow articleId={articleId} title={title} />
          );
          break;
        }
        case "text-editor": {
          const filePath = detail.args?.[0];
          if (!filePath) break;
          addWindow(<TextEditorApplicationWindow filePath={filePath} />);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener(OS_LAUNCH_APPLICATION_EVENT, handler);
    return () => window.removeEventListener(OS_LAUNCH_APPLICATION_EVENT, handler);
  }, [addWindow]);

  useEffect(() => {
    const updateDropZoneState = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y) as HTMLElement | null;
      setIsOverDropZone(Boolean(element?.closest("[data-file-drop-zone='true']")));
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
        event.clientY
      ) as HTMLElement | null;
      const dropZone = target?.closest(
        "[data-file-drop-zone='true']"
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
            })
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
              className={
                "absolute top-0 left-0 right-0 z-1 flex flex-row justify-between m-2 p-1 text-white rounded-xl shadow-md bg-primary"
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
                <DropdownMenuContent className="ml-2 mt-2 w-80 p-1 rounded-xl bg-background/40 backdrop-blur-xl flex flex-col gap-1 z-9999">
                  <DropdownMenuItem
                    className="rounded-[10px] p-3.5 py-2 text-base"
                    onClick={() => {
                      addWindow(
                        <TerminalApplicationWindow
                          identifier={v4()}
                          key={operatingSystem.getApplicationWindows().length}
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
                      addWindow(
                        <GameApplicationWindow
                          key={operatingSystem.getApplicationWindows().length}
                        />
                      );
                    }}
                  >
                    Start new voxel game window
                    <DropdownMenuShortcut>
                      <Gamepad2 size={18} />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
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
                      loader={({ src, width, quality }) =>
                        `${src}?w=${width}&q=${quality || 75}`
                      }
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

            <div className="w-screen h-screen" id="operating-system-container">
              {windows.map((item, index) => {
                return <React.Fragment key={index}>{item}</React.Fragment>;
              })}
            </div>

            {isFileTransferDragActive && (
              <div
                className="pointer-events-none fixed z-[2147483647] transition-transform"
                style={{
                  left: dragCursor.x + 10,
                  top: dragCursor.y - 28,
                }}
              >
                <div
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border backdrop-blur-sm ${
                    isOverDropZone
                      ? "bg-emerald-600/95 border-emerald-200 text-white shadow-lg shadow-emerald-900/40"
                      : "bg-rose-700/95 border-rose-200 text-white shadow-lg shadow-rose-950/50"
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
            <div className="w-full max-w-md rounded-2xl border border-white/20 bg-background/80 shadow-2xl p-6">
              <div className="mb-6 text-center text-white">
                <h1 className="text-2xl font-semibold tracking-wide">hazhir.dev</h1>
                <p className="text-sm text-white/70 mt-1">Sign in to unlock your desktop</p>
              </div>

              <div className="space-y-3">
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
                      setAuthError("Google sign-in failed. Please try again.");
                    } finally {
                      setIsAuthPending(false);
                    }
                  }}
                >
                  Sign in with Google
                </Button>

                <div className="pt-2 border-t border-white/10">
                  <p className="text-xs uppercase tracking-wide text-white/60 mb-2">
                    Credentials
                  </p>
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
                            setAuthError(result.error.message || "Invalid credentials.");
                          } else {
                            dismissSignInModal();
                          }
                        } catch {
                          setAuthError("Credentials sign-in failed. Please try again.");
                        } finally {
                          setIsAuthPending(false);
                        }
                      }}
                    >
                      Sign in with Email & Password
                    </Button>
                  </div>
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
                  Sign in as Guest
                </Button>

                {authError && (
                  <p className="text-sm text-red-300 text-center">{authError}</p>
                )}
              </div>
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
