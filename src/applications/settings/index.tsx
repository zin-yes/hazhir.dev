"use client";

import { useSession } from "@/auth/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClockFormat,
  getClockFormat,
  getWallpaperIndex,
  getWallpaperSlideshowEnabled,
  getWallpaperSlideshowIntervalMs,
  resetDesktopLayout,
  setClockFormat,
  setWallpaperIndex,
  setWallpaperSlideshowEnabled,
  setWallpaperSlideshowIntervalMs,
} from "@/lib/system-preferences";
import { getCurrentSystemUsername, getHomePath } from "@/lib/system-user";
import { WALLPAPERS } from "@/lib/wallpapers";
import { HardDrive, Monitor, User, Wallpaper } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type SettingsApplicationProps = {
  initialTab?: string;
};

const WALLPAPER_CHOICES = WALLPAPERS.map((wallpaper, index) => ({
  label: wallpaper.label,
  value: String(index),
  previewUrl: wallpaper.url,
}));

function normalizeInitialTab(initialTab?: string) {
  if (!initialTab) return "appearance";
  if (["appearance", "account", "system"].includes(initialTab)) {
    return initialTab;
  }
  if (initialTab === "options") return "appearance";
  return "appearance";
}

export default function SettingsApplication({
  initialTab,
}: SettingsApplicationProps) {
  const session = useSession();
  const [tab, setTab] = useState(normalizeInitialTab(initialTab));
  const [clockFormat, setClockFormatState] = useState<ClockFormat>("12h");
  const [wallpaperIndex, setWallpaperIndexState] = useState(0);
  const [slideshowEnabled, setSlideshowEnabledState] = useState(false);
  const [slideshowIntervalMs, setSlideshowIntervalMsState] = useState(30000);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    setClockFormatState(getClockFormat());
    setWallpaperIndexState(getWallpaperIndex(WALLPAPER_CHOICES.length));
    setSlideshowEnabledState(getWallpaperSlideshowEnabled());
    setSlideshowIntervalMsState(getWallpaperSlideshowIntervalMs());
  }, []);

  useEffect(() => {
    setTab(normalizeInitialTab(initialTab));
  }, [initialTab]);

  const userInfo = useMemo(() => {
    const current = session.data?.user as
      | { id?: string; name?: string; email?: string; username?: string }
      | undefined;

    return {
      name: current?.name || "Guest",
      email: current?.email || "guest@hazhir.local",
      username: current?.username || getCurrentSystemUsername(),
      userId: current?.id || "guest",
      homePath: getHomePath(),
      accountType: session.isGuest ? "Guest" : "Authenticated",
    };
  }, [session.data?.user, session.isGuest]);

  const systemInfo = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        platform: "Unknown",
        language: "Unknown",
        cpuThreads: "Unknown",
        memory: "Unknown",
        resolution: "Unknown",
        userAgent: "Unknown",
      };
    }

    const memory = (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory;

    return {
      platform: navigator.platform || "Unknown",
      language: navigator.language || "Unknown",
      cpuThreads: String(navigator.hardwareConcurrency || "Unknown"),
      memory: memory ? `${memory} GB` : "Unknown",
      resolution: `${window.screen.width} × ${window.screen.height}`,
      userAgent: navigator.userAgent,
    };
  }, []);

  return (
    <div className="h-full w-full bg-background text-foreground overflow-hidden">
      <div className="h-full flex flex-col rounded-xl border bg-card/60">
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex-1 min-h-0 p-3"
          orientation="vertical"
        >
          <div className="flex flex-1 h-full min-h-0 w-full gap-3">
            <TabsList className="w-32 sm:w-40 shrink-0" variant="line">
              <TabsTrigger value="appearance" className="text-xs">
                <Wallpaper className="size-3.5" />
                Appearance
              </TabsTrigger>
              <TabsTrigger value="account" className="text-xs">
                <User className="size-3.5" />
                Account
              </TabsTrigger>
              <TabsTrigger value="system" className="text-xs">
                <Monitor className="size-3.5" />
                System
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 min-h-0 min-w-0 w-full">
              <TabsContent
                value="appearance"
                className="h-full min-h-0 w-full overflow-auto space-y-3"
              >
                <Card className="w-full">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm">
                      Desktop appearance
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Changes apply immediately.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 p-4 pt-2 grid-cols-1">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Wallpaper</Label>
                      <Select
                        value={String(wallpaperIndex)}
                        onValueChange={(value) => {
                          const nextIndex = Number(value);
                          setWallpaperIndex(nextIndex);
                          setWallpaperIndexState(nextIndex);
                          setStatusMessage("Wallpaper updated.");
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select wallpaper" />
                        </SelectTrigger>
                        <SelectContent>
                          {WALLPAPER_CHOICES.map((choice) => (
                            <SelectItem key={choice.value} value={choice.value}>
                              {choice.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="relative h-40 w-full overflow-hidden rounded-md border bg-muted/30">
                        <Image
                          src={
                            WALLPAPER_CHOICES[wallpaperIndex]?.previewUrl ??
                            WALLPAPER_CHOICES[0].previewUrl
                          }
                          alt={
                            WALLPAPER_CHOICES[wallpaperIndex]?.label ??
                            "Wallpaper preview"
                          }
                          fill
                          sizes="(max-width: 768px) 100vw, 600px"
                          className="object-cover object-center"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {WALLPAPER_CHOICES.map((choice) => {
                          const isActive =
                            Number(choice.value) === wallpaperIndex;

                          return (
                            <button
                              key={choice.value}
                              type="button"
                              aria-label={`Set wallpaper to ${choice.label}`}
                              onClick={() => {
                                const nextIndex = Number(choice.value);
                                setWallpaperIndex(nextIndex);
                                setWallpaperIndexState(nextIndex);
                                setStatusMessage("Wallpaper updated.");
                              }}
                              className={`relative h-14 w-full overflow-hidden rounded-md border bg-muted/30 transition-colors ${
                                isActive
                                  ? "border-primary"
                                  : "border-border hover:border-primary/60"
                              }`}
                              title={choice.label}
                            >
                              <Image
                                src={choice.previewUrl}
                                alt={choice.label}
                                fill
                                sizes="(max-width: 640px) 30vw, 120px"
                                className="object-cover object-center"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Clock format</Label>
                      <Select
                        value={clockFormat}
                        onValueChange={(value) => {
                          const nextFormat = (
                            value === "24h" ? "24h" : "12h"
                          ) as ClockFormat;
                          setClockFormat(nextFormat);
                          setClockFormatState(nextFormat);
                          setStatusMessage("Clock format updated.");
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select clock format" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="12h">12-hour</SelectItem>
                          <SelectItem value="24h">24-hour</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Slideshow mode</Label>
                      <Select
                        value={slideshowEnabled ? "on" : "off"}
                        onValueChange={(value) => {
                          const enabled = value === "on";
                          setWallpaperSlideshowEnabled(enabled);
                          setSlideshowEnabledState(enabled);
                          setStatusMessage(
                            enabled
                              ? "Wallpaper slideshow enabled."
                              : "Wallpaper slideshow disabled.",
                          );
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">Off</SelectItem>
                          <SelectItem value="on">On</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Slideshow interval</Label>
                      <Select
                        value={String(slideshowIntervalMs)}
                        onValueChange={(value) => {
                          const nextIntervalMs = Number(value);
                          setWallpaperSlideshowIntervalMs(nextIntervalMs);
                          setSlideshowIntervalMsState(nextIntervalMs);
                          setStatusMessage("Slideshow interval updated.");
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select interval" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="15000">15 seconds</SelectItem>
                          <SelectItem value="30000">30 seconds</SelectItem>
                          <SelectItem value="60000">1 minute</SelectItem>
                          <SelectItem value="300000">5 minutes</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                <Card className="w-full">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm">Desktop icons</CardTitle>
                    <CardDescription className="text-xs">
                      Reset icon positions for this user.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        resetDesktopLayout();
                        setStatusMessage("Desktop icon layout reset.");
                      }}
                    >
                      Reset layout
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent
                value="account"
                className="h-full min-h-0 w-full overflow-auto space-y-3"
              >
                <Card className="w-full">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm">User information</CardTitle>
                    <CardDescription className="text-xs">
                      Active session details.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2.5 text-xs p-4 pt-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Name</span>
                      <span>{userInfo.name}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Email</span>
                      <span className="truncate">{userInfo.email}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Username</span>
                      <span>{userInfo.username}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">User ID</span>
                      <span className="truncate">{userInfo.userId}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Home</span>
                      <span className="truncate">{userInfo.homePath}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Account</span>
                      <Badge variant="outline" className="text-[10px]">
                        {userInfo.accountType}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent
                value="system"
                className="h-full min-h-0 w-full overflow-auto space-y-3"
              >
                <Card className="w-full">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm">System specs</CardTitle>
                    <CardDescription className="text-xs">
                      Current browser environment.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2.5 text-xs p-4 pt-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Platform</span>
                      <span>{systemInfo.platform}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Language</span>
                      <span>{systemInfo.language}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">CPU threads</span>
                      <span>{systemInfo.cpuThreads}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Memory</span>
                      <span>{systemInfo.memory}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Resolution</span>
                      <span>{systemInfo.resolution}</span>
                    </div>
                    <Separator />
                    <div className="space-y-1">
                      <p className="text-muted-foreground">User agent</p>
                      <p className="break-all text-[11px] text-foreground/80">
                        {systemInfo.userAgent}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="w-full">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm">Storage</CardTitle>
                    <CardDescription className="text-xs">
                      Environment status.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs p-4 pt-2">
                    <div className="flex items-center gap-2">
                      <HardDrive className="size-3.5 text-muted-foreground" />
                      <span>Local storage available</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <HardDrive className="size-3.5 text-muted-foreground" />
                      <span>Session storage available</span>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </div>
        </Tabs>

        {statusMessage ? (
          <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground truncate">
            {statusMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}
