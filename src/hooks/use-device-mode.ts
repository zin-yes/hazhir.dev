"use client";

import { useEffect, useState } from "react";

export type DeviceMode = "mobile" | "tablet" | "desktop";

const MOBILE_MAX = 640;
const TABLET_MAX = 1024;

function getDeviceMode(width: number): DeviceMode {
  if (width < MOBILE_MAX) return "mobile";
  if (width < TABLET_MAX) return "tablet";
  return "desktop";
}

export function useDeviceMode(): DeviceMode {
  const [mode, setMode] = useState<DeviceMode>("desktop");

  useEffect(() => {
    const update = () => setMode(getDeviceMode(window.innerWidth));
    update();

    const mqlMobile = window.matchMedia(`(max-width: ${MOBILE_MAX - 1}px)`);
    const mqlTablet = window.matchMedia(`(max-width: ${TABLET_MAX - 1}px)`);

    const onChange = () => update();
    mqlMobile.addEventListener("change", onChange);
    mqlTablet.addEventListener("change", onChange);

    return () => {
      mqlMobile.removeEventListener("change", onChange);
      mqlTablet.removeEventListener("change", onChange);
    };
  }, []);

  return mode;
}

export function useIsMobileOrTablet(): boolean {
  const mode = useDeviceMode();
  return mode === "mobile" || mode === "tablet";
}
