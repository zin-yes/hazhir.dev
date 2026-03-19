"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFileSystem } from "@/hooks/use-file-system";
import {
  getShortcutIconName,
  getShortcutIconUrl,
  parseShortcut,
} from "@/lib/shortcut";
import {
  type ClockFormat,
  getClockFormat,
  subscribeSystemPreferenceChanges,
} from "@/lib/system-preferences";
import { getHomePath } from "@/lib/system-user";
import {
  BookOpen,
  BookText,
  Calculator,
  ChevronDown,
  File,
  FileSymlink,
  FolderClosed,
  Gamepad2,
  Heart,
  ImageIcon,
  LogOut,
  MessageSquare,
  Settings,
  TerminalSquare,
  User2,
} from "lucide-react";
import Image from "next/image";
import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type MobileAppEntry = {
  id: string;
  path: string;
  label: string;
  description: string;
  iconName: string;
  iconUrl?: string;
};

// ─── Status bar (top) ────────────────────────────────────────────────

export function MobileStatusBar({
  onPullDown,
  activeTitle,
  activeTitlebarColor,
  userImage,
  onOpenSettings,
  onSignOut,
}: {
  onPullDown?: () => void;
  activeTitle?: string | null;
  activeTitlebarColor?: string | null;
  userImage?: string | null;
  onOpenSettings?: () => void;
  onSignOut?: () => void;
}) {
  const [time, setTime] = useState("");
  const [clockFormat, setClockFormatState] = useState<ClockFormat>("12h");

  useEffect(() => {
    const sync = () => setClockFormatState(getClockFormat());
    sync();
    return subscribeSystemPreferenceChanges(sync);
  }, []);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: clockFormat === "12h",
        }),
      );
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [clockFormat]);

  const hasActiveApp = !!activeTitle;
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9000] flex items-center justify-between px-4 py-1 text-white text-xs select-none transition-colors duration-300"
      style={{
        height: 28,
        backgroundColor: hasActiveApp
          ? (activeTitlebarColor ?? "hsl(var(--primary))")
          : "transparent",
      }}
      onPointerDown={(e) => {
        if (profileMenuOpen) return;
        if ((e.target as HTMLElement).closest("[data-mobile-profile-menu]"))
          return;
        e.stopPropagation();
        onPullDown?.();
      }}
    >
      {/* Left side: app title slides in when active */}
      <div className="flex items-center gap-2 overflow-hidden">
        <span
          className="text-sm font-medium truncate transition-all duration-300"
          style={{
            opacity: hasActiveApp ? 1 : 0,
            transform: hasActiveApp ? "translateX(0)" : "translateX(-20px)",
          }}
        >
          {activeTitle ?? ""}
        </span>
      </div>

      {/* Right side: time + profile */}
      <div className="flex items-center gap-2">
        <span className="font-semibold tabular-nums" suppressHydrationWarning>
          {time}
        </span>
        <DropdownMenu open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-mobile-profile-menu
              className="w-5 h-5 rounded-full flex items-center justify-center bg-white/20 active:bg-white/30 transition-colors"
              aria-label="Open profile menu"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {userImage ? (
                <Image
                  src={userImage}
                  width={20}
                  height={20}
                  alt="Profile"
                  className="rounded-full"
                />
              ) : (
                <User2 className="size-3" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="w-48 rounded-xl border border-white/10 bg-background/85 p-1 backdrop-blur-2xl z-[9600]"
          >
            <DropdownMenuItem
              className="rounded-lg px-2.5 py-2 text-sm text-white data-[highlighted]:bg-white/15"
              onSelect={() => {
                onOpenSettings?.();
              }}
            >
              <Settings size={14} className="text-white/80" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              className="rounded-lg px-2.5 py-2 text-sm text-white data-[highlighted]:bg-white/15"
              onSelect={() => {
                onSignOut?.();
              }}
            >
              <LogOut size={14} className="text-white/80" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── Notification Drawer (swipe down from top) ──────────────────────

export function NotificationDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [clockFormat, setClockFormatState] = useState<ClockFormat>("12h");
  const drawerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [closing, setClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setClosing(false);
    } else if (shouldRender) {
      setClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setClosing(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    const sync = () => setClockFormatState(getClockFormat());
    sync();
    return subscribeSystemPreferenceChanges(sync);
  }, []);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: clockFormat === "12h",
        }),
      );
      setDate(
        now.toLocaleDateString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
        }),
      );
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [clockFormat]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragStartRef.current = e.clientY;
    setDragOffset(0);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartRef.current === null || !open) return;
      const dy = e.clientY - dragStartRef.current;
      if (dy < 0) setDragOffset(dy);
    },
    [open],
  );

  const handlePointerUp = useCallback(() => {
    if (dragOffset < -80) {
      onClose();
    }
    dragStartRef.current = null;
    setDragOffset(0);
  }, [dragOffset, onClose]);

  if (!shouldRender) return null;

  return (
    <div
      className="fixed inset-0 z-[9500] touch-none"
      onClick={onClose}
      style={{
        animation: closing
          ? "notification-drawer-overlay-exit 0.3s ease forwards"
          : undefined,
      }}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        style={{
          opacity: closing ? 0 : Math.max(0, 1 + dragOffset / 300),
          transition: closing ? "opacity 0.3s ease" : undefined,
        }}
      />
      <div
        ref={drawerRef}
        className={`absolute left-0 right-0 top-0 bg-background/95 backdrop-blur-xl rounded-b-3xl shadow-2xl border-b border-white/10 touch-none ${
          closing ? "" : "animate-in slide-in-from-top duration-300"
        }`}
        style={{
          transform: closing
            ? "translateY(-100%)"
            : dragOffset < 0
              ? `translateY(${dragOffset}px)`
              : undefined,
          transition: closing
            ? "transform 0.3s cubic-bezier(0.4, 0, 1, 1)"
            : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Time and date */}
        <div className="pt-10 pb-4 px-6">
          <div
            className="text-5xl font-light text-white tabular-nums"
            suppressHydrationWarning
          >
            {time}
          </div>
          <div className="text-sm text-white/70 mt-1" suppressHydrationWarning>
            {date}
          </div>
        </div>

        {/* Pull handle */}
        <div className="flex justify-center pb-3">
          <div className="w-10 h-1 rounded-full bg-white/30" />
        </div>
      </div>
    </div>
  );
}

