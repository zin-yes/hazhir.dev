"use client";

import FileExplorerApplication from "@/applications/file-explorer";
import ApplicationEmptyState from "@/components/system/application-empty-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useFileSystem, type FileSystemNode } from "@/hooks/use-file-system";
import {
  IMAGE_EXTENSIONS,
  getImagesDirectoryPath,
  isImageFileName,
} from "@/lib/image-files";
import { getHomePath } from "@/lib/system-user";
import {
  ChevronLeft,
  ChevronRight,
  FileSearch,
  Info,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type ImageViewerApplicationProps = {
  initialFilePath?: string;
};

export default function ImageViewerApplication({
  initialFilePath,
}: ImageViewerApplicationProps) {
  const fs = useFileSystem();
  const homePath = getHomePath();
  const imagesPath = getImagesDirectoryPath(homePath);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    initialFilePath ?? null,
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showInfo, setShowInfo] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [viewportRect, setViewportRect] = useState<{
    imageWidth: number;
    imageHeight: number;
    viewLeft: number;
    viewTop: number;
    viewWidth: number;
    viewHeight: number;
  } | null>(null);
  const hasInitializedIndexRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageFrameRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<{
    x: number;
    y: number;
    pointerType: string;
  } | null>(null);
  const minimapDragRef = useRef<{
    active: boolean;
    pointerId: number;
    mode: "center" | "rect";
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const pointerDragRef = useRef<{
    active: boolean;
    pointerId: number;
    mode: "pan" | "swipe";
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [swipeOffsetX, setSwipeOffsetX] = useState(0);
  const [isSwipeDragging, setIsSwipeDragging] = useState(false);
  const [isSwipeAnimating, setIsSwipeAnimating] = useState(false);
  const pendingZoomAnchorRef = useRef<{
    xRatio: number;
    yRatio: number;
  } | null>(null);

  const activeDirectoryPath = useMemo(() => {
    if (!selectedFilePath) return imagesPath;
    const segments = selectedFilePath.split("/").filter(Boolean);
    if (segments.length <= 1) return imagesPath;
    return `/${segments.slice(0, -1).join("/")}`;
  }, [imagesPath, selectedFilePath]);

  const imageNodes = useMemo(() => {
    return fs
      .getChildren(activeDirectoryPath, true)
      .filter(
        (node): node is FileSystemNode & { type: "file" } =>
          node.type === "file" && isImageFileName(node.name),
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }, [activeDirectoryPath, fs]);

  const imagePathSignature = useMemo(
    () => imageNodes.map((node) => node.path).join("|"),
    [imageNodes],
  );

  useEffect(() => {
    if (!initialFilePath) return;
    setSelectedFilePath(initialFilePath);
  }, [initialFilePath]);

  useEffect(() => {
    if (!imageNodes.length) {
      setCurrentIndex(0);
      hasInitializedIndexRef.current = false;
      return;
    }

    setCurrentIndex((previousIndex) => {
      if (!hasInitializedIndexRef.current) {
        hasInitializedIndexRef.current = true;
        const preferredIndex = selectedFilePath
          ? imageNodes.findIndex((node) => node.path === selectedFilePath)
          : -1;
        return preferredIndex >= 0 ? preferredIndex : 0;
      }

      if (previousIndex < imageNodes.length) return previousIndex;
      return imageNodes.length - 1;
    });
  }, [imagePathSignature, imageNodes, selectedFilePath]);

  useEffect(() => {
    setZoom(1);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTo({ left: 0, top: 0, behavior: "auto" });
    }
  }, [currentIndex]);

  const currentNode = imageNodes[currentIndex];
  const currentSrc = currentNode
    ? (fs.getFileContents(currentNode.path) ?? "")
    : "";

  const getImageSrcByIndex = (index: number) => {
    if (!imageNodes.length) return "";
    const normalized = (index + imageNodes.length) % imageNodes.length;
    const node = imageNodes[normalized];
    return fs.getFileContents(node.path) ?? "";
  };

  const goPrevious = () => {
    if (imageNodes.length < 2) return;
    setCurrentIndex(
      (prev) => (prev - 1 + imageNodes.length) % imageNodes.length,
    );
  };

  const goNext = () => {
    if (imageNodes.length < 2) return;
    setCurrentIndex((prev) => (prev + 1) % imageNodes.length);
  };

  const previousImageSrc = getImageSrcByIndex(currentIndex - 1);
  const nextImageSrc = getImageSrcByIndex(currentIndex + 1);
  const showAdjacentSlides = isSwipeDragging || isSwipeAnimating;
  const useSwipePresentation = zoom === 1;

  useEffect(() => {
    const sources = [previousImageSrc, nextImageSrc].filter(Boolean);
    if (!sources.length) return;

    let cancelled = false;
    const preload = () => {
      if (cancelled) return;
      sources.forEach((source) => {
        const img = new window.Image();
        img.src = source;
      });
    };

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload);
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }

    const timeout = globalThis.setTimeout(preload, 80);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeout);
    };
  }, [nextImageSrc, previousImageSrc]);

  const renderedImageSize = useMemo(() => {
    if (!naturalSize || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return { width: 0, height: 0, baseWidth: 0, baseHeight: 0 };
    }

    const stagePadding = 32;
    const usableWidth = Math.max(1, viewportSize.width - stagePadding);
    const usableHeight = Math.max(1, viewportSize.height - stagePadding);
    const fitScale = Math.min(
      usableWidth / naturalSize.width,
      usableHeight / naturalSize.height,
    );

    const baseWidth = Math.max(1, naturalSize.width * fitScale);
    const baseHeight = Math.max(1, naturalSize.height * fitScale);

    return {
      width: baseWidth * zoom,
      height: baseHeight * zoom,
      baseWidth,
      baseHeight,
    };
  }, [naturalSize, viewportSize.height, viewportSize.width, zoom]);

  const stagePadding = 16;
  const canvasSize = useMemo(() => {
    const width = Math.max(
      viewportSize.width,
      renderedImageSize.width + stagePadding * 2,
    );
    const height = Math.max(
      viewportSize.height,
      renderedImageSize.height + stagePadding * 2,
    );

    return { width: Math.max(1, width), height: Math.max(1, height) };
  }, [
    renderedImageSize.height,
    renderedImageSize.width,
    viewportSize.height,
    viewportSize.width,
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
    viewportSize.width || renderedImageSize.width || 1,
  );

  const applyZoomStep = (delta: number) => {
    const viewport = viewportRef.current;
    const imageFrame = imageFrameRef.current;

    setZoom((prevZoom) => {
      const nextZoom = Math.min(4, Math.max(0.25, prevZoom + delta));
      if (nextZoom === prevZoom) return prevZoom;

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

        pendingZoomAnchorRef.current = {
          xRatio: Math.min(1, Math.max(0, localX / imageFrame.clientWidth)),
          yRatio: Math.min(1, Math.max(0, localY / imageFrame.clientHeight)),
        };
      } else {
        pendingZoomAnchorRef.current = { xRatio: 0.5, yRatio: 0.5 };
      }

      return nextZoom;
    });
  };

  const minimapSize = useMemo(() => {
    const rect = viewportRect;
    if (!rect) return null;

    const maxWidth = 180;
    const ratio = rect.imageHeight / rect.imageWidth;
    const width = maxWidth;
    const height = Math.max(80, Math.min(150, width * ratio));

    return { width, height };
  }, [viewportRect]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateViewportSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    };

    updateViewportSize();

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const imageFrame = imageFrameRef.current;
    if (!viewport || !imageFrame) {
      setViewportRect(null);
      return;
    }

    const updateRect = () => {
      const imageWidth = imageFrame.clientWidth;
      const imageHeight = imageFrame.clientHeight;

      if (imageWidth <= 0 || imageHeight <= 0) {
        setViewportRect(null);
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

      setViewportRect({
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
  }, [currentIndex, renderedImageSize.height, renderedImageSize.width, zoom]);

  useEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    if (!anchor) return;

    const viewport = viewportRef.current;
    const imageFrame = imageFrameRef.current;
    if (
      !viewport ||
      !imageFrame ||
      imageFrame.clientWidth <= 0 ||
      imageFrame.clientHeight <= 0
    ) {
      pendingZoomAnchorRef.current = null;
      return;
    }

    pendingZoomAnchorRef.current = null;

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

    const transitionDurationMs = 220;
    const startedAt = performance.now();
    let frameId = 0;

    const animate = (now: number) => {
      syncToAnchor();
      if (now - startedAt < transitionDurationMs) {
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
    zoom,
  ]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    const mode: "pan" | "swipe" = zoom === 1 ? "swipe" : "pan";

    pointerDragRef.current = {
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

    swipeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    const viewport = viewportRef.current;
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

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    viewport.scrollTo({
      left: drag.startScrollLeft - deltaX,
      top: drag.startScrollTop - deltaY,
      behavior: "auto",
    });

    event.preventDefault();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      if (drag.mode === "pan") {
        setIsPanning(false);
        pointerDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        swipeStartRef.current = null;
        return;
      }

      pointerDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (isSwipeDragging) {
        const viewport = viewportRef.current;
        const threshold = Math.max(56, (viewport?.clientWidth ?? 320) * 0.18);
        const currentOffset = swipeOffsetX;
        const direction =
          currentOffset <= -threshold ? 1 : currentOffset >= threshold ? -1 : 0;
        const lane = Math.max(1, swipeLaneWidth, viewport?.clientWidth || 1);

        if (direction === 0) {
          setIsSwipeAnimating(true);
          setSwipeOffsetX(0);
          window.setTimeout(() => {
            setIsSwipeAnimating(false);
            setIsSwipeDragging(false);
          }, 220);
          swipeStartRef.current = null;
          return;
        }

        setIsSwipeAnimating(true);
        setSwipeOffsetX(direction === 1 ? -lane : lane);
        window.setTimeout(() => {
          setCurrentIndex((prev) =>
            direction === 1
              ? (prev + 1) % imageNodes.length
              : (prev - 1 + imageNodes.length) % imageNodes.length,
          );
          setSwipeOffsetX(0);
          setIsSwipeAnimating(false);
          setIsSwipeDragging(false);
        }, 220);

        swipeStartRef.current = null;
        return;
      }
    }

    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;

    if (Math.abs(deltaX) < 48) return;
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return;

    if (deltaX < 0) {
      goNext();
      return;
    }

    goPrevious();
  };

  const handlePointerCancel = () => {
    pointerDragRef.current = null;
    setIsPanning(false);
    setIsSwipeDragging(false);
    setIsSwipeAnimating(false);
    setSwipeOffsetX(0);
    swipeStartRef.current = null;
  };

  const shouldShowMinimap =
    zoom > 1 &&
    !isSwipeDragging &&
    !isSwipeAnimating &&
    Boolean(viewportRect && minimapSize);

  const minimapGeometry = useMemo(() => {
    if (!viewportRect || !minimapSize) return null;

    const scaleX = minimapSize.width / viewportRect.imageWidth;
    const scaleY = minimapSize.height / viewportRect.imageHeight;

    const left = viewportRect.viewLeft * scaleX;
    const top = viewportRect.viewTop * scaleY;
    const width = Math.max(1, viewportRect.viewWidth * scaleX);
    const height = Math.max(1, viewportRect.viewHeight * scaleY);
    const rightInset = Math.max(0, minimapSize.width - left - width);
    const bottomInset = Math.max(0, minimapSize.height - top - height);

    return {
      left,
      top,
      width,
      height,
      clipPath: `inset(${top}px ${rightInset}px ${bottomInset}px ${left}px)`,
    };
  }, [minimapSize, viewportRect]);

  const infoPanelTop =
    shouldShowMinimap && minimapSize ? minimapSize.height + 22 : 12;

  const panFromMinimapPoint = (
    clientX: number,
    clientY: number,
    mode: "center" | "rect",
    offsetX: number,
    offsetY: number,
  ) => {
    const minimap = minimapRef.current;
    const viewport = viewportRef.current;
    const imageFrame = imageFrameRef.current;

    if (!minimap || !viewport || !imageFrame || !minimapSize) {
      return;
    }

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

  const handleMinimapPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!minimapGeometry) return;

    event.preventDefault();
    event.stopPropagation();

    const minimap = minimapRef.current;
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

    minimapDragRef.current = {
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
    const drag = minimapDragRef.current;
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
    const drag = minimapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    minimapDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!selectedFilePath) {
    return (
      <div className="h-full w-full bg-background">
        <ApplicationEmptyState
          icon={<FileSearch className="size-5" />}
          title="No file open"
          description="Open an image to start viewing."
          actionLabel="Open file"
          onAction={() => setIsPickerOpen(true)}
        />

        <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <DialogContent className="h-[min(90vh,860px)] w-[min(99vw,1720px)] max-w-[min(99vw,1720px)] overflow-hidden p-0 sm:max-w-[min(99vw,1720px)]">
            <FileExplorerApplication
              initialPath={`${homePath}/Documents`}
              picker={{
                enabled: true,
                selectionMode: "file",
                allowedFileExtensions: [...IMAGE_EXTENSIONS],
                rootPath: homePath,
                onCancel: () => setIsPickerOpen(false),
                onPick: (node) => {
                  setIsPickerOpen(false);
                  setSelectedFilePath(node.path);
                },
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (!imageNodes.length) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        No images found in {imagesPath}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{currentNode?.name}</p>
          <p className="text-xs text-muted-foreground">
            {currentIndex + 1} of {imageNodes.length}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => applyZoomStep(-0.25)}
            aria-label="Zoom out"
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => applyZoomStep(0.25)}
            aria-label="Zoom in"
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button
            size="icon"
            variant={showInfo ? "secondary" : "ghost"}
            onClick={() => setShowInfo((prev) => !prev)}
            aria-label="Image info"
          >
            <Info className="size-4" />
          </Button>
        </div>
      </div>

      <div className="group relative min-h-0 flex-1 bg-muted/20">
        <div
          ref={viewportRef}
          className={`h-full overflow-auto ${zoom > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              return;
            }

            // Navigation controls
            if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
              event.preventDefault();
              goPrevious();
            } else if (
              event.key === "ArrowRight" ||
              event.key.toLowerCase() === "d"
            ) {
              event.preventDefault();
              goNext();
            }
          }}
          tabIndex={0}
        >
          <div
            className="relative transition-[width,height] duration-200 ease-out"
            style={{
              width: canvasSize.width,
              height: canvasSize.height,
            }}
          >
            <div
              ref={imageFrameRef}
              className="relative shrink-0 transition-[width,height,left,top] duration-200 ease-out"
              style={{
                width: renderedImageSize.width || 1,
                height: renderedImageSize.height || 1,
                left: imageFramePosition.left,
                top: imageFramePosition.top,
                position: "absolute",
              }}
            >
              {currentSrc ? (
                <Image
                  src={currentSrc}
                  alt={currentNode?.name ?? "Image"}
                  fill
                  sizes="(max-width: 1400px) 100vw, 1400px"
                  quality={82}
                  className={`object-contain select-none ${useSwipePresentation ? "opacity-0" : "opacity-100"}`}
                  draggable={false}
                  onLoadingComplete={(img) => {
                    setNaturalSize({
                      width: img.naturalWidth,
                      height: img.naturalHeight,
                    });
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                  Unable to load image source.
                </div>
              )}
            </div>
          </div>
        </div>

        {currentSrc && useSwipePresentation ? (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className={`absolute inset-0 ${isSwipeAnimating ? "transition-transform duration-200 ease-out" : ""}`}
              style={{
                transform: `translate3d(${-swipeLaneWidth + swipeOffsetX}px,0,0)`,
              }}
            >
              <Image
                src={previousImageSrc || currentSrc}
                alt="Previous image"
                fill
                sizes="(max-width: 1400px) 100vw, 1400px"
                quality={72}
                className={`object-contain select-none ${showAdjacentSlides ? "opacity-100" : "opacity-0"}`}
                draggable={false}
              />
            </div>
            <div
              className={`absolute inset-0 ${isSwipeAnimating ? "transition-transform duration-200 ease-out" : ""}`}
              style={{ transform: `translate3d(${swipeOffsetX}px,0,0)` }}
            >
              <Image
                src={currentSrc}
                alt={currentNode?.name ?? "Image"}
                fill
                sizes="(max-width: 1400px) 100vw, 1400px"
                quality={82}
                className="object-contain select-none"
                draggable={false}
              />
            </div>
            <div
              className={`absolute inset-0 ${isSwipeAnimating ? "transition-transform duration-200 ease-out" : ""}`}
              style={{
                transform: `translate3d(${swipeLaneWidth + swipeOffsetX}px,0,0)`,
              }}
            >
              <Image
                src={nextImageSrc || currentSrc}
                alt="Next image"
                fill
                sizes="(max-width: 1400px) 100vw, 1400px"
                quality={72}
                className={`object-contain select-none ${showAdjacentSlides ? "opacity-100" : "opacity-0"}`}
                draggable={false}
              />
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-y-0 left-2 flex items-center">
          <Button
            size="icon"
            variant="secondary"
            onClick={goPrevious}
            aria-label="Previous image"
            className="pointer-events-auto h-9 w-9 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>

        <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
          <Button
            size="icon"
            variant="secondary"
            onClick={goNext}
            aria-label="Next image"
            className="pointer-events-auto h-9 w-9 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {shouldShowMinimap && minimapSize && minimapGeometry ? (
          <div className="absolute right-3 top-3 rounded-md border bg-card/95 p-2 shadow-sm">
            <div
              ref={minimapRef}
              className="relative overflow-hidden rounded-sm border"
              style={{ width: minimapSize.width, height: minimapSize.height }}
              onPointerDown={handleMinimapPointerDown}
              onPointerMove={handleMinimapPointerMove}
              onPointerUp={handleMinimapPointerUpOrCancel}
              onPointerCancel={handleMinimapPointerUpOrCancel}
            >
              <Image
                src={currentSrc}
                alt="Zoom preview"
                fill
                sizes="180px"
                quality={40}
                className="object-fill grayscale brightness-50 blur-[1.5px]"
              />
              <Image
                src={currentSrc}
                alt="Viewport preview"
                fill
                sizes="180px"
                quality={50}
                className="object-fill"
                style={{ clipPath: minimapGeometry.clipPath }}
              />
              <div
                className="absolute cursor-move rounded-[4px] border-2 border-primary"
                style={{
                  left: minimapGeometry.left,
                  top: minimapGeometry.top,
                  width: minimapGeometry.width,
                  height: minimapGeometry.height,
                }}
              />
            </div>
          </div>
        ) : null}

        {showInfo ? (
          <div
            className="absolute right-3 w-64 rounded-md border bg-card p-3 text-xs shadow-sm"
            style={{ top: infoPanelTop }}
          >
            <p className="truncate font-medium">{currentNode?.name}</p>
            <p className="mt-1 text-muted-foreground">
              Path: {currentNode?.path}
            </p>
            <p className="mt-1 text-muted-foreground">
              Read-only: {currentNode?.readOnly ? "Yes" : "No"}
            </p>
            <p className="mt-1 text-muted-foreground">
              Size: {currentNode?.size ?? 0} B
            </p>
            <p className="mt-1 text-muted-foreground">
              Dimensions:{" "}
              {naturalSize
                ? `${naturalSize.width} × ${naturalSize.height}`
                : "Loading..."}
            </p>
            <p className="mt-1 text-muted-foreground">
              Zoom: {(zoom * 100).toFixed(0)}%
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
