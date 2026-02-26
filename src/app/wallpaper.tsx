"use client";

import {
  getWallpaperIndex,
  getWallpaperSlideshowEnabled,
  getWallpaperSlideshowIntervalMs,
  setWallpaperIndex,
  subscribeSystemPreferenceChanges,
} from "@/lib/system-preferences";
import { WALLPAPERS } from "@/lib/wallpapers";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export default function Wallpaper() {
  const imageURL = WALLPAPERS.map((wallpaper) => wallpaper.url);
  const fadeDurationMs = 900;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [slideshowEnabled, setSlideshowEnabled] = useState(false);
  const [slideshowIntervalMs, setSlideshowIntervalMs] = useState(30000);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [showActive, setShowActive] = useState(true);
  const fadeTimeoutRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => {
      setSelectedIndex(getWallpaperIndex(imageURL.length));
      setSlideshowEnabled(getWallpaperSlideshowEnabled());
      setSlideshowIntervalMs(getWallpaperSlideshowIntervalMs());
    };

    sync();
    return subscribeSystemPreferenceChanges(sync);
  }, [imageURL.length]);

  useEffect(() => {
    if (!slideshowEnabled || imageURL.length < 2) return;

    const timer = window.setInterval(() => {
      setSelectedIndex((current) => {
        const next = (current + 1) % imageURL.length;
        setWallpaperIndex(next);
        return next;
      });
    }, slideshowIntervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [imageURL.length, slideshowEnabled, slideshowIntervalMs]);

  useEffect(() => {
    if (selectedIndex === activeIndex) return;

    if (fadeTimeoutRef.current !== null) {
      window.clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    setPreviousIndex(activeIndex);
    setActiveIndex(selectedIndex);
    setShowActive(false);

    frameRef.current = window.requestAnimationFrame(() => {
      setShowActive(true);
    });

    fadeTimeoutRef.current = window.setTimeout(() => {
      setPreviousIndex(null);
      fadeTimeoutRef.current = null;
    }, fadeDurationMs);
  }, [activeIndex, selectedIndex]);

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current !== null) {
        window.clearTimeout(fadeTimeoutRef.current);
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <div className="w-screen h-screen absolute top-0 bottom-0 left-0 right-0 overflow-hidden">
      {previousIndex !== null && (
        <Image
          key={`wallpaper-prev-${imageURL[previousIndex]}`}
          src={imageURL[previousIndex]}
          alt="Previous desktop wallpaper"
          fill
          sizes="100vw"
          className={`object-cover object-center transition-opacity duration-900 ${
            showActive ? "opacity-0" : "opacity-100"
          }`}
        />
      )}

      <Image
        key={`wallpaper-active-${imageURL[activeIndex]}`}
        src={imageURL[activeIndex]}
        alt="Desktop wallpaper"
        fill
        priority
        sizes="100vw"
        className={`object-cover object-center transition-opacity duration-900 ${
          previousIndex === null
            ? "opacity-100"
            : showActive
              ? "opacity-100"
              : "opacity-0"
        }`}
      />
    </div>
  );
}