// ─── App Drawer (swipe up from bottom) ──────────────────────────────

function renderAppIcon(iconName?: string, iconUrl?: string, size = 28) {
  if (iconUrl) {
    return (
      <div
        className="overflow-hidden rounded-xl bg-black/20"
        style={{ width: size, height: size }}
      >
        <Image
          src={iconUrl}
          alt="icon"
          width={size}
          height={size}
          sizes={`${size}px`}
          quality={45}
          className="object-cover"
          style={{ width: size, height: size }}
          draggable={false}
        />
      </div>
    );
  }

  const iconMap: Record<string, ReactNode> = {
    TerminalSquare: <TerminalSquare size={size} className="text-white" />,
    FolderClosed: <FolderClosed size={size} className="text-white" />,
    Gamepad2: <Gamepad2 size={size} className="text-white" />,
    Calculator: <Calculator size={size} className="text-white" />,
    BookText: <BookText size={size} className="text-white" />,
    BookOpen: <BookOpen size={size} className="text-white" />,
    Settings: <Settings size={size} className="text-white" />,
    Image: <ImageIcon size={size} className="text-white" />,
    Heart: <Heart size={size} className="text-white" />,
    MessageSquare: <MessageSquare size={size} className="text-white" />,
    FileSymlink: <FileSymlink size={size} className="text-white" />,
  };

  return iconMap[iconName ?? ""] ?? <File size={size} className="text-white" />;
}

