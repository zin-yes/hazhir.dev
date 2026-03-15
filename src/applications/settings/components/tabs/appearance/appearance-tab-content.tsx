"use client";

import { WALLPAPER_CHOICES } from "@/applications/settings/logic/use-settings-state";
import ScrollMoreButton from "@/components/system/scroll-more-button";
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
import { ClockFormat } from "@/lib/system-preferences";
import Image from "next/image";
import { useRef } from "react";

type WallpaperPickerWidgetProps = {
  selectedWallpaperIndex: number;
  onWallpaperSelected: (nextIndex: number) => void;
};

/** Grid of wallpaper thumbnails with a large preview for the active selection. */
function WallpaperPickerWidget({
  selectedWallpaperIndex,
  onWallpaperSelected,
}: WallpaperPickerWidgetProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Wallpaper</Label>
      <Select
        value={String(selectedWallpaperIndex)}
        onValueChange={(value) => onWallpaperSelected(Number(value))}
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

      {/* Large preview of the currently selected wallpaper */}
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-md border bg-muted/30">
        <Image
          src={
            WALLPAPER_CHOICES[selectedWallpaperIndex]?.previewUrl ??
            WALLPAPER_CHOICES[0].previewUrl
          }
          alt={
            WALLPAPER_CHOICES[selectedWallpaperIndex]?.label ??
            "Wallpaper preview"
          }
          fill
          sizes="(max-width: 768px) 100vw, 600px"
          className="object-cover object-center"
        />
      </div>

      {/* Thumbnail grid for quick wallpaper selection */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        {WALLPAPER_CHOICES.map((choice) => {
          const isActiveWallpaper =
            Number(choice.value) === selectedWallpaperIndex;

          return (
            <button
              key={choice.value}
              type="button"
              aria-label={`Set wallpaper to ${choice.label}`}
              onClick={() => onWallpaperSelected(Number(choice.value))}
              className={`relative aspect-[16/9] w-full overflow-hidden rounded-md border bg-muted/30 transition-colors ${
                isActiveWallpaper
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
  );
}

type ClockFormatWidgetProps = {
  clockFormatPreference: ClockFormat;
  onClockFormatChanged: (nextFormat: ClockFormat) => void;
};

/** Dropdown to choose between 12-hour and 24-hour clock formats. */
function ClockFormatWidget({
  clockFormatPreference,
  onClockFormatChanged,
}: ClockFormatWidgetProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Clock format</Label>
      <Select
        value={clockFormatPreference}
        onValueChange={(value) => {
          const nextFormat = (value === "24h" ? "24h" : "12h") as ClockFormat;
          onClockFormatChanged(nextFormat);
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
  );
}

type SlideshowSettingsWidgetProps = {
  isSlideshowEnabled: boolean;
  slideshowIntervalMilliseconds: number;
  onSlideshowToggled: (enabled: boolean) => void;
  onSlideshowIntervalChanged: (nextIntervalMilliseconds: number) => void;
};

/** Controls for enabling/disabling wallpaper slideshow and setting its interval. */
function SlideshowSettingsWidget({
  isSlideshowEnabled,
  slideshowIntervalMilliseconds,
  onSlideshowToggled,
  onSlideshowIntervalChanged,
}: SlideshowSettingsWidgetProps) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Slideshow mode</Label>
        <Select
          value={isSlideshowEnabled ? "on" : "off"}
          onValueChange={(value) => onSlideshowToggled(value === "on")}
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
          value={String(slideshowIntervalMilliseconds)}
          onValueChange={(value) => onSlideshowIntervalChanged(Number(value))}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select interval" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={String(60 * 5 * 1000)}>5 minutes</SelectItem>
            <SelectItem value={String(60 * 10 * 1000)}>10 minutes</SelectItem>
            <SelectItem value={String(60 * 15 * 1000)}>15 minutes</SelectItem>
            <SelectItem value={String(60 * 30 * 1000)}>30 minutes</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

type DesktopIconsResetWidgetProps = {
  onDesktopLayoutReset: () => void;
};

/** Button to reset the desktop icon layout to its default positions. */
function DesktopIconsResetWidget({
  onDesktopLayoutReset,
}: DesktopIconsResetWidgetProps) {
  return (
    <Card className="w-full">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Desktop icons</CardTitle>
        <CardDescription className="text-xs">
          Reset icon positions for this user.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <Button size="sm" variant="secondary" onClick={onDesktopLayoutReset}>
          Reset layout
        </Button>
      </CardContent>
    </Card>
  );
}

type AppearanceTabContentProps = {
  selectedWallpaperIndex: number;
  clockFormatPreference: ClockFormat;
  isSlideshowEnabled: boolean;
  slideshowIntervalMilliseconds: number;
  onWallpaperSelected: (nextIndex: number) => void;
  onClockFormatChanged: (nextFormat: ClockFormat) => void;
  onSlideshowToggled: (enabled: boolean) => void;
  onSlideshowIntervalChanged: (nextIntervalMilliseconds: number) => void;
  onDesktopLayoutReset: () => void;
};

/**
 * Appearance tab - contains all visual preference widgets:
 * wallpaper picker, clock format, slideshow settings, and desktop icon reset.
 */
export default function AppearanceTabContent({
  selectedWallpaperIndex,
  clockFormatPreference,
  isSlideshowEnabled,
  slideshowIntervalMilliseconds,
  onWallpaperSelected,
  onClockFormatChanged,
  onSlideshowToggled,
  onSlideshowIntervalChanged,
  onDesktopLayoutReset,
}: AppearanceTabContentProps) {
  const scrollContainerReference = useRef<HTMLDivElement | null>(null);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div
        ref={scrollContainerReference}
        className="h-full min-h-0 w-full overflow-auto space-y-3"
      >
        <Card className="w-full">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Desktop appearance</CardTitle>
            <CardDescription className="text-xs">
              Changes apply immediately.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 pt-2 grid-cols-1">
            <WallpaperPickerWidget
              selectedWallpaperIndex={selectedWallpaperIndex}
              onWallpaperSelected={onWallpaperSelected}
            />
            <ClockFormatWidget
              clockFormatPreference={clockFormatPreference}
              onClockFormatChanged={onClockFormatChanged}
            />
            <SlideshowSettingsWidget
              isSlideshowEnabled={isSlideshowEnabled}
              slideshowIntervalMilliseconds={slideshowIntervalMilliseconds}
              onSlideshowToggled={onSlideshowToggled}
              onSlideshowIntervalChanged={onSlideshowIntervalChanged}
            />
          </CardContent>
        </Card>

        <DesktopIconsResetWidget onDesktopLayoutReset={onDesktopLayoutReset} />
      </div>
      <ScrollMoreButton scrollElementRef={scrollContainerReference} />
    </div>
  );
}
