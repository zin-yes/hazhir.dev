"use client";

import React, {
  cloneElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import Image from "next/image";

import { hasFileDragType } from "@/lib/file-transfer-dnd";
import styles from "./application-window.module.css";

import { ApplicationWindowType } from "@/hooks/use-operating-system";
import {
  addBottomResizeHandleEvent,
  addDraggingHandleEvent,
  addLeftResizeHandleEvent,
  addRightResizeHandleEvent,
  addTopResizeHandleEvent,
} from "@/operating-system/application/window/resizability";
import { AppWindowIcon, Maximize2, Minimize2, X } from "lucide-react";
import { v4 } from "uuid";

// TODO: Add a way to have "system" configs (e.g. desktop 'wallpaper', accent color, text size/scaling options).
// TODO: Refactor this into a class and split the repeatable chunks of logic up into other files.
// TODO: Clean up the code and make it more understandable and concise if possible.
// TODO: Add a robust way to add more control variables & also add more control variables on the props:
//  - Starting x & y positions.
//  - Color customizations.
//  - ...
// TODO: Change padding of action bar to match the window and add a system to keep that consistent across the system.

// TODO: Rewrite window system to be more centralized.

class ApplicationErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  state: { hasError: boolean; error?: Error } = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("Application window error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-background text-foreground p-6">
          <div className="text-lg font-semibold">Something went wrong</div>
          <div className="text-sm text-muted-foreground mt-2 text-center">
            This application failed to load. Try closing and reopening the
            window.
          </div>
          {this.state.error?.message ? (
            <div className="mt-3 text-xs text-muted-foreground break-all text-center">
              {this.state.error.message}
            </div>
          ) : null}
        </div>
      );
    }

    return this.props.children;
  }
}