export function AppDrawer({
  open,
  onClose,
  onLaunchApp,
}: {
  open: boolean;
  onClose: () => void;
  onLaunchApp: (path: string) => void;
}) {
  const fs = useFileSystem();
  const fsRef = useRef(fs);
  const [apps, setApps] = useState<MobileAppEntry[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const dragStartRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    fsRef.current = fs;
  }, [fs]);

  useEffect(() => {
    const loadApps = () => {
      const menuPath = `${getHomePath()}/.menu`;
      const children = fsRef.current.getChildren(menuPath, true);
      const items = children
        .filter((n) => n.type === "file" && n.name.endsWith(".shortcut"))
        .map((n) => {
          const parsed = parseShortcut(
            fsRef.current.getFileContents(n.path) ?? "",
          );
          if (!parsed) return null;
          const label =
            parsed.meta.display_name ?? n.name.replace(/\.shortcut$/i, "");
          return {
            id: n.path,
            path: n.path,
            label,
            description: parsed.meta.description ?? "",
            iconName: getShortcutIconName(parsed) ?? "",
            iconUrl: getShortcutIconUrl(parsed),
          } satisfies MobileAppEntry;
        })
        .filter(Boolean) as MobileAppEntry[];
      items.sort((a, b) => a.label.localeCompare(b.label));
      setApps(items);
    };
    loadApps();
    window.addEventListener("storage", loadApps);
    return () => window.removeEventListener("storage", loadApps);
  }, []);

  const filtered = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) =>
      `${a.label} ${a.description}`.toLowerCase().includes(q),
    );
  }, [apps, searchValue]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragStartRef.current = e.clientY;
    setDragOffset(0);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartRef.current === null || !open) return;
      const dy = e.clientY - dragStartRef.current;
      if (dy > 0) setDragOffset(dy);
    },
    [open],
  );

  const handlePointerUp = useCallback(() => {
    if (dragOffset > 100) {
      onClose();
    }
    dragStartRef.current = null;
    setDragOffset(0);
  }, [dragOffset, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9200] touch-none" onClick={onClose}>
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        style={{
          opacity: Math.max(0, 1 - dragOffset / 400),
        }}
      />
      <div
        className="absolute left-0 right-0 bottom-0 top-12 bg-background/95 backdrop-blur-xl rounded-t-3xl shadow-2xl border-t border-white/10 animate-in slide-in-from-bottom duration-300 touch-none flex flex-col"
        style={{
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Pull handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-white/30" />
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <input
            className="w-full h-10 rounded-xl bg-white/10 border border-white/10 px-4 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
            placeholder="Search apps..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>

        {/* App grid */}
        <div className="flex-1 overflow-y-auto px-4 pb-20">
          <div className="grid grid-cols-4 gap-y-5 gap-x-2">
            {filtered.map((app) => (
              <button
                key={app.id}
                type="button"
                className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform"
                onClick={(e) => {
                  e.stopPropagation();
                  onLaunchApp(app.path);
                  onClose();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-xl flex items-center justify-center">
                  {renderAppIcon(app.iconName, app.iconUrl, 28)}
                </div>
                <span className="text-[11px] text-white/80 text-center leading-tight line-clamp-1 w-full">
                  {app.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App Switcher (recents view) ────────────────────────────────────

export type MobileWindowEntry = {
  id: string;
  appId: string;
  title: string;
  icon: ReactNode;
  node: ReactNode;
};

export function AppSwitcher({
  open,
  windows,
  activeWindowId,
  onSelectWindow,
  onCloseWindow,
  onClose,
}: {
  open: boolean;
  windows: MobileWindowEntry[];
  activeWindowId: string | null;
  onSelectWindow: (id: string) => void;
  onCloseWindow: (id: string) => void;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setClosing(false);
    } else if (shouldRender) {
      setClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setClosing(false);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!shouldRender) return null;

  return (
    <div
      className="fixed inset-0 z-[9100] bg-black/60"
      style={{
        animation: closing
          ? "app-switcher-fade-out 0.25s ease forwards"
          : "app-switcher-fade-in 0.3s ease forwards",
      }}
      onClick={handleClose}
    >
      <div className="flex justify-center pt-10 pb-4">
        <div className="text-sm text-white/60 font-medium">Recent Apps</div>
      </div>

      {windows.length === 0 ? (
        <div className="flex items-center justify-center h-1/2">
          <div className="text-white/40 text-sm">No recent apps</div>
        </div>
      ) : (
        <div className="flex gap-4 px-4 overflow-x-auto snap-x snap-mandatory pb-8 pt-2 h-[calc(100dvh-160px)]">
          {windows.map((win) => (
            <SwitcherCard
              key={win.id}
              win={win}
              isActive={activeWindowId === win.id}
              onSelect={() => {
                onSelectWindow(win.id);
                handleClose();
              }}
              onDismiss={() => onCloseWindow(win.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Single card in the app switcher – supports swipe-up to dismiss */
function SwitcherCard({
  win,
  isActive,
  onSelect,
  onDismiss,
}: {
  win: MobileWindowEntry;
  isActive: boolean;
  onSelect: () => void;
  onDismiss: () => void;
}) {
  const [dragY, setDragY] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const directionRef = useRef<"undecided" | "horizontal" | "vertical">(
    "undecided",
  );

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    directionRef.current = "undecided";
    setDragY(0);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStartRef.current === null) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (directionRef.current === "undecided") {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        directionRef.current =
          Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }
    }
    if (directionRef.current === "vertical" && dy < 0) {
      setDragY(dy);
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    if (directionRef.current === "vertical" && dragY < -100) {
      setDismissing(true);
      setTimeout(onDismiss, 250);
    } else {
      setDragY(0);
    }
    dragStartRef.current = null;
    directionRef.current = "undecided";
  }, [dragY, onDismiss]);

  const handlePointerCancel = useCallback(() => {
    dragStartRef.current = null;
    directionRef.current = "undecided";
    setDragY(0);
  }, []);

  return (
    <div
      className="snap-center flex-shrink-0 w-[75vw] max-w-[360px] flex flex-col touch-pan-x"
      onClick={(e) => e.stopPropagation()}
      style={{
        transform: dismissing
          ? "translateY(-120%) scale(0.8)"
          : dragY < 0
            ? `translateY(${dragY}px)`
            : undefined,
        opacity: dismissing ? 0 : Math.max(0.3, 1 + dragY / 400),
        transition:
          dismissing || dragStartRef.current === null
            ? "transform 0.25s ease, opacity 0.25s ease"
            : "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-white text-sm font-medium">
          <div className="w-5 h-5 flex items-center justify-center">
            {win.icon}
          </div>
          <span className="truncate max-w-[200px]">{win.title}</span>
        </div>
        <button
          type="button"
          className="text-white/50 hover:text-white text-lg px-2"
          onClick={(e) => {
            e.stopPropagation();
            setDismissing(true);
            setTimeout(onDismiss, 250);
          }}
        >
          ×
        </button>
      </div>

      {/* Preview card */}
      <div
        role="button"
        tabIndex={0}
        className={`flex-1 rounded-2xl overflow-hidden border-2 transition-colors cursor-pointer ${
          isActive ? "border-blue-400/60" : "border-white/10"
        } bg-background/80`}
        onClick={onSelect}
      >
        <div
          className="w-full h-full pointer-events-none overflow-hidden scale-[0.5] origin-top-left"
          style={{ width: "200%", height: "200%" }}
        >
          {win.node}
        </div>
      </div>
    </div>
  );
}

// ─── Navigation Bar (bottom) ────────────────────────────────────────

export function MobileNavBar({
  onHome,
  onRecents,
  onAppDrawer,
}: {
  onHome: () => void;
  onRecents: () => void;
  onAppDrawer: () => void;
}) {
  const swipeStartRef = useRef<number | null>(null);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9050] flex flex-col items-center bg-black/30 backdrop-blur-md"
      onPointerDown={(e) => {
        swipeStartRef.current = e.clientY;
      }}
      onPointerUp={(e) => {
        if (swipeStartRef.current !== null) {
          const dy = swipeStartRef.current - e.clientY;
          if (dy > 60) {
            onAppDrawer();
          }
          swipeStartRef.current = null;
        }
      }}
    >
      <div className="flex items-center justify-center gap-16 py-0 w-full">
        <button
          type="button"
          className="w-8 h-8 rounded-full flex items-center justify-center text-white active:scale-90 active:bg-white/20 transition-all"
          onClick={onRecents}
          aria-label="Recent apps"
        >
          <div className="w-[11px] h-[11px] border-[1.5px] border-white/80 rounded-[3px]" />
        </button>

        <button
          type="button"
          className="w-8 h-8 rounded-full flex items-center justify-center text-white active:scale-90 active:bg-white/20 transition-all"
          onClick={onHome}
          aria-label="Home"
        >
          <div className="w-3 h-3 rounded-full border-[1.5px] border-white" />
        </button>

        <button
          type="button"
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 active:scale-90 active:bg-white/20 transition-all"
          onClick={onAppDrawer}
          aria-label="App drawer"
        >
          <ChevronDown size={21} className="rotate-180 text-white" />
        </button>
      </div>
    </div>
  );
}

// ─── Mobile Window (full-screen app container) ──────────────────────

type MobileWindowAnimState =
  | "entering"
  | "visible"
  | "exiting-home"
  | "exiting-close"
  | "exiting-switch";

export function MobileWindowContainer({
  window: win,
  visible,
  animState,
  onAnimationEnd,
}: {
  window: MobileWindowEntry;
  visible: boolean;
  animState?: MobileWindowAnimState;
  onAnimationEnd?: () => void;
}) {
  const state = animState ?? (visible ? "visible" : "entering");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      state === "exiting-home" ||
      state === "exiting-close" ||
      state === "exiting-switch"
    ) {
      const timer = setTimeout(() => {
        onAnimationEnd?.();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [state, onAnimationEnd]);

  if (
    !visible &&
    state !== "exiting-home" &&
    state !== "exiting-close" &&
    state !== "exiting-switch"
  ) {
    return null;
  }

  const animStyle: React.CSSProperties = (() => {
    switch (state) {
      case "entering":
        return {
          animation:
            "mobile-window-enter 0.3s cubic-bezier(0.2, 0.9, 0.3, 1) forwards",
        };
      case "visible":
        return {
          opacity: 1,
          transform: "scale(1) translateY(0)",
        };
      case "exiting-home":
        return {
          animation:
            "mobile-window-exit-home 0.3s cubic-bezier(0.4, 0, 1, 1) forwards",
        };
      case "exiting-close":
        return {
          animation:
            "mobile-window-exit-close 0.3s cubic-bezier(0.4, 0, 1, 1) forwards",
        };
      case "exiting-switch":
        return {
          animation:
            "mobile-window-exit-switch 0.25s cubic-bezier(0.4, 0, 1, 1) forwards",
        };
      default:
        return {};
    }
  })();

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9010] bg-background flex flex-col"
      style={{ top: 28, bottom: 38, ...animStyle }}
    >
      {/* App content - no separate title bar, title is in the status bar */}
      <div className="flex-1 overflow-hidden relative">{win.node}</div>
    </div>
  );
}

export type { MobileWindowAnimState };
