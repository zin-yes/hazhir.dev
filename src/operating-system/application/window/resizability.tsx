export function addRightResizeHandleEvent(
  resizeHandleElement: HTMLDivElement,
  parentElementRef: HTMLDivElement,
  minWidth: number
) {
  const mousedown = (event: any) => {
    const paneX = parentElementRef.offsetLeft;

    const startingMouseX =
      event.pageX -
      (parentElementRef.offsetWidth - parentElementRef.offsetLeft);

    const mouseMoveEvent = (event: MouseEvent) => {
      event.preventDefault();

      parentElementRef.style.width =
        Math.max(paneX + (event.pageX - startingMouseX), minWidth) + "px";
    };

    const mouseUpEvent = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouseMoveEvent);
      document.removeEventListener("mouseup", mouseUpEvent);
    };

    document.addEventListener("mousemove", mouseMoveEvent);
    document.addEventListener("mouseup", mouseUpEvent);
  };

  resizeHandleElement?.addEventListener("mousedown", mousedown);

  return mousedown;
}

export function addLeftResizeHandleEvent(
  resizeHandleElement: HTMLDivElement,
  parentElementRef: HTMLDivElement,
  minWidth: number
) {
  const mousedown = (event: any) => {
    const paneX = parentElementRef.offsetLeft;

    const startingMouseX = event.pageX;
    const startingWidth = parentElementRef.offsetWidth;
    const startingRight =
      parentElementRef.offsetWidth + parentElementRef.offsetLeft;

    const mouseMoveEvent = (event: MouseEvent) => {
      event.preventDefault();

      if (startingWidth - (event.pageX - startingMouseX) < minWidth) {
        parentElementRef.style.left = startingRight - minWidth + "px";
      } else {
        parentElementRef.style.left =
          paneX + (event.pageX - startingMouseX) + "px";
      }

      parentElementRef.style.width =
        Math.max(startingWidth - (event.pageX - startingMouseX), minWidth) +
        "px";
    };

    const mouseUpEvent = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouseMoveEvent);
      document.removeEventListener("mouseup", mouseUpEvent);
    };

    document.addEventListener("mousemove", mouseMoveEvent);
    document.addEventListener("mouseup", mouseUpEvent);
  };

  resizeHandleElement?.addEventListener("mousedown", mousedown);

  return mousedown;
}

export function addBottomResizeHandleEvent(
  resizeHandleElement: HTMLDivElement,
  parentElementRef: HTMLDivElement,
  minHeight: number
) {
  const mousedown = (event: any) => {
    const startingPaneY = parentElementRef.offsetTop;

    const startingMouseY =
      event.pageY -
      (parentElementRef.offsetHeight - parentElementRef.offsetTop);

    const mouseMoveEvent = (event: MouseEvent) => {
      event.preventDefault();

      parentElementRef.style.height =
        Math.max(startingPaneY + (event.pageY - startingMouseY), minHeight) +
        "px";
    };

    const mouseUpEvent = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouseMoveEvent);
      document.removeEventListener("mouseup", mouseUpEvent);
    };

    document.addEventListener("mousemove", mouseMoveEvent);
    document.addEventListener("mouseup", mouseUpEvent);
  };

  resizeHandleElement?.addEventListener("mousedown", mousedown);

  return mousedown;
}

export function addTopResizeHandleEvent(
  resizeHandleElement: HTMLDivElement,
  parentElementRef: HTMLDivElement,
  minHeight: number
) {
  resizeHandleElement?.addEventListener("mousedown", (event: any) => {
    const startingPaneY = parentElementRef.offsetTop;

    const startingMouseY = event.pageY;
    const startingHeight = parentElementRef.offsetHeight;

    const startingBottom =
      parentElementRef.offsetHeight + parentElementRef.offsetTop;

    const mouseMoveEvent = (event: MouseEvent) => {
      event.preventDefault();

      parentElementRef.style.top =
        (startingHeight - (event.pageY - startingMouseY) < minHeight
          ? startingPaneY
          : startingPaneY + (event.pageY - startingMouseY)) + "px";

      if (startingHeight - (event.pageY - startingMouseY) < minHeight) {
        parentElementRef.style.top = startingBottom - minHeight + "px";
      } else {
        parentElementRef.style.top =
          startingPaneY + (event.pageY - startingMouseY) + "px";
      }

      parentElementRef.style.height =
        Math.max(startingHeight - (event.pageY - startingMouseY), minHeight) +
        "px";
    };

    const mouseUpEvent = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouseMoveEvent);
      document.removeEventListener("mouseup", mouseUpEvent);
    };

    document.addEventListener("mousemove", mouseMoveEvent);
    document.addEventListener("mouseup", mouseUpEvent);
  });
}

export function addDraggingHandleEvent(
  draggingHandleElement: HTMLDivElement,
  targetElementRef: HTMLDivElement
) {
  const mousedown = (event: any) => {
    const paneX = targetElementRef.offsetLeft;
    const paneY = targetElementRef.offsetTop;

    const startingMouseX = event.pageX;
    const startingMouseY = event.pageY;

    const mouseMoveEvent = (event: MouseEvent) => {
      event.preventDefault();

      targetElementRef.style.left =
        paneX + (event.pageX - startingMouseX) + "px";
      targetElementRef.style.top =
        paneY + (event.pageY - startingMouseY) + "px";
    };

    const mouseUpEvent = (event: MouseEvent) => {
      document.removeEventListener("mousemove", mouseMoveEvent);
      document.removeEventListener("mouseup", mouseUpEvent);
    };

    document.addEventListener("mousemove", mouseMoveEvent);
    document.addEventListener("mouseup", mouseUpEvent);
  };

  draggingHandleElement?.addEventListener("mousedown", mousedown);

  return mousedown;
}
