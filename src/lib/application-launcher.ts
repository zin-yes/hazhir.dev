"use client";

export const OS_LAUNCH_APPLICATION_EVENT = "os-launch-application";

export type LaunchApplicationDetail = {
  appId: string;
  args?: string[];
};

export function requestLaunchApplication(appId: string, args?: string[]) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LaunchApplicationDetail>(OS_LAUNCH_APPLICATION_EVENT, {
      detail: { appId, args },
    })
  );
}
