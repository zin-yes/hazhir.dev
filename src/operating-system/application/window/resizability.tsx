function getPointerPagePosition(event: PointerEvent) {
  return { x: event.pageX, y: event.pageY };
}

export function addRightResizeHandleEvent(
  resizeHandleElement: HTMLDivElement,
  parentElementRef: HTMLDivElement,
  minWidth: number,
) {
  const pointerDown = (event: PointerEvent) => {
    event.preventDefault();
    const paneX = parentElementRef.offsetLeft;
    const { x } = getPointerPagePosition(event);

    const startingMouseX =
      x - (parentElementRef.offsetWidth - parentElementRef.offsetLeft);

    const pointerMoveEvent = (event: PointerEvent) => {
      event.preventDefault();
      const { x } = getPointerPagePosition(event);

      parentElementRef.style.width =
        Math.max(paneX + (x - startingMouseX), minWidth) + "px";
    };

    const pointerUpEvent = () => {
      document.removeEventListener("pointermove", pointerMoveEvent);
      document.removeEventListener("pointerup", pointerUpEvent);
    };

    document.addEventListener("pointermove", pointerMoveEvent);
    document.addEventListener("pointerup", pointerUpEvent);
  };

  resizeHandleElement?.addEventListener("pointerdown", pointerDown);

  return pointerDown;
}

export function addLeftResizeHandleEvent(
  resizeHandleElement: HTMLDivElement,
  parentElementRef: HTMLDivElement,
  minWidth: number,
) {
  const pointerDown = (event: PointerEvent) => {
    event.preventDefault();
    const paneX = parentElementRef.offsetLeft;
    const { x } = getPointerPagePosition(event);

    const startingMouseX = x;
    const startingWidth = parentElementRef.offsetWidth;
    const startingRight =
      parentElementRef.offsetWidth + parentElementRef.offsetLeft;

    const pointerMoveEvent = (event: PointerEvent) => {
      event.preventDefault();
      const { x } = getPointerPagePosition(event);

      if (startingWidth - (x - startingMouseX) < minWidth) {
        parentElementRef.style.left = startingRight - minWidth + "px";
      } else {
        parentElementRef.style.left = paneX + (x - startingMouseX) + "px";
      }

      parentElementRef.style.width =
        Math.max(startingWidth - (x - startingMouseX), minWidth) + "px";
    };

    const pointerUpEvent = () => {
      document.removeEventListener("pointermove", pointerMoveEvent);
      document.removeEventListener("pointerup", pointerUpEvent);
    };

    document.addEventListener("pointermove", pointerMoveEvent);
    document.addEventListener("pointerup", pointerUpEvent);
  };

  resizeHandleElement?.addEventListener("pointerdown", pointerDown);

  return pointerDown;
}

export function addBottomResizeHandleEvent(
  resizeHandleElement: HTMLDivElement,
  parentElementRef: HTMLDivElement,
  minHeight: number,
) {
  const pointerDown = (event: PointerEvent) => {
    event.preventDefault();
    const startingPaneY = parentElementRef.offsetTop;
    const { y } = getPointerPagePosition(event);

    const startingMouseY =
      y - (parentElementRef.offsetHeight - parentElementRef.offsetTop);

    const pointerMoveEvent = (event: PointerEvent) => {
      event.preventDefault();
      const { y } = getPointerPagePosition(event);

      parentElementRef.style.height =
        Math.max(startingPaneY + (y - startingMouseY), minHeight) + "px";
    };

    const pointerUpEvent = () => {
      document.removeEventListener("pointermove", pointerMoveEvent);
      document.removeEventListener("pointerup", pointerUpEvent);
    };

    document.addEventListener("pointermove", pointerMoveEvent);
    document.addEventListener("pointerup", pointerUpEvent);
  };

  resizeHandleElement?.addEventListener("pointerdown", pointerDown);

  return pointerDown;
}

export function addTopResizeHandleEvent(
  resizeHandleElement: HTMLDivElement,
  parentElementRef: HTMLDivElement,
  minHeight: number,
) {
  resizeHandleElement?.addEventListener(
    "pointerdown",
    (event: PointerEvent) => {
      event.preventDefault();
      const startingPaneY = parentElementRef.offsetTop;
      const { y } = getPointerPagePosition(event);

      const startingMouseY = y;
      const startingHeight = parentElementRef.offsetHeight;

      const startingBottom =
        parentElementRef.offsetHeight + parentElementRef.offsetTop;

      const pointerMoveEvent = (event: PointerEvent) => {
        event.preventDefault();
        const { y } = getPointerPagePosition(event);

        parentElementRef.style.top =
          (startingHeight - (y - startingMouseY) < minHeight
            ? startingPaneY
            : startingPaneY + (y - startingMouseY)) + "px";

        if (startingHeight - (y - startingMouseY) < minHeight) {
          parentElementRef.style.top = startingBottom - minHeight + "px";
        } else {
          parentElementRef.style.top =
            startingPaneY + (y - startingMouseY) + "px";
        }

        parentElementRef.style.height =
          Math.max(startingHeight - (y - startingMouseY), minHeight) + "px";
      };

      const pointerUpEvent = () => {
        document.removeEventListener("pointermove", pointerMoveEvent);
        document.removeEventListener("pointerup", pointerUpEvent);
      };

      document.addEventListener("pointermove", pointerMoveEvent);
      document.addEventListener("pointerup", pointerUpEvent);
    },
  );
}

export function addDraggingHandleEvent(
  draggingHandleElement: HTMLDivElement,
  targetElementRef: HTMLDivElement,
) {
  const pointerDown = (event: PointerEvent) => {
    event.preventDefault();
    const paneX = targetElementRef.offsetLeft;
    const paneY = targetElementRef.offsetTop;
    const { x, y } = getPointerPagePosition(event);

    const startingMouseX = x;
    const startingMouseY = y;

    const pointerMoveEvent = (event: PointerEvent) => {
      event.preventDefault();
      const { x, y } = getPointerPagePosition(event);

      targetElementRef.style.left = paneX + (x - startingMouseX) + "px";
      targetElementRef.style.top = paneY + (y - startingMouseY) + "px";
    };

    const pointerUpEvent = () => {
      document.removeEventListener("pointermove", pointerMoveEvent);
      document.removeEventListener("pointerup", pointerUpEvent);
    };

    document.addEventListener("pointermove", pointerMoveEvent);
    document.addEventListener("pointerup", pointerUpEvent);
  };

  draggingHandleElement?.addEventListener("pointerdown", pointerDown);

  return pointerDown;
}
