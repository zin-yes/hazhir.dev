"use client";

import {
  getWallpaperIndex,
  subscribeSystemPreferenceChanges,
} from "@/lib/system-preferences";
import { useEffect, useState } from "react";

export default function Wallpaper() {
  const imageURL = [
    "/wallpaper/eberhardgross.jpg",
    "/wallpaper/krisof.jpg",
    "/wallpaper/suissounet.jpg",
  ];

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const sync = () => {
      setSelectedIndex(getWallpaperIndex(imageURL.length));
    };

    sync();
    return subscribeSystemPreferenceChanges(sync);
  }, [imageURL.length]);

  return (
    <div
      className="w-screen h-screen absolute top-0 bottom-0 left-0 right-0 overflow-hidden bg-center bg-no-repeat"
      style={{
        backgroundImage: `url("${imageURL[selectedIndex]}")`,
        backgroundSize: "cover",
      }}
    ></div>
  );
}
