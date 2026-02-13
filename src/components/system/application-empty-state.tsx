"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

type ApplicationEmptyStateProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export default function ApplicationEmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  className,
}: ApplicationEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center p-6",
        className,
      )}
    >
      <div className="w-full max-w-xl rounded-2xl border border-border/60 bg-background/80 p-8 shadow-xl backdrop-blur-sm">
        <div className="flex items-start gap-4">
          {icon ? (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/50 text-foreground">
              {icon}
            </div>
          ) : null}
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </div>

        {actionLabel && onAction ? (
          <div className="mt-6">
            <Button onClick={onAction}>{actionLabel}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
