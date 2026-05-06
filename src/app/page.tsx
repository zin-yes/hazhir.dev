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
  MessageSquare,
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
import { CookieConsent } from "@/components/blocks/cookie-consent";
import CookiePolicy from "@/components/legal/cookie-policy";
import PrivacyPolicy from "@/components/legal/privacy-policy";
import Terms from "@/components/legal/terms-of-service";
import ScrollMoreButton from "@/components/system/scroll-more-button";
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
import { OS_LAUNCH_APPLICATION_EVENT, requestLaunchApplication } from "@/lib/application-launcher";
import { usePostHog } from "posthog-js/react";
import { executeFilePath } from "@/lib/file-execution";
import {
  FILE_PATH_DROP_EVENT,
  hasFileDragType,
  readDroppedPathsFromDataTransfer,
} from "@/lib/file-transfer-dnd";
import {
  type ShortcutDefinition,
  getShortcutIconName,
  getShortcutIconUrl,
  parseShortcut,
} from "@/lib/shortcut";
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
  ChatApplicationWindow,
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
  VisualNovelApplicationWindow,
} from "./application-windows";
import Desktop from "./desktop";
import Wallpaper from "./wallpaper";
import { useDeviceMode, type DeviceMode } from "@/hooks/use-device-mode";
import {
  MobileStatusBar,
  NotificationDrawer,
  AppDrawer,
  AppSwitcher,
  MobileNavBar,
  MobileWindowContainer,
  type MobileWindowEntry,
  type MobileWindowAnimState,
} from "@/operating-system/mobile";
import LoadingWindow from "@/operating-system/application/window/loading";
import dynamic from "next/dynamic";
import { EditIcon, FileText } from "lucide-react";

