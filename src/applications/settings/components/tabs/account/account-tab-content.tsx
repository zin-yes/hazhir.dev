"use client";

import ScrollMoreButton from "@/components/system/scroll-more-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { UserAccountInformation } from "@/applications/settings/logic/use-settings-state";
import { useRef } from "react";

type AccountTabContentProps = {
  userAccountInformation: UserAccountInformation;
};

/**
 * Account tab — displays the current user's session details
 * including name, email, username, user ID, home directory, and account type.
 */
export default function AccountTabContent({
  userAccountInformation,
}: AccountTabContentProps) {
  const scrollContainerReference = useRef<HTMLDivElement | null>(null);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div
        ref={scrollContainerReference}
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
              <span>{userAccountInformation.name}</span>
            </div>
            <Separator />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Email</span>
              <span className="truncate">
                {userAccountInformation.email}
              </span>
            </div>
            <Separator />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Username</span>
              <span>{userAccountInformation.username}</span>
            </div>
            <Separator />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">User ID</span>
              <span className="truncate">
                {userAccountInformation.userId}
              </span>
            </div>
            <Separator />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Home</span>
              <span className="truncate">
                {userAccountInformation.homePath}
              </span>
            </div>
            <Separator />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Account</span>
              <Badge variant="outline" className="text-[10px]">
                {userAccountInformation.accountType}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
      <ScrollMoreButton scrollElementRef={scrollContainerReference} />
    </div>
  );
}
