import { RefObject } from "react";

import PANE_CONFIG from "@/config/pane";

export function add_right_resize_handle_event(
  resize_handle_element: Element,
  parent_ref: RefObject<HTMLDivElement>
) {
  const mousedown = (event: any) => {
    const pane_x = parent_ref.current!.offsetLeft;

    const starting_mouse_x =
      event.pageX -
      (parent_ref.current!.offsetWidth - parent_ref.current!.offsetLeft);

    const mouse_move_event = (event: MouseEvent) => {
      event.preventDefault();

      parent_ref.current!.style.width =
        Math.max(
          pane_x + (event.pageX - starting_mouse_x),
          PANE_CONFIG.defaults.MIN_WIDTH
        ) + "px";
    };

    const mouse_up_event = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouse_move_event);
      document.removeEventListener("mouseup", mouse_up_event);
    };

    document.addEventListener("mousemove", mouse_move_event);
    document.addEventListener("mouseup", mouse_up_event);
  };

  resize_handle_element?.addEventListener("mousedown", mousedown);

  return mousedown;
}

export function add_left_resize_handle_event(
  resize_handle_element: Element,
  parent_ref: RefObject<HTMLDivElement>
) {
  const mousedown = (event: any) => {
    const pane_x = parent_ref.current!.offsetLeft;

    const starting_mouse_x = event.pageX;
    const starting_width = parent_ref.current!.offsetWidth;
    const starting_right =
      parent_ref.current!.offsetWidth + parent_ref.current!.offsetLeft;

    const mouse_move_event = (event: MouseEvent) => {
      event.preventDefault();

      if (
        starting_width - (event.pageX - starting_mouse_x) <
        PANE_CONFIG.defaults.MIN_WIDTH
      ) {
        parent_ref.current!.style.left =
          starting_right - PANE_CONFIG.defaults.MIN_WIDTH + "px";
      } else {
        parent_ref.current!.style.left =
          pane_x + (event.pageX - starting_mouse_x) + "px";
      }

      parent_ref.current!.style.width =
        Math.max(
          starting_width - (event.pageX - starting_mouse_x),
          PANE_CONFIG.defaults.MIN_WIDTH
        ) + "px";
    };

    const mouse_up_event = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouse_move_event);
      document.removeEventListener("mouseup", mouse_up_event);
    };

    document.addEventListener("mousemove", mouse_move_event);
    document.addEventListener("mouseup", mouse_up_event);
  };

  resize_handle_element?.addEventListener("mousedown", mousedown);

  return mousedown;
}

export function add_bottom_resize_handle_event(
  resize_handle_element: Element,
  parent_ref: RefObject<HTMLDivElement>
) {
  const mousedown = (event: any) => {
    const starting_pane_y = parent_ref.current!.offsetTop;

    const starting_mouse_y =
      event.pageY -
      (parent_ref.current!.offsetHeight - parent_ref.current!.offsetTop);

    const mouse_move_event = (event: MouseEvent) => {
      event.preventDefault();

      parent_ref.current!.style.height =
        Math.max(
          starting_pane_y + (event.pageY - starting_mouse_y),
          PANE_CONFIG.defaults.MIN_HEIGHT
        ) + "px";
    };

    const mouse_up_event = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouse_move_event);
      document.removeEventListener("mouseup", mouse_up_event);
    };

    document.addEventListener("mousemove", mouse_move_event);
    document.addEventListener("mouseup", mouse_up_event);
  };

  resize_handle_element?.addEventListener("mousedown", mousedown);

  return mousedown;
}

export function add_top_resize_handle_event(
  resize_handle_element: Element,
  parent_ref: RefObject<HTMLDivElement>
) {
  resize_handle_element?.addEventListener("mousedown", (event: any) => {
    const starting_pane_y = parent_ref.current!.offsetTop;

    const starting_mouse_y = event.pageY;
    const starting_height = parent_ref.current!.offsetHeight;

    const starting_bottom =
      parent_ref.current!.offsetHeight + parent_ref.current!.offsetTop;

    const mouse_move_event = (event: MouseEvent) => {
      event.preventDefault();

      parent_ref.current!.style.top =
        (starting_height - (event.pageY - starting_mouse_y) <
        PANE_CONFIG.defaults.MIN_HEIGHT
          ? starting_pane_y
          : starting_pane_y + (event.pageY - starting_mouse_y)) + "px";

      if (
        starting_height - (event.pageY - starting_mouse_y) <
        PANE_CONFIG.defaults.MIN_HEIGHT
      ) {
        parent_ref.current!.style.top =
          starting_bottom - PANE_CONFIG.defaults.MIN_HEIGHT + "px";
      } else {
        parent_ref.current!.style.top =
          starting_pane_y + (event.pageY - starting_mouse_y) + "px";
      }

      parent_ref.current!.style.height =
        Math.max(
          starting_height - (event.pageY - starting_mouse_y),
          PANE_CONFIG.defaults.MIN_HEIGHT
        ) + "px";
    };

    const mouse_up_event = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouse_move_event);
      document.removeEventListener("mouseup", mouse_up_event);
    };

    document.addEventListener("mousemove", mouse_move_event);
    document.addEventListener("mouseup", mouse_up_event);
  });
}

export function add_dragging_handle_event(
  dragging_handle_element: Element,
  target_ref: RefObject<HTMLDivElement>
) {
  const mousedown = (event: any) => {
    const pane_x = target_ref.current!.offsetLeft;
    const pane_y = target_ref.current!.offsetTop;

    const starting_mouse_x = event.pageX;
    const starting_mouse_y = event.pageY;

    const mouse_move_event = (event: MouseEvent) => {
      event.preventDefault();

      target_ref.current!.style.left =
        pane_x + (event.pageX - starting_mouse_x) + "px";
      target_ref.current!.style.top =
        pane_y + (event.pageY - starting_mouse_y) + "px";
    };

    const mouse_up_event = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouse_move_event);
      document.removeEventListener("mouseup", mouse_up_event);
    };

    document.addEventListener("mousemove", mouse_move_event);
    document.addEventListener("mouseup", mouse_up_event);
  };

  dragging_handle_element?.addEventListener("mousedown", mousedown);

  return mousedown;
}