const TerminalApplication = dynamic(
  () => import("@/applications/terminal"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const FileExplorerApplication = dynamic(
  () => import("@/applications/file-explorer"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const MeditationApplication = dynamic(
  () => import("@/applications/meditation"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const GameApplication = dynamic(
  () => import("@/applications/game"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const CalculatorApplication = dynamic(
  () => import("@/applications/calculator"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const VisualNovelApplication = dynamic(
  () => import("@/applications/visual-novel"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const documentViewerImport = () => import("@/applications/document-viewer");
const DocumentViewerApplication = dynamic(
  documentViewerImport,
  { loading: () => <LoadingWindow />, ssr: false },
);

// ─── Auto-launch route registry ────────────────────────────────────────────
// Each entry maps a pathname to the app that should be auto-launched there.
// The page re-exports the main page component, so adding a new route only
// requires (a) a new entry here, and (b) a new src/app/<slug>/page.tsx.
type AutoLaunchRoute = {
  preload?: () => Promise<unknown>;
  appId: string;
  getArgs: () => string[];
};

const autoLaunchRoutes: Record<string, AutoLaunchRoute> = {
  "/cv": {
    preload: documentViewerImport,
    appId: "document-viewer",
    getArgs: () => ["CV"],
  },
  "/hazhir-dev": {
    preload: documentViewerImport,
    appId: "document-viewer",
    getArgs: () => [`${getHomePath()}/Documents/hazhir.dev.document`],
  },
  "/metricjournal": {
    preload: documentViewerImport,
    appId: "document-viewer",
    getArgs: () => [`${getHomePath()}/Documents/MetricJournal.document`],
  },
  "/atlas": {
    preload: documentViewerImport,
    appId: "document-viewer",
    getArgs: () => [`${getHomePath()}/Documents/Atlas.document`],
  },
  "/gamma-engine": {
    preload: documentViewerImport,
    appId: "document-viewer",
    getArgs: () => [`${getHomePath()}/Documents/Gamma-Engine.document`],
  },
};

// Preload modules for the current route
if (typeof window !== "undefined") {
  autoLaunchRoutes[window.location.pathname]?.preload?.();
}
const ImageViewerApplication = dynamic(
  () => import("@/applications/image-viewer"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const TextEditorApplication = dynamic(
  () => import("@/applications/text-editor"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const SettingsApplication = dynamic(
  () => import("@/applications/settings"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const FilePropertiesApplication = dynamic(
  () => import("@/applications/file-properties"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const ChatApplication = dynamic(
  () => import("@/applications/chat"),
  { loading: () => <LoadingWindow />, ssr: false },
);

const MobileFileExplorerApplication = dynamic(
  () => import("@/applications/file-explorer/mobile"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const MobileSettingsApplication = dynamic(
  () => import("@/applications/settings/mobile"),
  { loading: () => <LoadingWindow />, ssr: false },
);
const MobileChatApplication = dynamic(
  () => import("@/applications/chat/mobile"),
  { loading: () => <LoadingWindow />, ssr: false },
);

const OS_WINDOW_CURSOR_CHANGE_EVENT = "os-window-cursor-change";

type MenuShortcutItem = {
  path: string;
  shortcut: ShortcutDefinition;
  label: string;
  description: string;
  iconName: string;
  iconUrl?: string;
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
    case "MessageSquare":
      return <MessageSquare size={16} className="text-white/90" />;
    case "FileSymlink":
      return <FileSymlink size={16} className="text-white/90" />;
    default:
      return <File size={16} className="text-white/90" />;
  }
}
export default function OperatingSystemPage() {
  const posthog = usePostHog();
  const posthogRef = useRef(posthog);
  useEffect(() => { posthogRef.current = posthog; }, [posthog]);

  const fs = useFileSystem();
  const fsRef = useRef(fs);
  const deviceMode = useDeviceMode();
  const isMobileOrTablet = deviceMode === "mobile" || deviceMode === "tablet";
  const [hasMounted, setHasMounted] = useState(false);
  const [windows, setWindows] = useState<WindowEntry[]>([]);

  // ─── Mobile/tablet state ───────────────────────────────
  const [mobileWindows, setMobileWindows] = useState<MobileWindowEntry[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
  const [appDrawerOpen, setAppDrawerOpen] = useState(false);
  const [appSwitcherOpen, setAppSwitcherOpen] = useState(false);
  const [mobileAnimStates, setMobileAnimStates] = useState<Record<string, MobileWindowAnimState>>({});

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [authError, setAuthError] = useState<string>("");
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [authView, setAuthView] = useState<"sign-in" | "register">("sign-in");
  const [legalView, setLegalView] = useState<
    "terms" | "privacy" | "cookies" | null
  >(null);
  const [legalClosing, setLegalClosing] = useState(false);
  const closeLegalView = useCallback(() => {
    setLegalClosing(true);
    setTimeout(() => {
      setLegalView(null);
      setLegalClosing(false);
    }, 280);
  }, []);
  const [cookiesDeclined, setCookiesDeclined] = useState(false);
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

  // ─── Mobile window management ─────────────────────────
  const addMobileWindow = useCallback(
    (
      appId: string,
      title: string,
      icon: React.ReactNode,
      node: React.ReactNode,
      id?: string,
    ) => {
      const windowId = id ?? v4();
      setMobileWindows((prev) => {
        const existing = prev.find((w) => w.id === windowId);
        if (existing) return prev;
        return [...prev, { id: windowId, appId, title, icon, node }];
      });
      setMobileAnimStates((prev) => ({ ...prev, [windowId]: "entering" }));
      setTimeout(() => {
        setMobileAnimStates((prev) => {
          const next = { ...prev };
          if (next[windowId] === "entering") next[windowId] = "visible";
          return next;
        });
      }, 300);
      setActiveWindowId(windowId);
      setAppSwitcherOpen(false);
      setAppDrawerOpen(false);
      return windowId;
    },
    [],
  );

  const removeMobileWindow = useCallback(
    (windowId: string) => {
      // Trigger close animation
      setMobileAnimStates((prev) => ({ ...prev, [windowId]: "exiting-close" }));
      setTimeout(() => {
        setMobileWindows((prev) => prev.filter((w) => w.id !== windowId));
        setMobileAnimStates((prev) => {
          const next = { ...prev };
          delete next[windowId];
          return next;
        });
        setActiveWindowId((prev) => {
          if (prev === windowId) return null;
          return prev;
        });
      }, 300);
    },
    [],
  );

  const openSettingsWindow = useCallback(
    (initialTab?: string) => {
      if (isMobileOrTablet) {
        addMobileWindow("settings", "Settings", <Settings size={16} />, <MobileSettingsApplication initialTab={initialTab} />);
      } else {
        addWindow(<SettingsApplicationWindow initialTab={initialTab} />);
      }
    },
    [addWindow, addMobileWindow, isMobileOrTablet],
  );

  const handleMobileHome = useCallback(() => {
    if (activeWindowId) {
      // Animate current window out before going home
      setMobileAnimStates((prev) => ({ ...prev, [activeWindowId]: "exiting-home" }));
      setTimeout(() => {
        setActiveWindowId(null);
        setMobileAnimStates((prev) => {
          if (!activeWindowId) return prev;
          const next = { ...prev };
          delete next[activeWindowId];
          return next;
        });
      }, 300);
    } else {
      setActiveWindowId(null);
    }
    setAppSwitcherOpen(false);
    setAppDrawerOpen(false);
    setNotificationDrawerOpen(false);
  }, [activeWindowId]);

  const handleMobileRecents = useCallback(() => {
    if (activeWindowId && !appSwitcherOpen) {
      // Animate current window shrinking into switcher view
      setMobileAnimStates((prev) => ({ ...prev, [activeWindowId]: "exiting-switch" }));
      setTimeout(() => {
        setMobileAnimStates((prev) => {
          if (!activeWindowId) return prev;
          const next = { ...prev };
          delete next[activeWindowId];
          return next;
        });
      }, 250);
    }
    setAppSwitcherOpen((prev) => !prev);
    setAppDrawerOpen(false);
    setNotificationDrawerOpen(false);
  }, []);

  useEffect(() => {
    fsRef.current = fs;
  }, [fs]);

  const [menuSearchValue, setMenuSearchValue] = useState("");
  const [menuItems, setMenuItems] = useState<MenuShortcutItem[]>([]);
  const [menuHoveredDescription, setMenuHoveredDescription] = useState("");
  const menuAppsScrollRef = useRef<HTMLDivElement | null>(null);

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
          parsed.meta.display_name ?? node.name.replace(/\.shortcut$/i, "");

        return {
          path: node.path,
          shortcut: parsed,
          label,
          description: parsed.meta.description ?? "",
          iconName: getShortcutIconName(parsed) ?? "",
          iconUrl: getShortcutIconUrl(parsed),
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

  // Auto-login as guest when visiting an auto-launch route to bypass login screen
  useEffect(() => {
    if (!hasMounted) return;
    if (!(window.location.pathname in autoLaunchRoutes)) return;
    if (session.status === "authenticated") return;
    if (session.status === "loading") return;
    signInAsGuest();
  }, [hasMounted, session.status]);

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

  const sessionUser = session.data?.user as
    | {
        username?: string;
        name?: string;
        id?: string;
      }
    | undefined;
  const sessionStatus = session.status;
  const sessionUsername =
    sessionUser?.username ?? sessionUser?.name ?? sessionUser?.id;

  useEffect(() => {
    if (sessionStatus === "authenticated" && sessionUsername) {
      setCurrentSystemUsername(String(sessionUsername));
      setIsSystemUserReady(true);
      return;
    }

    if (sessionStatus !== "loading") {
      setIsSystemUserReady(true);
    }
  }, [sessionStatus, sessionUsername]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ appId: string; args?: string[] }>)
        .detail;
      if (!detail?.appId) return;
      posthogRef.current?.capture("app_launched", { app_id: detail.appId });

      // Helper to decide whether to launch as mobile window or desktop window
      const launchMobile = (
        appId: string,
        title: string,
        icon: React.ReactNode,
        content: React.ReactNode,
        id?: string,
      ) => {
        addMobileWindow(appId, title, icon, content, id);
      };

      if (isMobileOrTablet) {
        // ─── Mobile/tablet app launching ─────────────────
        switch (detail.appId) {
          case "terminal": {
            const id = v4();
            launchMobile(
              "terminal",
              "Terminal",
              <TerminalSquare size={16} />,
              <TerminalApplication windowIdentifier={id} initialPath={detail.args?.[0]} />,
              id,
            );
            break;
          }
          case "file-explorer":
            launchMobile(
              "file-explorer",
              "Files",
              <FolderClosed size={16} />,
              <MobileFileExplorerApplication initialPath={detail.args?.[0]} />,
            );
            break;
          case "meditation":
            launchMobile("meditation", "Meditation", <Heart size={16} />, <MeditationApplication />);
            break;
          case "voxel-game":
            launchMobile("voxel-game", "Voxel Game", <Gamepad2 size={16} />, <GameApplication />);
            break;
          case "calculator":
            launchMobile("calculator", "Calculator", <Calculator size={16} />, <CalculatorApplication />);
            break;
          case "visual-novel":
            launchMobile("visual-novel", "Visual Novel", <BookText size={16} />, <VisualNovelApplication />);
            break;
          case "document-viewer": {
            const requested = detail.args?.[0];
            const filePath = !requested
              ? undefined
              : requested === "CV"
                ? `${getHomePath()}/Documents/CV.document`
                : requested;
            launchMobile(
              "document-viewer",
              "Document Viewer",
              <BookOpen size={16} />,
              <DocumentViewerApplication filePath={filePath} mode={filePath ? "single" : undefined} />,
            );
            break;
          }
          case "image-viewer":
            launchMobile(
              "image-viewer",
              "Image Viewer",
              <ImageIcon size={16} />,
              <ImageViewerApplication initialFilePath={detail.args?.[0]} />,
            );
            break;
          case "text-editor": {
            const filePath = detail.args?.[0];
            const windowId = v4();
            const fileName = filePath?.split("/").pop() || "Text Editor";
            launchMobile(
              "text-editor",
              `Text Editor - ${fileName}`,
              <EditIcon size={16} />,
              <TextEditorApplication filePath={filePath} identifier={windowId} onRequestClose={() => removeMobileWindow(windowId)} />,
              windowId,
            );
            break;
          }
          case "settings":
            launchMobile("settings", "Settings", <Settings size={16} />, <MobileSettingsApplication initialTab={detail.args?.[0]} />);
            break;
          case "file-properties":
            launchMobile(
              "file-properties",
              "Properties",
              <FileText size={16} />,
              <FilePropertiesApplication filePath={detail.args?.[0]} />,
            );
            break;
          case "chat":
            launchMobile("chat", "Chat", <MessageSquare size={16} />, <MobileChatApplication />);
            break;
          default:
            break;
        }
      } else {
        // ─── Desktop app launching ───────────────────────
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
          case "visual-novel":
            addWindow(<VisualNovelApplicationWindow />);
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
          case "image-viewer":
            addWindow(
              <ImageViewerApplicationWindow filePath={detail.args?.[0]} />,
            );
            break;
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
          case "settings":
            openSettingsWindow(detail.args?.[0]);
            break;
          case "file-properties":
            addWindow(
              <FilePropertiesApplicationWindow filePath={detail.args?.[0]} />,
            );
            break;
          case "chat":
            addWindow(<ChatApplicationWindow />);
            break;
          default:
            break;
        }
      }
    };

    window.addEventListener(OS_LAUNCH_APPLICATION_EVENT, handler);
    return () =>
      window.removeEventListener(OS_LAUNCH_APPLICATION_EVENT, handler);
  }, [addMobileWindow, addWindow, isMobileOrTablet, openSettingsWindow, removeMobileWindow, removeWindow]);

  // Auto-launch application when visiting a configured route
  const hasAutoLaunched = useRef(false);
  useEffect(() => {
    if (!operatingSystemVisible || !isSystemUserReady || hasAutoLaunched.current) return;
    const route = autoLaunchRoutes[window.location.pathname];
    if (!route) return;
    hasAutoLaunched.current = true;
    requestLaunchApplication(route.appId, route.getArgs());
  }, [operatingSystemVisible, isSystemUserReady]);

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
      <main className="w-screen h-dvh absolute top-0 bottom-0 left-0 right-0 overflow-hidden">
        <Wallpaper />

        {shouldShowOperatingSystem && isSystemUserReady && (
          <div
            className={`absolute inset-0 transition-all duration-1000 ease-out will-change-transform ${
              operatingSystemVisible
                ? "opacity-100 translate-y-0 blur-0"
                : "opacity-0 -translate-y-[5%] blur-[3px]"
            }`}
          >
            {/* Desktop visible when no mobile app is in the foreground */}
            {(!isMobileOrTablet || activeWindowId === null) && (
              <Desktop addWindow={addWindow} deviceMode={deviceMode} />
            )}

            {/* ─── Desktop-only UI ─────────────────────────── */}
            {!isMobileOrTablet && (
              <>
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

                      <div className="relative mt-2">
                        <div
                          ref={menuAppsScrollRef}
                          className="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/15 p-1"
                        >
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
                        <ScrollMoreButton
                          scrollElementRef={menuAppsScrollRef}
                          className="bottom-3 border-white/20 bg-black/75 text-white hover:bg-white/20 hover:text-white"
                        />
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

                <div
                  className="relative z-10 w-screen h-dvh pointer-events-none"
                  id="operating-system-container"
                >
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
              </>
            )}

            {/* ─── Mobile/tablet UI ────────────────────────── */}
            {isMobileOrTablet && (
              <>
                <MobileStatusBar
                  onPullDown={() => setNotificationDrawerOpen(true)}
                  activeTitle={
                    activeWindowId && !appSwitcherOpen
                      ? mobileWindows.find((w) => w.id === activeWindowId)?.title ?? null
                      : null
                  }
                  activeTitlebarColor={
                    activeWindowId && !appSwitcherOpen
                      ? "hsl(var(--primary))"
                      : null
                  }
                  userImage={session.data?.user.image ?? null}
                  onOpenSettings={() => openSettingsWindow("system")}
                  onSignOut={async () => {
                    await signOut({ callbackUrl: "/" });
                  }}
                />

                {/* Active mobile window */}
                {mobileWindows.map((win) => (
                  <MobileWindowContainer
                    key={win.id}
                    window={win}
                    visible={activeWindowId === win.id && !appSwitcherOpen}
                    animState={mobileAnimStates[win.id]}
                    onAnimationEnd={() => {
                      setMobileAnimStates((prev) => {
                        const next = { ...prev };
                        delete next[win.id];
                        return next;
                      });
                    }}
                  />
                ))}

                {/* Notification drawer */}
                <NotificationDrawer
                  open={notificationDrawerOpen}
                  onClose={() => setNotificationDrawerOpen(false)}
                />

                {/* App drawer */}
                <AppDrawer
                  open={appDrawerOpen}
                  onClose={() => setAppDrawerOpen(false)}
                  onLaunchApp={(path) => {
                    const result = executeFilePath(path, fsRef.current);
                    if (!result.ok) {
                      console.warn(result.message);
                    }
                  }}
                />

                {/* App switcher */}
                <AppSwitcher
                  open={appSwitcherOpen}
                  windows={mobileWindows}
                  activeWindowId={activeWindowId}
                  onSelectWindow={(id) => {
                    setActiveWindowId(id);
                    setAppSwitcherOpen(false);
                  }}
                  onCloseWindow={(id) => {
                    removeMobileWindow(id);
                  }}
                  onClose={() => setAppSwitcherOpen(false)}
                />

                {/* Bottom navigation bar */}
                <MobileNavBar
                  onHome={handleMobileHome}
                  onRecents={handleMobileRecents}
                  isAppDrawerOpen={appDrawerOpen}
                  onAppDrawer={() => {
                    if (appDrawerOpen) {
                      setAppDrawerOpen(false);
                    } else {
                      setAppDrawerOpen(true);
                      setAppSwitcherOpen(false);
                      setNotificationDrawerOpen(false);
                    }
                  }}
                />
              </>
            )}
          </div>
        )}

        {showLoginScreen && (
          <div className="absolute inset-0 z-[10000] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="relative w-full max-w-md rounded-2xl border border-white/15 bg-background/60 p-5 shadow-2xl backdrop-blur-xl">
              <div className="space-y-1 text-center text-white">
                <h1 className="text-2xl font-semibold tracking-wide">
                  hazhir.dev
                </h1>
                <p className="text-sm text-white/70">Welcome to your desktop</p>
              </div>

              {cookiesDeclined && (
                <p className="mt-4 text-sm text-amber-300 text-center">
                  Cookies are required for authentication. Please accept cookies
                  to sign in or register.
                </p>
              )}

              <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                <Button
                  type="button"
                  variant={authView === "sign-in" ? "secondary" : "ghost"}
                  className="h-8"
                  disabled={isAuthPending || cookiesDeclined}
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
                  disabled={isAuthPending || cookiesDeclined}
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
                    disabled={isAuthPending || cookiesDeclined}
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
                      disabled={isAuthPending || cookiesDeclined}
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={isAuthPending || cookiesDeclined}
                    />
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={
                        isAuthPending || cookiesDeclined || !email || !password
                      }
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
                    disabled={isAuthPending || cookiesDeclined}
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
                    disabled={isAuthPending || cookiesDeclined}
                  />
                  <Input
                    type="email"
                    placeholder="Email"
                    value={registerEmail}
                    onChange={(event) => setRegisterEmail(event.target.value)}
                    disabled={isAuthPending || cookiesDeclined}
                  />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={registerPassword}
                    onChange={(event) =>
                      setRegisterPassword(event.target.value)
                    }
                    disabled={isAuthPending || cookiesDeclined}
                  />
                  <Input
                    type="password"
                    placeholder="Confirm password"
                    value={registerPasswordConfirm}
                    onChange={(event) =>
                      setRegisterPasswordConfirm(event.target.value)
                    }
                    disabled={isAuthPending || cookiesDeclined}
                  />

                  <Button
                    className="w-full"
                    disabled={
                      isAuthPending ||
                      cookiesDeclined ||
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

              <p className="mt-4 text-center text-[11px] text-white/40 leading-relaxed">
                By signing in you agree to the{" "}
                <button
                  type="button"
                  className="underline hover:text-white/70 transition-colors"
                  onClick={() => setLegalView("terms")}
                >
                  Terms of Service
                </button>
                ,{" "}
                <button
                  type="button"
                  className="underline hover:text-white/70 transition-colors"
                  onClick={() => setLegalView("privacy")}
                >
                  Privacy Policy
                </button>
                {" & "}
                <button
                  type="button"
                  className="underline hover:text-white/70 transition-colors"
                  onClick={() => setLegalView("cookies")}
                >
                  Cookie Policy
                </button>
                .
              </p>
            </div>

            {legalView && (
              <div
                key={legalView}
                className={`absolute inset-3 z-10 flex flex-col rounded-xl border border-white/15 bg-background/95 shadow-2xl backdrop-blur-xl overflow-hidden ${
                  legalClosing
                    ? "animate-out fade-out slide-out-to-bottom-4 duration-300"
                    : "animate-in fade-in slide-in-from-bottom-4 duration-300"
                }`}
              >
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <h2 className="text-sm font-medium text-white">
                    {legalView === "terms"
                      ? "Terms of Service"
                      : legalView === "privacy"
                        ? "Privacy Policy"
                        : "Cookie Policy"}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-white/70 hover:text-white"
                    onClick={closeLegalView}
                  >
                    Back
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 text-sm [&_h1]:text-lg [&_h1]:mb-3 [&_h2]:text-base [&_h2]:mt-5 [&_h2]:mb-1.5 [&_p]:text-white/80 [&_p]:text-xs [&_p]:leading-relaxed [&_ul]:text-white/80 [&_ul]:text-xs [&_li]:leading-relaxed [&_a]:text-blue-400">
                  {legalView === "terms" && <Terms />}
                  {legalView === "privacy" && <PrivacyPolicy />}
                  {legalView === "cookies" && <CookiePolicy />}
                </div>
              </div>
            )}
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
    </ContextMenu> 
    </>*/}
      {typeof window !== "undefined" && window.location.pathname in autoLaunchRoutes && (
        <CookieConsent
          variant="small"
          description={
            <>
              This site uses analytics to understand how it&apos;s used. See our{" "}
              <a href="/privacy" className="underline hover:no-underline">Privacy Policy</a> and{" "}
              <a href="/cookies" className="underline hover:no-underline">Cookie Policy</a> for details.
            </>
          }
          onAcceptCallback={() => {
            setCookiesDeclined(false);
            posthog?.startSessionRecording();
          }}
          onDeclineCallback={() => {
            setCookiesDeclined(true);
            posthog?.stopSessionRecording();
          }}
        />
      )}
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
