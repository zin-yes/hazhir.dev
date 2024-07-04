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

// To do (not ordered):
// - Move resize code to a utils file.
// - Move hard coded constants to a config. file.
// - Style the scrollbar.
// - Add functionality to the pane actions.
// - Don't let the pane completely leave the window, so that it can always be dragged and moved around even if you accidentaly move it outside the window.

// Known bugs:
// - When clicking a resizing handle, and then dragging the cursor on top of another resize handle it changes the cursor texture to the one currently hovered, it should be the one that is currently being resized.

export default function Pane({
  children,
  className,
  action_bar = {
    icon: {
      src: "",
    },
    title: "Untitled pane",
  },
  settings = {
    allow_overflow: true,
  },
}: {
  children?: React.ReactNode;
  className?: string;
  action_bar?: {
    icon?: {
      src: string;
    };
    title?: string;
  };
  settings?: {
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
    add_right_resize_handle_event(right_resize_handle_element, ref);

    // Set up resize functionality for bottom right resize handle.
    add_bottom_resize_handle_event(bottom_right_resize_handle_element, ref);
    add_right_resize_handle_event(bottom_right_resize_handle_element, ref);

    // Set up resize functionality for top right resize handle.
    add_top_resize_handle_event(top_right_resize_handle_element, ref);
    add_right_resize_handle_event(top_right_resize_handle_element, ref);

    // Set up resize functionality for left resize handle.
    add_left_resize_handle_event(left_resize_handle_element, ref);

    // Set up resize functionality for bottom left resize handle.
    add_bottom_resize_handle_event(bottom_left_resize_handle_element, ref);
    add_left_resize_handle_event(bottom_left_resize_handle_element, ref);

    // Set up resize functionality for top left resize handle.
    add_top_resize_handle_event(top_left_resize_handle_element, ref);
    add_left_resize_handle_event(top_left_resize_handle_element, ref);

    // Set up resize functionality for bottom resize handle.
    add_bottom_resize_handle_event(bottom_resize_handle_element, ref);

    // Set up resize functionality for top resize handle.
    add_top_resize_handle_event(top_resize_handle_element, ref);

    // Dragging handle for the pane.
    add_dragging_handle_event(title_element, ref);
  }, [ref]);

  const maximize = () => {
    if (!maximized) {
      ref.current!.style.left = "-10px";
      ref.current!.style.top = "-10px";
      ref.current!.style.width = "calc(100% + 20px)";
      ref.current!.style.height = "calc(100% - 40px)";
      setMaximized(true);
    } else {
      ref.current!.style.width = "800px";
      ref.current!.style.height = "600px";
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
              {action_bar.icon && (
                <Image
                  className={styles.icon}
                  src={action_bar.icon.src}
                  width={14}
                  height={14}
                  alt="Pane icon."
                />
              )}
              <span>{action_bar.title}</span>
            </div>
            <div className={styles.actions}>
              <div className={styles.minimize}>-</div>
              <div
                className={styles.maximize}
                onClick={() => {
                  maximize();
                }}
              >
                +
              </div>
              <div
                className={styles.close}
                onClick={() => {
                  close();
                }}
              >
                x
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
