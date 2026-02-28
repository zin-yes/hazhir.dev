"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { RefObject, useEffect, useState } from "react";

type ScrollMoreButtonProps = {
  scrollElementRef: RefObject<HTMLElement | null>;
  className?: string;
  iconClassName?: string;
  ariaLabel?: string;
  title?: string;
};

export default function ScrollMoreButton({
  scrollElementRef,
  className,
  iconClassName,
  ariaLabel = "Scroll down one page",
  title = "Page down",
}: ScrollMoreButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = scrollElementRef.current;
    if (!element) {
      setVisible(false);
      return;
    }

    const sync = () => {
      const hasOverflow = element.scrollHeight - element.clientHeight > 8;
      const isAtTop = element.scrollTop <= 2;
      setVisible(hasOverflow && isAtTop);
    };

    sync();

    element.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);

    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(element);

    const mutationObserver = new MutationObserver(sync);
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      element.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [scrollElementRef]);

  return (
    <button
      type="button"
      onClick={() => {
        const element = scrollElementRef.current;
        if (!element) return;

        element.scrollBy({
          top: Math.max(element.clientHeight - 48, 160),
          behavior: "smooth",
        });
      }}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-background/90 p-2 shadow-md backdrop-blur transition-opacity duration-150 ease-out hover:bg-accent hover:text-accent-foreground",
        visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
    >
      <ChevronDown className={cn("size-4", iconClassName)} />
    </button>
  );
}