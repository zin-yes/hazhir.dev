"use client";

import { cloneElement, useEffect, useId, useRef, useState } from "react";

import Image from "next/image";

import styles from "./pane.module.css";
import {
  add_right_resize_handle_event,
  add_left_resize_handle_event,
  add_top_resize_handle_event,
  add_bottom_resize_handle_event,
  add_dragging_handle_event,
} from "@/utils/resizability";
import { AppWindowIcon, Maximize2, Minimize2, X } from "lucide-react";

// TODO: Add a way to have "system" configs (e.g. desktop 'wallpaper', accent color, text size/scaling options).
// TODO: Refactor this into a class and split the repeatable chunks of logic up into other files.
// TODO: Clean up the code and make it more understandable and concise if possible.
// TODO: Add a robust way to add more control variables & also add more control variables on the props:
//  - Starting x & y positions.
//  - Color customizations.
//  - ...
// TODO: Change padding of action bar to match the window and add a system to keep that consistent across the system.

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const MIN_DEFAULT_DIMENSIONS = 400;

export default function Pane({
  children,
  className,
  action_bar = {},
  settings = {
    starting_width: DEFAULT_WIDTH,
    starting_height: DEFAULT_HEIGHT,
    allow_overflow: true,
  },
}: {
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
  const [maximized, setMaximized] = useState<boolean>(false);
  const bodyId = useId();
  const titleId = useId();

  const ref = useRef<HTMLDivElement>(null);
  // Center the pane element.
  useEffect(() => {
    if (ref.current) {
      setTimeout(() => {
        center();
      }, 300);

      ref.current.addEventListener("mousedown", () => {
        focusPane();
      });
    }
  }, [ref]);

  // Add resize and drag functionality to pane.
  useEffect(() => {
    if (ref.current) {
      ref.current.style.width = settings.starting_width + "px";
      ref.current.style.height = settings.starting_height + "px";
    }

    const title_element = document.getElementById(titleId)!;
    const right_resize_handle_element = ref.current!.getElementsByClassName(
      styles.right_resize_handle
    )[0];
    const left_resize_handle_element = ref.current!.getElementsByClassName(
      styles.left_resize_handle
    )[0];
    const top_resize_handle_element = ref.current!.getElementsByClassName(
      styles.top_resize_handle
    )[0];
    const bottom_resize_handle_element = ref.current!.getElementsByClassName(
      styles.bottom_resize_handle
    )[0];
    const bottom_right_resize_handle_element =
      ref.current!.getElementsByClassName(styles.bottom_right_resize_handle)[0];
    const top_right_resize_handle_element = ref.current!.getElementsByClassName(
      styles.top_right_resize_handle
    )[0];
    const bottom_left_resize_handle_element =
      ref.current!.getElementsByClassName(styles.bottom_left_resize_handle)[0];
    const top_left_resize_handle_element = ref.current!.getElementsByClassName(
      styles.top_left_resize_handle
    )[0];

    // Set up resize functionality for right resize handle.
    add_right_resize_handle_event(
      right_resize_handle_element,
      ref,
      settings.min_width!
    );

    // Set up resize functionality for bottom right resize handle.
    add_bottom_resize_handle_event(
      bottom_right_resize_handle_element,
      ref,
      settings.min_height ?? MIN_DEFAULT_DIMENSIONS
    );
    add_right_resize_handle_event(
      bottom_right_resize_handle_element,
      ref,
      settings.min_width ?? MIN_DEFAULT_DIMENSIONS
    );

    // Set up resize functionality for top right resize handle.
    add_top_resize_handle_event(
      top_right_resize_handle_element,
      ref,
      settings.min_height ?? MIN_DEFAULT_DIMENSIONS
    );
    add_right_resize_handle_event(
      top_right_resize_handle_element,
      ref,
      settings.min_width ?? MIN_DEFAULT_DIMENSIONS
    );

    // Set up resize functionality for left resize handle.
    add_left_resize_handle_event(
      left_resize_handle_element,
      ref,
      settings.min_width ?? MIN_DEFAULT_DIMENSIONS
    );

    // Set up resize functionality for bottom left resize handle.
    add_bottom_resize_handle_event(
      bottom_left_resize_handle_element,
      ref,
      settings.min_height ?? MIN_DEFAULT_DIMENSIONS
    );
    add_left_resize_handle_event(
      bottom_left_resize_handle_element,
      ref,
      settings.min_width ?? MIN_DEFAULT_DIMENSIONS
    );

    // Set up resize functionality for top left resize handle.
    add_top_resize_handle_event(
      top_left_resize_handle_element,
      ref,
      settings.min_height ?? MIN_DEFAULT_DIMENSIONS
    );
    add_left_resize_handle_event(
      top_left_resize_handle_element,
      ref,
      settings.min_width ?? MIN_DEFAULT_DIMENSIONS
    );

    // Set up resize functionality for bottom resize handle.
    add_bottom_resize_handle_event(
      bottom_resize_handle_element,
      ref,
      settings.min_height ?? MIN_DEFAULT_DIMENSIONS
    );

    // Set up resize functionality for top resize handle.
    add_top_resize_handle_event(
      top_resize_handle_element,
      ref,
      settings.min_height ?? MIN_DEFAULT_DIMENSIONS
    );

    // Dragging handle for the pane.
    add_dragging_handle_event(title_element, ref);
  }, [
    ref,
    settings.min_width,
    settings.min_height,
    settings.starting_width,
    settings.starting_height,
    titleId,
  ]);

  const maximize = () => {
    if (!maximized) {
      ref.current!.style.transition = "0.7s";
      ref.current!.style.left = "-12px";
      ref.current!.style.top = "-12px";
      ref.current!.style.width = "calc(100% + 24px)";
      ref.current!.style.height = "calc(100% + 4px)";
      (document.getElementById(bodyId) as HTMLDivElement).style.borderRadius =
        "0";
      setMaximized(true);

      setTimeout(() => {
        ref.current!.style.transition = "";
      }, 700);

      const title_element = ref.current!.getElementsByClassName(
        styles.title
      )[0] as HTMLDivElement;

      title_element.replaceWith(title_element.cloneNode(true));
    } else {
      ref.current!.style.transition = "0.7s";

      ref.current!.style.width = `${settings.starting_width}px`;
      ref.current!.style.height = `${settings.starting_height}px`;
      ref.current!.style.top = `${
        window.innerHeight / 2 - settings.starting_height! / 2
      }px`;
      ref.current!.style.left = `${
        window.innerWidth / 2 - settings.starting_width! / 2
      }px`;

      setTimeout(() => {
        ref.current!.style.transition = "";
      }, 700);

      (document.getElementById(bodyId) as HTMLDivElement).style.borderRadius =
        "0.7em";

      const title_element = document.getElementById(titleId) as HTMLDivElement;

      add_dragging_handle_event(title_element, ref);
      setMaximized(false);
    }
  };

  function getTopElement(a: HTMLElement, b: HTMLElement) {
    const aIndex = getZIndex(a);
    const bIndex = getZIndex(b);
    return aIndex > bIndex ? a : b;
  }

  function getZIndex(element: Element): number {
    const zIndex = document
      .defaultView!.getComputedStyle(element)
      .getPropertyValue("z-index");
    return isNaN(Number(zIndex)) ? 0 : Number(zIndex);
  }

  const focusPane = () => {
    const operatingSystemContainerElement = document.getElementById(
      "operating-system-container"
    ) as HTMLDivElement;

    let highestZIndex = 0;
    for (
      let i = 0;
      i < operatingSystemContainerElement.childNodes.length;
      i++
    ) {
      if (
        Number(
          (operatingSystemContainerElement.childNodes[i] as HTMLDivElement)
            .style.zIndex
        ) > highestZIndex
      ) {
        highestZIndex = Number(
          (operatingSystemContainerElement.childNodes[i] as HTMLDivElement)
            .style.zIndex
        );
      }
      const body_element = (
        operatingSystemContainerElement.childNodes[i] as HTMLDivElement
      ).getElementsByClassName(styles.body)[0] as HTMLDivElement;
      body_element.classList.remove(styles.pane_in_focus);
      body_element.style.filter = "blur(1px)";
    }
    const this_panes_body_element = ref.current!.getElementsByClassName(
      styles.body
    )[0] as HTMLDivElement;

    if (!this_panes_body_element.classList.contains(styles.pane_in_focus)) {
      this_panes_body_element.classList.add(styles.pane_in_focus);
      this_panes_body_element.style.filter = "";
    }

    ref.current!.style.zIndex = String(highestZIndex + 1);
  };

  const close = () => {
    ref.current!.style.opacity = "0";
    ref.current!.style.transform = "scale(0)";
    setTimeout(() => {
      ref.current?.remove();
      const panes = (
        document.getElementById("operating-system-container") as HTMLDivElement
      ).childNodes;

      let topPane: HTMLDivElement | undefined;
      panes.forEach((item) => {
        if (!topPane) topPane = item as HTMLDivElement;

        if (getTopElement(topPane, item as HTMLDivElement) === item)
          topPane = item as HTMLDivElement;
      });

      if (topPane) {
        const this_panes_body_element = topPane.getElementsByClassName(
          styles.body
        )[0] as HTMLDivElement;

        if (!this_panes_body_element.classList.contains(styles.pane_in_focus)) {
          this_panes_body_element.classList.add(styles.pane_in_focus);
          this_panes_body_element.style.filter = "";
        }
      }
    }, 600);
  };

  const center = () => {
    ref.current!.style.transition = "0.7s";
    ref.current!.style.top =
      (window.innerHeight - ref.current!.clientHeight) / 2 + "px";
    ref.current!.style.left =
      (window.innerWidth - ref.current!.clientWidth) / 2 + "px";
    ref.current!.style.opacity = "1";

    setTimeout(() => {
      ref.current!.style.transition = "";
    }, 700);
  };

  return (
    <div ref={ref} className={styles.pane + " pane"}>
      <div className={styles.top_group}>
        <div className={styles.top_left_resize_handle}></div>
        <div className={styles.top_resize_handle}></div>
        <div className={styles.top_right_resize_handle}></div>
      </div>
      <div className={styles.middle_group}>
        <div className={styles.left_resize_handle}></div>
        <div className={styles.body} id={bodyId}>
          <div className={styles.titlebar}>
            <div className={styles.title} id={titleId}>
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
              <span>{action_bar.title ?? "Untitled pane"}</span>
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
              " " +
              className +
              (settings.allow_overflow ? "overflow_allowed" : "")
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
