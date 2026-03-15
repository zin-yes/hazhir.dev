"use client";

import type { SystemEnvironmentInformation } from "@/applications/settings/logic/use-settings-state";
import ScrollMoreButton from "@/components/system/scroll-more-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { HardDrive } from "lucide-react";
import { useRef } from "react";

type SystemTabContentProps = {
  systemEnvironmentInformation: SystemEnvironmentInformation;
};

/**
 * System tab - displays current browser environment specs
 * (platform, language, CPU threads, memory, resolution, user agent)
 * and storage availability status.
 */
export default function SystemTabContent({
  systemEnvironmentInformation,
}: SystemTabContentProps) {
  const scrollContainerReference = useRef<HTMLDivElement | null>(null);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div
        ref={scrollContainerReference}
        className="h-full min-h-0 w-full overflow-auto space-y-3"
      >
        {/* Hardware and browser environment card */}
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
              <span>{systemEnvironmentInformation.platform}</span>
            </div>
            <Separator />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Language</span>
              <span>{systemEnvironmentInformation.language}</span>
            </div>
            <Separator />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">CPU threads</span>
              <span>{systemEnvironmentInformation.cpuThreads}</span>
            </div>
            <Separator />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Memory</span>
              <span>{systemEnvironmentInformation.memory}</span>
            </div>
            <Separator />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Resolution</span>
              <span>{systemEnvironmentInformation.resolution}</span>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="text-muted-foreground">User agent</p>
              <p className="break-all text-[11px] text-foreground/80">
                {systemEnvironmentInformation.userAgent}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Storage availability card */}
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
      </div>
      <ScrollMoreButton scrollElementRef={scrollContainerReference} />
    </div>
  );
}
