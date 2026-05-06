"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      person_profiles: "always",
      capture_pageview: false,
      capture_dead_clicks: true,
      session_recording: {
        maskAllInputs: false,
        maskInputOptions: { password: true },
      },
    });
    // Session recording requires explicit consent — stopped by default until accepted
    posthog.stopSessionRecording();
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
