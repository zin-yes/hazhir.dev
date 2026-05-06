"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

const ARTICLE_PATHS = ["/atlas", "/hazhir-dev", "/metricjournal", "/gamma-engine"];
const LEGAL_PATHS = ["/privacy", "/terms", "/cookies"];

function getPageType(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname === "/cv") return "cv";
  if (ARTICLE_PATHS.includes(pathname)) return "article";
  if (LEGAL_PATHS.includes(pathname)) return "legal";
  return "other";
}

export function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posthog = usePostHog();

  useEffect(() => {
    if (pathname && posthog) {
      let url = window.origin + pathname;
      const search = searchParams.toString();
      if (search) url += `?${search}`;
      posthog.capture("$pageview", {
        $current_url: url,
        page_type: getPageType(pathname),
        referrer: document.referrer,
        ...(pathname === "/cv" && { is_cv_page: true }),
      });
    }
  }, [pathname, searchParams, posthog]);

  return null;
}
