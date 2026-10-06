import type { ReactNode } from "react";
import { DitherVeil } from "../pixel/dither-veil";
import { uiEventProps } from "../ui-profiling";
import { useProfiledRender } from "../use-profiled-render";

interface MenuBackdropProps {
  children: ReactNode;
  onBackdropClick?: () => void;
  /** Dither the game behind the menu instead of leaving it fully visible. */
  withVeil?: boolean;
  /** Profiler surface that DOM events reaching this backdrop are counted under. */
  surfaceName?: string;
}

/** Scrollable, centered column that hosts a menu's panels. */
export function MenuBackdrop({
  children,
  onBackdropClick,
  withVeil = false,
  surfaceName,
}: MenuBackdropProps) {
  useProfiledRender("menuBackdrop");
  const closeWhenBackdropClicked = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) onBackdropClick?.();
  };

  return (
    <div
      data-mobile-ui
      className="absolute inset-0 z-40 flex flex-col items-center overflow-y-auto p-4 sm:p-8"
      onClick={closeWhenBackdropClicked}
      {...(surfaceName ? uiEventProps(surfaceName) : undefined)}
    >
      {withVeil && <DitherVeil />}
      <div
        className="relative my-auto flex w-full flex-col items-center gap-5"
        onClick={closeWhenBackdropClicked}
      >
        {children}
      </div>
    </div>
  );
}
