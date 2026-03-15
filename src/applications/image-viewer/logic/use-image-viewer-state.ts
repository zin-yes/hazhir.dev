"use client";

/**
 * Central state hook for the image viewer application.
 * Manages image gallery navigation, zoom/pan, swipe gestures,
 * viewport sizing, and minimap geometry.
 */

import { useFileSystem, type FileSystemNode } from "@/hooks/use-file-system";
import { getImagesDirectoryPath, isImageFileName } from "@/lib/image-files";
import { getHomePath } from "@/lib/system-user";
import { useEffect, useMemo, useRef, useState } from "react";

export function useImageViewerState(initialFilePath?: string) {
  const fileSystem = useFileSystem();
  const homePath = getHomePath();
  const imagesPath = getImagesDirectoryPath(homePath);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    initialFilePath ?? null,
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isInfoPanelVisible, setIsInfoPanelVisible] = useState(false);
  const [naturalImageSize, setNaturalImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [viewportDimensions, setViewportDimensions] = useState({
    width: 0,
    height: 0,
  });
  const [viewportVisibleRect, setViewportVisibleRect] = useState<{
    imageWidth: number;
    imageHeight: number;
    viewLeft: number;
    viewTop: number;
    viewWidth: number;
    viewHeight: number;
  } | null>(null);

  const hasInitializedIndexReference = useRef(false);
  const viewportReference = useRef<HTMLDivElement | null>(null);
  const imageFrameReference = useRef<HTMLDivElement | null>(null);
  const minimapReference = useRef<HTMLDivElement | null>(null);
  const swipeStartReference = useRef<{
    x: number;
    y: number;
    pointerType: string;
  } | null>(null);
  const minimapDragReference = useRef<{
    active: boolean;
    pointerId: number;
    mode: "center" | "rect";
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const pointerDragReference = useRef<{
    active: boolean;
    pointerId: number;
    mode: "pan" | "swipe";
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
  const pendingZoomAnchorReference = useRef<{
    xRatio: number;
    yRatio: number;
  } | null>(null);

  const [isPanning, setIsPanning] = useState(false);
  const [swipeOffsetX, setSwipeOffsetX] = useState(0);
  const [isSwipeDragging, setIsSwipeDragging] = useState(false);
  const [isSwipeAnimating, setIsSwipeAnimating] = useState(false);

  // Resolve the directory that contains the images to browse
  const activeDirectoryPath = useMemo(() => {
    if (!selectedFilePath) return imagesPath;
    const segments = selectedFilePath.split("/").filter(Boolean);
    if (segments.length <= 1) return imagesPath;
    return `/${segments.slice(0, -1).join("/")}`;
  }, [imagesPath, selectedFilePath]);

  // Gather and sort image nodes from the active directory
  const imageNodes = useMemo(() => {
    return fileSystem
      .getChildren(activeDirectoryPath, true)
      .filter(
        (node): node is FileSystemNode & { type: "file" } =>
          node.type === "file" && isImageFileName(node.name),
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }, [activeDirectoryPath, fileSystem]);

  const imagePathSignature = useMemo(
    () => imageNodes.map((node) => node.path).join("|"),
    [imageNodes],
  );

  // Sync selected file from external prop
  useEffect(() => {
    if (!initialFilePath) return;
    setSelectedFilePath(initialFilePath);
  }, [initialFilePath]);

  // Keep current index in sync when the image list changes
  useEffect(() => {
    if (!imageNodes.length) {
      setCurrentIndex(0);
      hasInitializedIndexReference.current = false;
      return;
    }

    setCurrentIndex((previousIndex) => {
      if (!hasInitializedIndexReference.current) {
        hasInitializedIndexReference.current = true;
        const preferredIndex = selectedFilePath
          ? imageNodes.findIndex((node) => node.path === selectedFilePath)
          : -1;
        return preferredIndex >= 0 ? preferredIndex : 0;
      }

      if (previousIndex < imageNodes.length) return previousIndex;
      return imageNodes.length - 1;
    });
  }, [imagePathSignature, imageNodes, selectedFilePath]);

  // Reset zoom when navigating to a different image
  useEffect(() => {
    setZoomLevel(1);
    const viewport = viewportReference.current;
    if (viewport) {
      viewport.scrollTo({ left: 0, top: 0, behavior: "auto" });
    }
  }, [currentIndex]);

  const currentNode = imageNodes[currentIndex];
  const currentImageSource = currentNode
    ? (fileSystem.getFileContents(currentNode.path) ?? "")
    : "";

  const getImageSourceByIndex = (index: number) => {
    if (!imageNodes.length) return "";
    const normalized = (index + imageNodes.length) % imageNodes.length;
    const node = imageNodes[normalized];
    return fileSystem.getFileContents(node.path) ?? "";
  };

  const navigateToPreviousImage = () => {
    if (imageNodes.length < 2) return;
    setCurrentIndex(
      (previous) => (previous - 1 + imageNodes.length) % imageNodes.length,
    );
  };

  const navigateToNextImage = () => {
    if (imageNodes.length < 2) return;
    setCurrentIndex((previous) => (previous + 1) % imageNodes.length);
  };

  const previousImageSource = getImageSourceByIndex(currentIndex - 1);
  const nextImageSource = getImageSourceByIndex(currentIndex + 1);
  const showAdjacentSlides = isSwipeDragging || isSwipeAnimating;
  const useSwipePresentation = zoomLevel === 1;

  // Preload adjacent images for smoother swiping
  useEffect(() => {
    const sources = [previousImageSource, nextImageSource].filter(Boolean);
    if (!sources.length) return;

    let cancelled = false;
    const preload = () => {
      if (cancelled) return;
      sources.forEach((source) => {
        const preloadImage = new window.Image();
        preloadImage.src = source;
      });
    };

    if ("requestIdleCallback" in window) {
      const idleCallbackId = window.requestIdleCallback(preload);
      return () => {
        cancelled = true;
        window.cancelIdleCallback(idleCallbackId);
      };
    }

    const timeoutId = globalThis.setTimeout(preload, 80);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
    };
  }, [nextImageSource, previousImageSource]);

  // Calculate the rendered image dimensions based on natural size, viewport, and zoom
  const STAGE_PADDING = 32;
  const renderedImageSize = useMemo(() => {
    if (
      !naturalImageSize ||
      viewportDimensions.width <= 0 ||
      viewportDimensions.height <= 0
    ) {
      return { width: 0, height: 0, baseWidth: 0, baseHeight: 0 };
    }

    const usableWidth = Math.max(1, viewportDimensions.width - STAGE_PADDING);
    const usableHeight = Math.max(1, viewportDimensions.height - STAGE_PADDING);
    const fitScale = Math.min(
      usableWidth / naturalImageSize.width,
      usableHeight / naturalImageSize.height,
    );

    const baseWidth = Math.max(1, naturalImageSize.width * fitScale);
    const baseHeight = Math.max(1, naturalImageSize.height * fitScale);

    return {
      width: baseWidth * zoomLevel,
      height: baseHeight * zoomLevel,
      baseWidth,
      baseHeight,
    };
  }, [
    naturalImageSize,
    viewportDimensions.height,
    viewportDimensions.width,
    zoomLevel,
  ]);

  const CANVAS_PADDING = 16;
  const canvasSize = useMemo(() => {
    const width = Math.max(
      viewportDimensions.width,
      renderedImageSize.width + CANVAS_PADDING * 2,
    );
    const height = Math.max(
      viewportDimensions.height,
      renderedImageSize.height + CANVAS_PADDING * 2,
    );
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }, [
    renderedImageSize.height,
    renderedImageSize.width,
    viewportDimensions.height,
    viewportDimensions.width,
  ]);

  const imageFramePosition = useMemo(() => {
    return {
      left: Math.max(0, (canvasSize.width - renderedImageSize.width) / 2),
      top: Math.max(0, (canvasSize.height - renderedImageSize.height) / 2),
    };
  }, [
    canvasSize.height,
    canvasSize.width,
    renderedImageSize.height,
    renderedImageSize.width,
  ]);

  const swipeLaneWidth = Math.max(
    1,
    viewportDimensions.width || renderedImageSize.width || 1,
  );

  // Apply a zoom step while preserving the viewport center anchor
  const applyZoomStep = (delta: number) => {
    const viewport = viewportReference.current;
    const imageFrame = imageFrameReference.current;

    setZoomLevel((previousZoom) => {
      const nextZoom = Math.min(4, Math.max(0.25, previousZoom + delta));
      if (nextZoom === previousZoom) return previousZoom;

      if (
        viewport &&
        imageFrame &&
        imageFrame.clientWidth > 0 &&
        imageFrame.clientHeight > 0
      ) {
        const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
        const centerY = viewport.scrollTop + viewport.clientHeight / 2;
        const localX = centerX - imageFrame.offsetLeft;
        const localY = centerY - imageFrame.offsetTop;

        pendingZoomAnchorReference.current = {
          xRatio: Math.min(1, Math.max(0, localX / imageFrame.clientWidth)),
          yRatio: Math.min(1, Math.max(0, localY / imageFrame.clientHeight)),
        };
      } else {
        pendingZoomAnchorReference.current = { xRatio: 0.5, yRatio: 0.5 };
      }

      return nextZoom;
    });
  };

  // Minimap thumbnail dimensions
  const minimapSize = useMemo(() => {
    const rect = viewportVisibleRect;
    if (!rect) return null;

    const maxWidth = 180;
    const ratio = rect.imageHeight / rect.imageWidth;
    const width = maxWidth;
    const height = Math.max(80, Math.min(150, width * ratio));

    return { width, height };
  }, [viewportVisibleRect]);

  // Track viewport element resize
  useEffect(() => {
    const viewport = viewportReference.current;
    if (!viewport) return;

    const updateViewportSize = () => {
      setViewportDimensions({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    };

    updateViewportSize();

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Track the visible rectangle within the image for minimap rendering
  useEffect(() => {
    const viewport = viewportReference.current;
    const imageFrame = imageFrameReference.current;
    if (!viewport || !imageFrame) {
      setViewportVisibleRect(null);
      return;
    }

    const updateRect = () => {
      const imageWidth = imageFrame.clientWidth;
      const imageHeight = imageFrame.clientHeight;

      if (imageWidth <= 0 || imageHeight <= 0) {
        setViewportVisibleRect(null);
        return;
      }

      const viewportLeft = viewport.scrollLeft;
      const viewportTop = viewport.scrollTop;
      const viewportRight = viewportLeft + viewport.clientWidth;
      const viewportBottom = viewportTop + viewport.clientHeight;

      const imageLeft = imageFrame.offsetLeft;
      const imageTop = imageFrame.offsetTop;
      const imageRight = imageLeft + imageWidth;
      const imageBottom = imageTop + imageHeight;

      const intersectLeft = Math.max(viewportLeft, imageLeft);
      const intersectTop = Math.max(viewportTop, imageTop);
      const intersectRight = Math.min(viewportRight, imageRight);
      const intersectBottom = Math.min(viewportBottom, imageBottom);

      const viewWidth = Math.max(0, intersectRight - intersectLeft);
      const viewHeight = Math.max(0, intersectBottom - intersectTop);
      const viewLeft = Math.max(0, intersectLeft - imageLeft);
      const viewTop = Math.max(0, intersectTop - imageTop);

      setViewportVisibleRect({
        imageWidth,
        imageHeight,
        viewLeft,
        viewTop,
        viewWidth,
        viewHeight,
      });
    };

    updateRect();
    viewport.addEventListener("scroll", updateRect, { passive: true });

    const observer = new ResizeObserver(updateRect);
    observer.observe(viewport);
    observer.observe(imageFrame);

    return () => {
      viewport.removeEventListener("scroll", updateRect);
      observer.disconnect();
    };
  }, [
    currentIndex,
    renderedImageSize.height,
    renderedImageSize.width,
    zoomLevel,
  ]);

  // After zoom changes, scroll to keep the anchor point centered
  useEffect(() => {
    const anchor = pendingZoomAnchorReference.current;
    if (!anchor) return;

    const viewport = viewportReference.current;
    const imageFrame = imageFrameReference.current;
    if (
      !viewport ||
      !imageFrame ||
      imageFrame.clientWidth <= 0 ||
      imageFrame.clientHeight <= 0
    ) {
      pendingZoomAnchorReference.current = null;
      return;
    }

    pendingZoomAnchorReference.current = null;

    const syncToAnchor = () => {
      const targetX =
        imageFrame.offsetLeft + anchor.xRatio * imageFrame.clientWidth;
      const targetY =
        imageFrame.offsetTop + anchor.yRatio * imageFrame.clientHeight;

      const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);

      viewport.scrollTo({
        left: Math.min(
          maxLeft,
          Math.max(0, targetX - viewport.clientWidth / 2),
        ),
        top: Math.min(maxTop, Math.max(0, targetY - viewport.clientHeight / 2)),
        behavior: "auto",
      });
    };

    const transitionDurationMilliseconds = 220;
    const startedAt = performance.now();
    let frameId = 0;

    const animate = (now: number) => {
      syncToAnchor();
      if (now - startedAt < transitionDurationMilliseconds) {
        frameId = window.requestAnimationFrame(animate);
      }
    };

    syncToAnchor();
    frameId = window.requestAnimationFrame(animate);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [
    canvasSize.height,
    canvasSize.width,
    renderedImageSize.height,
    renderedImageSize.width,
    zoomLevel,
  ]);

  // Minimap overlay geometry (scaled rectangle position within minimap)
  const minimapGeometry = useMemo(() => {
    if (!viewportVisibleRect || !minimapSize) return null;

    const scaleX = minimapSize.width / viewportVisibleRect.imageWidth;
    const scaleY = minimapSize.height / viewportVisibleRect.imageHeight;

    const left = viewportVisibleRect.viewLeft * scaleX;
    const top = viewportVisibleRect.viewTop * scaleY;
    const width = Math.max(1, viewportVisibleRect.viewWidth * scaleX);
    const height = Math.max(1, viewportVisibleRect.viewHeight * scaleY);
    const rightInset = Math.max(0, minimapSize.width - left - width);
    const bottomInset = Math.max(0, minimapSize.height - top - height);

    return {
      left,
      top,
      width,
      height,
      clipPath: `inset(${top}px ${rightInset}px ${bottomInset}px ${left}px)`,
    };
  }, [minimapSize, viewportVisibleRect]);

  const shouldShowMinimap =
    zoomLevel > 1 &&
    !isSwipeDragging &&
    !isSwipeAnimating &&
    Boolean(viewportVisibleRect && minimapSize);

  const infoPanelTopOffset =
    shouldShowMinimap && minimapSize ? minimapSize.height + 22 : 12;

  // Pans the viewport by mapping a minimap click to an image-space scroll position
  const panFromMinimapPoint = (
    clientX: number,
    clientY: number,
    mode: "center" | "rect",
    offsetX: number,
    offsetY: number,
  ) => {
    const minimap = minimapReference.current;
    const viewport = viewportReference.current;
    const imageFrame = imageFrameReference.current;

    if (!minimap || !viewport || !imageFrame || !minimapSize) return;

    const imageWidth = imageFrame.clientWidth;
    const imageHeight = imageFrame.clientHeight;
    if (imageWidth <= 0 || imageHeight <= 0) return;

    const viewWidth = Math.min(viewport.clientWidth, imageWidth);
    const viewHeight = Math.min(viewport.clientHeight, imageHeight);

    const minimapBounds = minimap.getBoundingClientRect();
    const localX = Math.min(
      minimapSize.width,
      Math.max(0, clientX - minimapBounds.left),
    );
    const localY = Math.min(
      minimapSize.height,
      Math.max(0, clientY - minimapBounds.top),
    );

    const scaleX = imageWidth / minimapSize.width;
    const scaleY = imageHeight / minimapSize.height;

    const targetViewLeft =
      mode === "rect"
        ? (localX - offsetX) * scaleX
        : localX * scaleX - viewWidth / 2;
    const targetViewTop =
      mode === "rect"
        ? (localY - offsetY) * scaleY
        : localY * scaleY - viewHeight / 2;

    const clampedViewLeft = Math.max(
      0,
      Math.min(imageWidth - viewWidth, targetViewLeft),
    );
    const clampedViewTop = Math.max(
      0,
      Math.min(imageHeight - viewHeight, targetViewTop),
    );

    viewport.scrollTo({
      left: imageFrame.offsetLeft + clampedViewLeft,
      top: imageFrame.offsetTop + clampedViewTop,
      behavior: "auto",
    });
  };

  // --- Pointer event handlers ---

  const handleViewportPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const viewport = viewportReference.current;
    if (!viewport) return;

    const mode: "pan" | "swipe" = zoomLevel === 1 ? "swipe" : "pan";

    pointerDragReference.current = {
      active: true,
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };

    event.currentTarget.setPointerCapture(event.pointerId);

    if (mode === "pan") {
      setIsPanning(true);
      event.preventDefault();
    }

    swipeStartReference.current = {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
    };
  };

  const handleViewportPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = pointerDragReference.current;
    const viewport = viewportReference.current;
    if (
      !drag ||
      !drag.active ||
      drag.pointerId !== event.pointerId ||
      !viewport
    ) {
      return;
    }

    if (drag.mode === "swipe") {
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;

      if (Math.abs(deltaX) <= Math.abs(deltaY)) return;

      setIsSwipeDragging(true);
      setSwipeOffsetX(deltaX);
      event.preventDefault();
      return;
    }

    // Pan mode — scroll the viewport by the drag delta
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    viewport.scrollTo({
      left: drag.startScrollLeft - deltaX,
      top: drag.startScrollTop - deltaY,
      behavior: "auto",
    });

    event.preventDefault();
  };

  const handleViewportPointerUp = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = pointerDragReference.current;
    if (drag && drag.pointerId === event.pointerId) {
      if (drag.mode === "pan") {
        setIsPanning(false);
        pointerDragReference.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        swipeStartReference.current = null;
        return;
      }

      pointerDragReference.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (isSwipeDragging) {
        const viewport = viewportReference.current;
        const threshold = Math.max(56, (viewport?.clientWidth ?? 320) * 0.18);
        const currentOffset = swipeOffsetX;
        const direction =
          currentOffset <= -threshold ? 1 : currentOffset >= threshold ? -1 : 0;
        const lane = Math.max(1, swipeLaneWidth, viewport?.clientWidth || 1);

        if (direction === 0) {
          // Snap back — no navigation
          setIsSwipeAnimating(true);
          setSwipeOffsetX(0);
          window.setTimeout(() => {
            setIsSwipeAnimating(false);
            setIsSwipeDragging(false);
          }, 220);
          swipeStartReference.current = null;
          return;
        }

        // Animate the swipe out then advance
        setIsSwipeAnimating(true);
        setSwipeOffsetX(direction === 1 ? -lane : lane);
        window.setTimeout(() => {
          setCurrentIndex((previous) =>
            direction === 1
              ? (previous + 1) % imageNodes.length
              : (previous - 1 + imageNodes.length) % imageNodes.length,
          );
          setSwipeOffsetX(0);
          setIsSwipeAnimating(false);
          setIsSwipeDragging(false);
        }, 220);

        swipeStartReference.current = null;
        return;
      }
    }

    // Fallback: quick flick gesture (non-drag swipe)
    const start = swipeStartReference.current;
    swipeStartReference.current = null;
    if (!start) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;

    if (Math.abs(deltaX) < 48) return;
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return;

    if (deltaX < 0) {
      navigateToNextImage();
      return;
    }
    navigateToPreviousImage();
  };

  const handleViewportPointerCancel = () => {
    pointerDragReference.current = null;
    setIsPanning(false);
    setIsSwipeDragging(false);
    setIsSwipeAnimating(false);
    setSwipeOffsetX(0);
    swipeStartReference.current = null;
  };

  // Minimap pointer handlers
  const handleMinimapPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!minimapGeometry) return;

    event.preventDefault();
    event.stopPropagation();

    const minimap = minimapReference.current;
    if (!minimap) return;

    const bounds = minimap.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;

    const isInsideRect =
      localX >= minimapGeometry.left &&
      localX <= minimapGeometry.left + minimapGeometry.width &&
      localY >= minimapGeometry.top &&
      localY <= minimapGeometry.top + minimapGeometry.height;

    const mode = isInsideRect ? "rect" : "center";
    const offsetX =
      mode === "rect"
        ? localX - minimapGeometry.left
        : minimapGeometry.width / 2;
    const offsetY =
      mode === "rect"
        ? localY - minimapGeometry.top
        : minimapGeometry.height / 2;

    minimapDragReference.current = {
      active: true,
      pointerId: event.pointerId,
      mode,
      offsetX,
      offsetY,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    panFromMinimapPoint(event.clientX, event.clientY, mode, offsetX, offsetY);
  };

  const handleMinimapPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = minimapDragReference.current;
    if (!drag?.active || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    panFromMinimapPoint(
      event.clientX,
      event.clientY,
      drag.mode,
      drag.offsetX,
      drag.offsetY,
    );
  };

  const handleMinimapPointerUpOrCancel = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = minimapDragReference.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    minimapDragReference.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return {
    // Data
    homePath,
    imagesPath,
    imageNodes,
    currentNode,
    currentIndex,
    currentImageSource,
    previousImageSource,
    nextImageSource,
    naturalImageSize,

    // Zoom & layout
    zoomLevel,
    renderedImageSize,
    canvasSize,
    imageFramePosition,
    swipeLaneWidth,
    useSwipePresentation,
    showAdjacentSlides,

    // Minimap
    shouldShowMinimap,
    minimapSize,
    minimapGeometry,
    infoPanelTopOffset,

    // UI state
    isPickerOpen,
    isInfoPanelVisible,
    isPanning,
    swipeOffsetX,
    isSwipeDragging,
    isSwipeAnimating,

    // Refs
    viewportReference,
    imageFrameReference,
    minimapReference,

    // Actions
    setSelectedFilePath,
    setIsPickerOpen,
    setIsInfoPanelVisible,
    setNaturalImageSize,
    navigateToPreviousImage,
    navigateToNextImage,
    applyZoomStep,

    // Event handlers
    handleViewportPointerDown,
    handleViewportPointerMove,
    handleViewportPointerUp,
    handleViewportPointerCancel,
    handleMinimapPointerDown,
    handleMinimapPointerMove,
    handleMinimapPointerUpOrCancel,
  };
}
