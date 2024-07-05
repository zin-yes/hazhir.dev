"use client";

import { useEffect, useRef, useState } from "react";

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

// FIXME: Add destructors/disposing functions for the events on the inside the useEffect.

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const MIN_DEFAULT_DIMENSIONS = 400;

export default function Pane({
  children,
  className,
  action_bar = {
    icon: {
      svg: <AppWindowIcon />,
    },
    title: "Untitled pane",
  },
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
      svg?: React.ReactNode;
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

  const ref = useRef<HTMLDivElement>(null);

  // Center the pane element.
  useEffect(() => {
    if (ref.current) {
      center();
    }
  }, []);

  // Add resize and drag functionality to pane.
  useEffect(() => {
    if (ref.current) {
      ref.current.style.width = settings.starting_width + "px";
      ref.current.style.height = settings.starting_height + "px";
    }

    const title_element = ref.current!.getElementsByClassName(styles.title)[0];
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
  ]);

  const maximize = () => {
    if (!maximized) {
      ref.current!.style.left = "-10px";
      ref.current!.style.top = "-10px";
      ref.current!.style.width = "calc(100% + 20px)";
      ref.current!.style.height = "calc(100% - 40px)";
      setMaximized(true);
    } else {
      ref.current!.style.width = `${settings.starting_width}px`;
      ref.current!.style.height = `${settings.starting_height}px`;
      center();
      setMaximized(false);
    }
  };
  const close = () => {
    ref.current!.style.opacity = "0";
    setTimeout(() => {
      ref.current?.remove();
    }, 200);
  };
  const center = () => {
    ref.current!.style.top =
      (window.innerHeight - ref.current!.clientHeight) / 2 + "px";
    ref.current!.style.left =
      (window.innerWidth - ref.current!.clientWidth) / 2 + "px";
    ref.current!.style.opacity = "1";
  };

  return (
    <div ref={ref} className={styles.pane}>
      <div className={styles.top_group}>
        <div className={styles.top_left_resize_handle}></div>
        <div className={styles.top_resize_handle}></div>
        <div className={styles.top_right_resize_handle}></div>
      </div>
      <div className={styles.middle_group}>
        <div className={styles.left_resize_handle}></div>
        <div className={styles.body}>
          <div className={styles.titlebar}>
            <div className={styles.title}>
              {action_bar.icon && action_bar.icon.src ? (
                <Image
                  className={styles.icon}
                  src={action_bar.icon.src}
                  width={14}
                  height={14}
                  alt="Pane icon."
                />
              ) : (
                (action_bar.icon && action_bar.icon.svg) ?? action_bar.icon?.svg
              )}
              <span>{action_bar.title}</span>
            </div>
            <div className={styles.actions}>
              <div className={styles.minimize}>
                <Minimize2 />
              </div>
              <div
                className={styles.maximize}
                onClick={() => {
                  maximize();
                }}
              >
                <Maximize2 />
              </div>
              <div
                className={styles.close}
                onClick={() => {
                  close();
                }}
              >
                <X />
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
