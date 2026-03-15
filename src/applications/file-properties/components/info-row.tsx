"use client";

import { cn } from "@/lib/utils";

/**
 * A labeled property row used throughout the file properties panel.
 * Displays a label (with optional icon) and a value in a bordered card style.
 */
export default function InfoRow({
  label,
  value,
  icon,
  mono,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-background/50 px-2.5 py-2">
      <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        {icon ? <span className="inline-flex">{icon}</span> : null}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "mt-0.5 text-xs text-foreground break-words",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </div>
    </div>
  );
}