export default function ApplicationWindow({
  identifier,
  type,
  children,
  className,
  action_bar = {},
  settings = {
    starting_width: 400,
    starting_height: 400,
    min_height: 10,
    min_width: 10,
    allow_overflow: true,
  },
}: {
  identifier?: string;
  type?: ApplicationWindowType;
  children?: React.ReactNode;
  className?: string;
  action_bar?: {
    icon?: {
      src?: string;
      svg?: React.ReactElement<any>;
    };
    title?: string;
  };
  settings?: {
    min_width?: number;
    min_height?: number;
    starting_width?: number;
    starting_height?: number;
    allow_overflow?: boolean;
  };
}) {
  let maximized = false;
  const isFirefox =
    typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);
  const bodyId = useId();
  const titleId = useId();
  const _identifier = useMemo<string>(() => v4(), []);

  const ref = useRef<HTMLDivElement>(null);
  const fileDropHoverDepthRef = useRef(0);
  const [isFileDropHover, setIsFileDropHover] = useState(false);
  // Center the pane element.
  useEffect(() => {
    if (ref.current) {
      focusPane();
      ref.current.id = identifier ?? _identifier;
      ref.current.setAttribute("applicationType", type ?? "UNDEFINED");
      setTimeout(() => {
        center();
      }, 300);

      ref.current.addEventListener("mousedown", () => {
        focusPane();
      });
      ref.current.addEventListener("pointerdown", () => {
        focusPane();
      });
    }
  }, [ref]);

  // Add resize and drag functionality to pane.
  useEffect(() => {
    if (ref.current) {
      ref.current.style.width = `${settings.starting_width!}px`;
      ref.current.style.height = `${settings.starting_height!}px`;

      const titleElement = ref.current.getElementsByClassName(
        styles.title,
      )[0] as HTMLDivElement;
      const rightResizeHandleElement = ref.current.getElementsByClassName(
        styles.right_resize_handle,
      )[0] as HTMLDivElement;
      const leftResizeHandleElement = ref.current.getElementsByClassName(
        styles.left_resize_handle,
      )[0] as HTMLDivElement;
      const topResizeHandleElement = ref.current.getElementsByClassName(
        styles.top_resize_handle,
      )[0] as HTMLDivElement;
      const bottomResizeHandleElement = ref.current.getElementsByClassName(
        styles.bottom_resize_handle,
      )[0] as HTMLDivElement;
      const bottomRightResizeHandleElement = ref.current.getElementsByClassName(
        styles.bottom_right_resize_handle,
      )[0] as HTMLDivElement;
      const topRightResizeHandleElement = ref.current.getElementsByClassName(
        styles.top_right_resize_handle,
      )[0] as HTMLDivElement;
      const bottomLeftResizeHandleElement = ref.current.getElementsByClassName(
        styles.bottom_left_resize_handle,
      )[0] as HTMLDivElement;
      const topLeftResizeHandleElement = ref.current.getElementsByClassName(
        styles.top_left_resize_handle,
      )[0] as HTMLDivElement;

      // Set up resize functionality for right resize handle.
      addRightResizeHandleEvent(
        rightResizeHandleElement,
        ref.current,
        settings.min_width!,
      );

      // Set up resize functionality for bottom right resize handle.
      addBottomResizeHandleEvent(
        bottomRightResizeHandleElement,
        ref.current,
        settings.min_height!,
      );
      addRightResizeHandleEvent(
        bottomRightResizeHandleElement,
        ref.current,
        settings.min_width!,
      );

      // Set up resize functionality for top right resize handle.
      addTopResizeHandleEvent(
        topRightResizeHandleElement,
        ref.current,
        settings.min_height!,
      );
      addRightResizeHandleEvent(
        topRightResizeHandleElement,
        ref.current,
        settings.min_width!,
      );

      // Set up resize functionality for left resize handle.
      addLeftResizeHandleEvent(
        leftResizeHandleElement,
        ref.current,
        settings.min_width!,
      );

      // Set up resize functionality for bottom left resize handle.
      addBottomResizeHandleEvent(
        bottomLeftResizeHandleElement,
        ref.current,
        settings.min_height!,
      );
      addLeftResizeHandleEvent(
        bottomLeftResizeHandleElement,
        ref.current,
        settings.min_width!,
      );

      // Set up resize functionality for top left resize handle.
      addTopResizeHandleEvent(
        topLeftResizeHandleElement,
        ref.current,
        settings.min_height!,
      );
      addLeftResizeHandleEvent(
        topLeftResizeHandleElement,
        ref.current,
        settings.min_width!,
      );

      // Set up resize functionality for bottom resize handle.
      addBottomResizeHandleEvent(
        bottomResizeHandleElement,
        ref.current,
        settings.min_height!,
      );

      // Set up resize functionality for top resize handle.
      addTopResizeHandleEvent(
        topResizeHandleElement,
        ref.current,
        settings.min_height!,
      );

      // Dragging handle for the pane.
      addDraggingHandleEvent(titleElement, ref.current);
    }
  }, [
    ref,
    settings.min_width!,
    settings.min_height!,
    settings.starting_width!,
    settings.starting_height!,
    titleId,
  ]);

  const maximize = () => {
    if (!maximized && ref.current) {
      ref.current.style.transition = "0.7s";
      ref.current.style.left = "-12px";
      ref.current.style.top = "-12px";
      ref.current.style.width = "calc(100% + 24px)";
      ref.current.style.height = "calc(100% + 4px)";
      ref.current.style.borderRadius = "0";
      (
        ref.current.getElementsByClassName(styles.body)[0] as HTMLDivElement
      ).style.borderRadius = "0em";
      maximized = true;

      setTimeout(() => {
        if (ref.current) ref.current.style.transition = "";
      }, 700);

      const titleElement = ref.current.getElementsByClassName(
        styles.title,
      )[0] as HTMLDivElement;
      if (titleElement) {
        titleElement.style.pointerEvents = "none";
      }
    } else {
      if (ref.current) {
        ref.current.style.transition = "0.7s";

        ref.current.style.width = `${settings.starting_width}px`;
        ref.current.style.height = `${settings.starting_height}px`;
        ref.current.style.top = `${
          window.innerHeight / 2 - settings.starting_height! / 2
        }px`;
        ref.current.style.left = `${
          window.innerWidth / 2 - settings.starting_width! / 2
        }px`;

        setTimeout(() => {
          if (ref.current) ref.current.style.transition = "";
        }, 700);

        (
          ref.current.getElementsByClassName(styles.body)[0] as HTMLDivElement
        ).style.borderRadius = "0.7em";

        const titleElement = ref.current.getElementsByClassName(
          styles.title,
        )[0] as HTMLDivElement;
        if (titleElement) {
          titleElement.style.pointerEvents = "";
          addDraggingHandleEvent(titleElement, ref.current);
        }
        maximized = false;
      }
    }
  };

  function getTopElement(a: HTMLElement, b: HTMLElement) {
    const aIndex = getZIndex(a);
    const bIndex = getZIndex(b);
    return aIndex > bIndex ? a : b;
  }

  function getZIndex(element: Element): number {
    if (document.defaultView) {
      const zIndex = document.defaultView
        .getComputedStyle(element)
        .getPropertyValue("z-index");
      return isNaN(Number(zIndex)) ? 0 : Number(zIndex);
    }
    return 0;
  }

  const focusPane = () => {
    if (ref.current) {
      const applicationWindowElements =
        document.getElementsByClassName("applicationWindow");

      // Collect all windows with their current z-indexes
      const windows: { element: HTMLDivElement; zIndex: number }[] = [];
      for (let i = 0; i < applicationWindowElements.length; i++) {
        const element = applicationWindowElements[i] as HTMLDivElement;
        const currentZ = Number(element.style.zIndex) || 0;
        windows.push({ element, zIndex: currentZ });
      }

      // Sort by current z-index
      windows.sort((a, b) => a.zIndex - b.zIndex);

      // Reassign z-indexes starting from 1, keeping the order
      // This keeps all windows in the range 1-N where N is the number of windows
      windows.forEach((window, index) => {
        const bodyElement = window.element.getElementsByClassName(
          styles.body,
        )[0] as HTMLDivElement;
        bodyElement.classList.remove(styles.pane_in_focus);
        bodyElement.style.filter = isFirefox
          ? "brightness(80%)"
          : "blur(1px) brightness(80%)";

        // Assign z-index based on position in sorted array
        // But if it's the current window, it gets the highest
        if (window.element === ref.current) {
          window.element.style.zIndex = String(windows.length);
        } else if (
          index >=
          windows.indexOf(windows.find((w) => w.element === ref.current)!)
        ) {
          // Shift down windows that were above the current one
          window.element.style.zIndex = String(index);
        } else {
          window.element.style.zIndex = String(index + 1);
        }
      });

      // Focus the current window
      const thisPanesBodyElement = ref.current.getElementsByClassName(
        styles.body,
      )[0] as HTMLDivElement;

      if (!thisPanesBodyElement.classList.contains(styles.pane_in_focus)) {
        thisPanesBodyElement.classList.add(styles.pane_in_focus);
        thisPanesBodyElement.style.filter = "";
      }

      // Set current window to highest z-index (number of windows)
      ref.current.style.zIndex = String(windows.length);
    }
  };

  const close = () => {
    if (ref.current) {
      ref.current.style.opacity = "0";
      ref.current.style.transform = "scale(0)";
      setTimeout(() => {
        if (ref.current) {
          const parent = ref.current.parentElement;
          if (parent?.contains(ref.current)) {
            parent.removeChild(ref.current);
          }
        }
      }, 600);
      const applicationWindowElements =
        document.getElementsByClassName("applicationWindow");

      let topPane: HTMLDivElement | undefined;
      for (let i = 0; i < applicationWindowElements.length; i++) {
        const item = applicationWindowElements[i];
        if (item.id === identifier) continue;

        if (!topPane) topPane = item as HTMLDivElement;

        if (getTopElement(topPane, item as HTMLDivElement) === item)
          topPane = item as HTMLDivElement;
      }

      if (topPane) {
        const topPanesBodyElement = topPane.getElementsByClassName(
          styles.body,
        )[0] as HTMLDivElement;

        if (!topPanesBodyElement.classList.contains(styles.pane_in_focus)) {
          topPanesBodyElement.classList.add(styles.pane_in_focus);
          topPanesBodyElement.style.filter = "";
        }
      }
    }
  };

  const center = () => {
    if (ref.current) {
      ref.current.style.transition = "0.7s";
      ref.current.style.top =
        (window.innerHeight - ref.current.clientHeight) / 2 + "px";
      ref.current.style.left =
        (window.innerWidth - ref.current.clientWidth) / 2 + "px";
      ref.current.style.opacity = "1";

      setTimeout(() => {
        if (ref.current) {
          ref.current.style.transition = "";
        }
      }, 700);
    }
  };

  return (
    <div
      ref={ref}
      className={
        styles.pane +
        " applicationWindow " +
        (isFileDropHover ? styles.file_drop_hover : "")
      }
      onDragEnterCapture={(event) => {
        if (!hasFileDragType(event.dataTransfer)) return;
        fileDropHoverDepthRef.current += 1;
        setIsFileDropHover(true);
      }}
      onDragOverCapture={(event) => {
        if (!hasFileDragType(event.dataTransfer)) return;
        setIsFileDropHover(true);
      }}
      onDragLeaveCapture={(event) => {
        if (!hasFileDragType(event.dataTransfer)) return;
        fileDropHoverDepthRef.current = Math.max(
          0,
          fileDropHoverDepthRef.current - 1,
        );
        if (fileDropHoverDepthRef.current === 0) {
          setIsFileDropHover(false);
        }
      }}
      onDropCapture={() => {
        fileDropHoverDepthRef.current = 0;
        setIsFileDropHover(false);
      }}
      onDragEndCapture={() => {
        fileDropHoverDepthRef.current = 0;
        setIsFileDropHover(false);
      }}
    >
      <div className={styles.top_group}>
        <div className={styles.top_left_resize_handle}></div>
        <div className={styles.top_resize_handle}></div>
        <div className={styles.top_right_resize_handle}></div>
      </div>
      <div className={styles.middle_group}>
        <div className={styles.left_resize_handle}></div>
        <div className={styles.body + " bg-primary"} id={bodyId}>
          <div className={styles.titlebar}>
            <div className={styles.title + " text-base "} id={titleId}>
              {action_bar.icon && action_bar.icon.src ? (
                <Image
                  className={styles.icon}
                  src={action_bar.icon.src}
                  width={14}
                  height={14}
                  alt="Pane icon."
                />
              ) : action_bar.icon && action_bar.icon.svg ? (
                cloneElement(action_bar.icon.svg, { size: 20 })
              ) : (
                <AppWindowIcon size={20} />
              )}
              <span className={styles.titleText}>
                {action_bar.title ?? "Untitled pane"}
              </span>
            </div>
            <div className={styles.actions}>
              {/* <div className={styles.minimize}></div> */}
              <div
                className={styles.maximize}
                onClick={() => {
                  maximize();
                }}
              >
                {maximized ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
              </div>
              <div
                className={styles.close}
                onClick={() => {
                  close();
                }}
              >
                <X size={20} />
              </div>
            </div>
          </div>
          <div
            className={
              styles.content +
              " rounded-t-xl " +
              className +
              (settings.allow_overflow! ? "overflow_allowed" : "")
            }
          >
            {children}
          </div>
        </div>
        <div className={styles.right_resize_handle}></div>
      </div>
      <div className={styles.bottom_group}>
        <div className={styles.bottom_left_resize_handle}></div>
        <div className={styles.bottom_resize_handle}></div>
        <div className={styles.bottom_right_resize_handle}></div>
      </div>
    </div>
  );
}
